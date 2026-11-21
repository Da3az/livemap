import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildServer, StaticAuth, type Actor, type ServerDeps } from "../src/server.js";
import { MemoryMapRepo, freeSlug, slugify } from "../src/repo.js";
import { MemoryArtifactStore } from "../src/storage.js";
import { DEFAULT_LIMITS, type TenantLimits } from "../src/limits.js";
import { TEMPLATES } from "../src/templates.js";
import type { MapDoc, PointFeature } from "@livemap/core";

const TENANT = "t-1";
const MAP_ID = "m-1";
const API = "/api/v1";

const DOC: MapDoc = {
  id: MAP_ID,
  tenantId: TENANT,
  slug: "levant-tracker",
  title: { value: "Levant tracker", dir: "ltr" },
  viewport: { center: [35.75, 32.1], zoom: 9, bearing: 0, pitch: 0 },
  basemap: { styleId: "light", labelLangs: ["ar", "en"] },
  uiDir: "rtl",
  updatedAt: "2026-11-07T00:00:00.000Z",
  rev: 0,
};

function point(id: string): PointFeature {
  return {
    id,
    kind: "point",
    at: "V",
    at_: [35.5, 32],
    icon: "evt:strike",
    iconColor: "#E03C31",
    iconSize: 1,
  };
}

function setup(
  opts: {
    role?: string;
    userId?: string;
    createdBy?: string;
    member?: Partial<TenantLimits>;
    deps?: Partial<ServerDeps>;
  } = {},
) {
  const repo = new MemoryMapRepo();
  const userId = opts.userId ?? "u-1";
  repo.seed(DOC, [point("p1")], { createdBy: opts.createdBy ?? userId });
  const store = new MemoryArtifactStore();
  const actor: Actor = {
    userId,
    tenantId: TENANT,
    tenantSlug: "acme-news",
    role: opts.role ?? "editor",
  };
  const app = buildServer({
    repo,
    store,
    auth: new StaticAuth(actor),
    servePublic: true,
    limits: {
      guest: DEFAULT_LIMITS.guest,
      member: { ...DEFAULT_LIMITS.member, ...opts.member },
    },
    ...opts.deps,
  });
  return { app, repo, store };
}

const title = (value: string) => ({ value, dir: "ltr" as const });

describe("slugs", () => {
  test("a title becomes a URL-safe slug", () => {
    assert.equal(slugify("Élection Night — 2026!"), "election-night-2026");
  });

  test("a title with no Latin letters falls back rather than yielding an empty slug", () => {
    assert.equal(slugify("خريطة"), "map");
  });

  test("a taken slug gets the first free suffix", () => {
    assert.equal(freeSlug("a", new Set()), "a");
    assert.equal(freeSlug("a", new Set(["a", "a-2"])), "a-3");
  });
});

describe("POST /maps", () => {
  test("creates an empty map owned by the actor", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps`,
      payload: { title: title("Flood watch") },
    });
    assert.equal(res.statusCode, 201);
    const { map } = res.json() as { map: MapDoc };
    assert.equal(map.slug, "flood-watch");
    assert.equal(map.rev, 0);

    const got = await app.inject({ method: "GET", url: `${API}/maps/${map.id}` });
    assert.equal(got.statusCode, 200);
    assert.deepEqual((got.json() as { features: unknown[] }).features, []);
    await app.close();
  });

  test("two maps with one title get distinct slugs", async () => {
    const { app } = setup();
    const make = () =>
      app.inject({
        method: "POST",
        url: `${API}/maps`,
        payload: { title: title("Flood watch") },
      });
    const a = (await make()).json() as { map: MapDoc };
    const b = (await make()).json() as { map: MapDoc };
    assert.equal(a.map.slug, "flood-watch");
    assert.equal(b.map.slug, "flood-watch-2");
    await app.close();
  });

  test("a template seeds its features and its direction", async () => {
    const { app } = setup();
    const tpl = TEMPLATES[0]!;
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps`,
      payload: { title: title("Tracker"), template: tpl.id },
    });
    assert.equal(res.statusCode, 201);
    const { map } = res.json() as { map: MapDoc };
    assert.equal(map.uiDir, tpl.uiDir);

    const got = await app.inject({ method: "GET", url: `${API}/maps/${map.id}` });
    assert.equal(
      (got.json() as { features: unknown[] }).features.length,
      tpl.features.length,
    );
    await app.close();
  });

  test("an unknown template is refused, not ignored", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps`,
      payload: { title: title("x"), template: "nope" },
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, "unknown_template");
    await app.close();
  });

  test("an unknown property is rejected rather than silently dropped", async () => {
    // Fastify's default validator would strip `slug` and accept the request,
    // leaving the caller believing they had chosen it.
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps`,
      payload: { title: title("x"), slug: "mine" },
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, "invalid_request");
    await app.close();
  });

  test("a viewer cannot create a map", async () => {
    const { app } = setup({ role: "viewer" });
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps`,
      payload: { title: title("x") },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  test("is refused at the workspace's map limit", async () => {
    // One map is seeded, so a limit of one is already reached.
    const { app } = setup({ member: { maxMaps: 1 } });
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps`,
      payload: { title: title("x") },
    });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as { error: string }).error, "quota_exceeded");
    await app.close();
  });
});

