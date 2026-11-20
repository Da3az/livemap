import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildServer, StaticAuth, type Actor } from "../src/server.js";
import { MemoryMapRepo } from "../src/repo.js";
import { MemoryArtifactStore, keys } from "../src/storage.js";
import type { MapDoc, PointFeature } from "@livemap/core";

const TENANT = "t-1";
const TENANT_SLUG = "acme-news";
const MAP_ID = "m-1";

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

function point(id: string, lng: number): PointFeature {
  return {
    id,
    kind: "point",
    at: "V",
    at_: [lng, 32],
    icon: "ocha:Attack",
    iconColor: "#E03C31",
    iconSize: 1,
  };
}

function setup(
  role = "editor",
  actor?: Actor | null,
  createdBy = "u-1",
) {
  const repo = new MemoryMapRepo();
  // The acting user owns the map by default, so a test that is about the role
  // grid is not silently also a test about row ownership. Pass a different
  // createdBy to exercise the ownership rule.
  repo.seed(DOC, [point("p1", 35.5)], { createdBy });
  const store = new MemoryArtifactStore();
  const resolved: Actor | null =
    actor === undefined
      ? { userId: "u-1", tenantId: TENANT, tenantSlug: TENANT_SLUG, role }
      : actor;
  const app = buildServer({ repo, store, auth: new StaticAuth(resolved) });
  return { app, repo, store };
}

describe("auth", () => {
  test("health needs no actor", async () => {
    const { app } = setup("editor", null);
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  test("everything else is 401 without an actor", async () => {
    const { app } = setup("editor", null);
    for (const url of [
      `/maps/${MAP_ID}`,
      `/maps/${MAP_ID}/edit`,
      `/maps/${MAP_ID}/publish`,
    ]) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.statusCode, 401, url);
    }
    await app.close();
  });
});

describe("GET /maps/:id", () => {
  test("returns the document and its features", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: `/maps/${MAP_ID}` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { map: MapDoc; features: unknown[] };
    assert.equal(body.map.id, MAP_ID);
    assert.equal(body.features.length, 1);
    await app.close();
  });

  test("404 for an unknown map", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/maps/nope" });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  // Tenant scoping means another tenant's map id is 404, not 403.
  test("a map in another tenant is not visible", async () => {
    const { app, repo } = setup();
    repo.seed({ ...DOC, id: "other-map", tenantId: "t-2" }, []);
    const res = await app.inject({ method: "GET", url: "/maps/other-map" });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

describe("POST /maps/:id/edit", () => {
  test("applies an edit and returns the new revision", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p2", 36)] },
    });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { rev: number }).rev, 1);
    await app.close();
  });

  // Without the guard a stale client could clobber an edit it never saw.
  test("rejects an edit with no revision", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { put: [point("p2", 36)] },
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, "rev_required");
    await app.close();
  });

  test("a stale revision is 409, not 500", async () => {
    const { app } = setup();
    await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("a", 35)] },
    });
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("b", 36)] },
    });
    assert.equal(res.statusCode, 409);
    assert.equal((res.json() as { error: string }).error, "stale_revision");
    await app.close();
  });

  test("a viewer cannot edit", async () => {
    const { app } = setup("viewer");
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p2", 36)] },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  test("a contributor CAN edit a map it created", async () => {
    const { app } = setup("contributor");
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p2", 36)] },
    });
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  // The whole reason applyEdit returns a status union rather than a nullable
  // revision: an ownership refusal used to be indistinguishable from a lost
  // race, so it surfaced as 409 and told the client to retry forever.
  test("a contributor editing someone else's map is 403, not 409", async () => {
    const { app } = setup("contributor", undefined, "u-someone-else");
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p2", 36)] },
    });
    assert.equal(res.statusCode, 403);
    assert.match((res.json() as { reason: string }).reason, /only maps it created/);
    await app.close();
  });

  test("an editor can edit a map someone else created", async () => {
    const { app } = setup("editor", undefined, "u-someone-else");
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p2", 36)] },
    });
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  test("an unknown role is denied rather than allowed", async () => {
    const { app } = setup("wizard");
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p2", 36)] },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  test("editing an unknown map is 404, not 409", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/maps/nope/edit",
      payload: { rev: 0, put: [point("p2", 36)] },
    });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