describe("GET /maps", () => {
  test("lists the tenant's maps with a feature count", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: `${API}/maps` });
    assert.equal(res.statusCode, 200);
    const { maps } = res.json() as {
      maps: { id: string; featureCount: number; archived: boolean }[];
    };
    assert.equal(maps.length, 1);
    assert.equal(maps[0]!.id, MAP_ID);
    assert.equal(maps[0]!.featureCount, 1);
    assert.equal(maps[0]!.archived, false);
    await app.close();
  });
});

describe("PATCH /maps/:id", () => {
  test("retitles without moving the revision or the slug", async () => {
    // The revision guards the feature set; bumping it here would make an
    // editor holding the map open lose its next save to a rename.
    const { app } = setup();
    const res = await app.inject({
      method: "PATCH",
      url: `${API}/maps/${MAP_ID}`,
      payload: { title: { value: "متتبع", dir: "rtl" } },
    });
    assert.equal(res.statusCode, 200);
    const { map } = res.json() as { map: MapDoc };
    assert.deepEqual(map.title, { value: "متتبع", dir: "rtl" });
    assert.equal(map.rev, 0);
    assert.equal(map.slug, DOC.slug);
    await app.close();
  });

  test("the slug cannot be changed", async () => {
    // Artifact keys and every embed are built from it.
    const { app } = setup();
    const res = await app.inject({
      method: "PATCH",
      url: `${API}/maps/${MAP_ID}`,
      payload: { slug: "renamed" },
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  test("a contributor cannot retitle someone else's map", async () => {
    const { app } = setup({ role: "contributor", createdBy: "u-other" });
    const res = await app.inject({
      method: "PATCH",
      url: `${API}/maps/${MAP_ID}`,
      payload: { uiDir: "ltr" },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });
});

describe("archive", () => {
  test("hides a map, and unarchive brings it back", async () => {
    const { app } = setup();
    const post = (path: string) =>
      app.inject({ method: "POST", url: `${API}/maps/${MAP_ID}/${path}` });
    const list = async (q = "") =>
      (
        (await app.inject({ method: "GET", url: `${API}/maps${q}` })).json() as {
          maps: unknown[];
        }
      ).maps.length;

    assert.equal((await post("archive")).statusCode, 200);
    assert.equal(
      (await app.inject({ method: "GET", url: `${API}/maps/${MAP_ID}` })).statusCode,
      404,
    );
    assert.equal(await list(), 0);
    assert.equal(await list("?archived=1"), 1);

    assert.equal((await post("unarchive")).statusCode, 200);
    assert.equal(await list(), 1);
    await app.close();
  });

  test("an archived map still counts against the map limit", async () => {
    // Otherwise archiving would be a way to mint more maps.
    const { app } = setup({ member: { maxMaps: 1 } });
    await app.inject({ method: "POST", url: `${API}/maps/${MAP_ID}/archive` });
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps`,
      payload: { title: title("x") },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });
});

describe("versions", () => {
  const publish = (app: ReturnType<typeof setup>["app"]) =>
    app.inject({ method: "POST", url: `${API}/maps/${MAP_ID}/publish` });
  const edit = (app: ReturnType<typeof setup>["app"], rev: number, id: string) =>
    app.inject({
      method: "POST",
      url: `${API}/maps/${MAP_ID}/edit`,
      payload: { rev, put: [point(id)] },
    });

  test("the ledger is listed newest first", async () => {
    const { app } = setup();
    await publish(app);
    await edit(app, 0, "p2");
    await publish(app);

    const res = await app.inject({
      method: "GET",
      url: `${API}/maps/${MAP_ID}/versions`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      publishedVersion: number;
      versions: { version: number; featureCount: number }[];
    };
    assert.equal(body.publishedVersion, 2);
    assert.deepEqual(
      body.versions.map((v) => v.version),
      [2, 1],
    );
    assert.equal(body.versions[0]!.featureCount, 2);
    await app.close();
  });

  test("publishing stops at the version limit", async () => {
    const { app } = setup({ member: { maxVersionsPerMap: 1 } });
    assert.equal((await publish(app)).statusCode, 201);
    await edit(app, 0, "p2");
    const res = await publish(app);
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as { error: string }).error, "quota_exceeded");
    await app.close();
  });

  test("republishing unchanged content at the limit is still 200", async () => {
    // Nothing would be written, so there is nothing for the limit to refuse.
    const { app } = setup({ member: { maxVersionsPerMap: 1 } });
    await publish(app);
    assert.equal((await publish(app)).statusCode, 200);
    await app.close();
  });

  test("rollback is bounded by the same limit", async () => {
    const { app } = setup({ member: { maxVersionsPerMap: 2 } });
    await publish(app);
    await edit(app, 0, "p2");
    await publish(app);
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps/${MAP_ID}/rollback`,
      payload: { toVersion: 1 },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });
});

describe("edit quotas", () => {
  test("an edit past the feature limit is refused whole", async () => {
    const { app } = setup({ member: { maxFeaturesPerMap: 2 } });
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p2"), point("p3")] },
    });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as { error: string }).error, "quota_exceeded");

    // Neither feature landed and the revision did not move.
    const got = await app.inject({ method: "GET", url: `${API}/maps/${MAP_ID}` });
    const body = got.json() as { map: MapDoc; features: unknown[] };
    assert.equal(body.features.length, 1);
    assert.equal(body.map.rev, 0);
    await app.close();
  });

  test("replacing a feature at the limit is allowed", async () => {
    const { app } = setup({ member: { maxFeaturesPerMap: 1 } });
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p1")] },
    });
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  test("a body over the tenant's own limit is refused before it is read", async () => {
    const { app } = setup({ member: { maxBodyBytes: 64 } });
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p2"), point("p3")] },
    });
    assert.equal(res.statusCode, 413);
    await app.close();
  });
});

describe("GET /me", () => {
  test("reports role, capabilities, usage and limits", async () => {
    const { app } = setup({ role: "viewer" });
    const res = await app.inject({ method: "GET", url: `${API}/me` });
    assert.equal(res.statusCode, 200);
    const me = res.json() as {
      role: string;
      capabilities: string[];
      guest: boolean;
      expiresAt: string | null;
      usage: { maps: number };
      limits: TenantLimits;
    };
    assert.equal(me.role, "viewer");
    assert.deepEqual(me.capabilities, ["map:read"]);
    assert.equal(me.guest, false);
    assert.equal(me.expiresAt, null);
    assert.equal(me.usage.maps, 1);
    assert.equal(me.limits.maxMaps, DEFAULT_LIMITS.member.maxMaps);
    await app.close();
  });
});

describe("GET /templates", () => {
  test("lists every template without its features", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: `${API}/templates` });
    const { templates } = res.json() as {
      templates: { id: string; featureCount: number; features?: unknown }[];
    };
    assert.deepEqual(
      templates.map((t) => t.id),
      TEMPLATES.map((t) => t.id),
    );
    assert.equal(templates[0]!.features, undefined);
    await app.close();
  });
});

describe("role resolution", () => {
  test("the database's role wins over the token's claim", async () => {
    // A token minted when the user was an editor, used after a demotion.
    const { app, repo } = setup({ role: "editor" });
    repo.grant(TENANT, "u-1", "viewer");
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [] },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  test("a valid token with no membership left is 401", async () => {
    const { app, repo } = setup();
    repo.grant(TENANT, "u-someone-else", "owner");
    const res = await app.inject({ method: "GET", url: `${API}/me` });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});