describe("POST /maps/:id/publish", () => {
  test("201 with the version and ETag", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/publish`,
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as { version: number; etag: string };
    assert.equal(body.version, 1);
    assert.match(body.etag, /^[0-9a-f]{32}$/);
    await app.close();
  });

  // 200, not 201: nothing was created.
  test("republishing unchanged content is 200 unchanged", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: `/maps/${MAP_ID}/publish` });
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/publish`,
    });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { status: string }).status, "unchanged");
    await app.close();
  });

  test("a contributor gets 403 with a reason", async () => {
    const { app } = setup("contributor");
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/publish`,
    });
    assert.equal(res.statusCode, 403);
    assert.match((res.json() as { reason: string }).reason, /submit for review/);
    await app.close();
  });
});

describe("POST /maps/:id/rollback", () => {
  test("rolls back to an earlier version as a new version", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: `/maps/${MAP_ID}/publish` });
    await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("p2", 36)] },
    });
    await app.inject({ method: "POST", url: `/maps/${MAP_ID}/publish` });

    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/rollback`,
      payload: { toVersion: 1 },
    });
    assert.equal(res.statusCode, 201);
    assert.equal((res.json() as { version: number }).version, 3);
    await app.close();
  });

  test("requires a target version", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/rollback`,
      payload: {},
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });
});

describe("GET /public/*", () => {
  test("serves the artifact with its cache headers", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: `/maps/${MAP_ID}/publish` });

    const key = keys.version(TENANT_SLUG, DOC.slug, 1);
    const res = await app.inject({ method: "GET", url: `/public/${key}` });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers["cache-control"] as string, /immutable/);
    assert.equal(res.headers["access-control-allow-origin"], "*");
    assert.ok(res.headers["etag"]);
    await app.close();
  });

  // The polling read path depends on this: no body, validators repeated.
  test("a matching If-None-Match returns 304 with no body", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: `/maps/${MAP_ID}/publish` });

    const key = keys.pointer(TENANT_SLUG, DOC.slug);
    const first = await app.inject({ method: "GET", url: `/public/${key}` });
    const etag = first.headers["etag"] as string;

    const second = await app.inject({
      method: "GET",
      url: `/public/${key}`,
      headers: { "if-none-match": etag },
    });

    assert.equal(second.statusCode, 304);
    assert.equal(second.body, "");
    assert.equal(second.headers["etag"], etag);
    await app.close();
  });

  test("a non-matching If-None-Match returns the body", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: `/maps/${MAP_ID}/publish` });
    const key = keys.pointer(TENANT_SLUG, DOC.slug);
    const res = await app.inject({
      method: "GET",
      url: `/public/${key}`,
      headers: { "if-none-match": '"stale"' },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.length > 0);
    await app.close();
  });

  test("the pointer carries a short TTL, the artifact a long one", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: `/maps/${MAP_ID}/publish` });

    const p = await app.inject({
      method: "GET",
      url: `/public/${keys.pointer(TENANT_SLUG, DOC.slug)}`,
    });
    const v = await app.inject({
      method: "GET",
      url: `/public/${keys.version(TENANT_SLUG, DOC.slug, 1)}`,
    });

    assert.match(p.headers["cache-control"] as string, /max-age=5/);
    assert.match(p.headers["cache-control"] as string, /stale-while-revalidate/);
    assert.match(v.headers["cache-control"] as string, /max-age=31536000/);
    await app.close();
  });

  test("404 for an unknown key", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/public/nope.json" });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

describe("end-to-end publish loop", () => {
  // Edit -> publish -> pointer -> artifact: the whole viewer read path.
  test("an edit becomes visible through the public path", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: `/maps/${MAP_ID}/publish` });

    await app.inject({
      method: "POST",
      url: `/maps/${MAP_ID}/edit`,
      payload: { rev: 0, put: [point("new-strike", 36.2)] },
    });
    await app.inject({ method: "POST", url: `/maps/${MAP_ID}/publish` });

    const ptr = await app.inject({
      method: "GET",
      url: `/public/${keys.pointer(TENANT_SLUG, DOC.slug)}`,
    });
    const pointer = ptr.json() as { version: number; href: string };
    assert.equal(pointer.version, 2);

    const artifact = await app.inject({
      method: "GET",
      url: `/public/t/${TENANT_SLUG}/m/${DOC.slug}/${pointer.href}`,
    });
    assert.equal(artifact.statusCode, 200);

    const version = artifact.json() as { features: { id: string }[] };
    assert.ok(
      version.features.some((f) => f.id === "new-strike"),
      "the edit never reached the published artifact",
    );
    await app.close();
  });
});
