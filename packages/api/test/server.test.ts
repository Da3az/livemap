import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildServer, StaticAuth, type Actor } from "../src/server.js";
import { MemoryMapRepo, type RepoCtx } from "../src/repo.js";
import { MemoryArtifactStore, keys } from "../src/storage.js";
import { templateSettings, type ErrorBody, type MapDoc, type MapVersion, type PointFeature, type VersionPointer } from "@livemap/core";

const TENANT = "t-1";
const TENANT_SLUG = "acme-news";
const USER = "u-1";
const API = "/api/v1";

function point(id: string, lng = 35.5): PointFeature {
  return {
    id,
    kind: "point",
    order: "V",
    name: { value: id, dir: "ltr" },
    groupId: null,
    hidden: false,
    locked: false,
    presetId: null,
    validFrom: null,
    validTo: null,
    lineageId: null,
    updatedAt: "2026-11-07T00:00:00.000Z",
    updatedBy: "",
    at: [lng, 32],
    symbol: { icon: "strike" },
    color: { slot: 1 },
    size: 24,
  };
}

/** A map in `tenantId` made by `createdBy`, holding one feature. Returns it at its current revision. */
async function makeMap(repo: MemoryMapRepo, tenantId: string, createdBy: string): Promise<MapDoc> {
  const ctx: RepoCtx = { tenantId, userId: createdBy, role: "editor" };
  const created = await repo.createMap(
    ctx,
    { title: { value: "Levant tracker", dir: "ltr" }, uiDir: "rtl", settings: templateSettings("blank", "rtl") },
    { maxMaps: 100 },
  );
  if (created.status !== "created") throw new Error("fixture map was not created");
  const edit = await repo.applyEdit(ctx, created.map.id, { rev: 0, force: false, put: [point("p1")], delete: [] }, { maxFeaturesPerMap: 100 });
  if (edit.status !== "applied") throw new Error("fixture feature was not saved");
  return (await repo.getMap(ctx, created.map.id))!.map;
}

/**
 * A server whose actor is USER with `role`, granted as a membership — the auth
 * hook takes the role from the membership, and refuses an actor without one.
 * The map is made by USER unless `createdBy` says otherwise, so a test about
 * the role grid is not silently also a test about row ownership.
 */
async function setup(role = "editor", opts: { createdBy?: string; anonymous?: boolean } = {}) {
  const repo = new MemoryMapRepo();
  const store = new MemoryArtifactStore();
  repo.grant(TENANT, USER, role);
  const map = await makeMap(repo, TENANT, opts.createdBy ?? USER);
  const actor: Actor | null = opts.anonymous ? null : { userId: USER, tenantId: TENANT, tenantSlug: TENANT_SLUG, role };
  const app = buildServer({ repo, store, auth: new StaticAuth(actor), servePublic: true });
  return { app, repo, store, map };
}

const edit = (app: Awaited<ReturnType<typeof setup>>["app"], mapId: string, rev: number, id = "p2") =>
  app.inject({ method: "POST", url: `${API}/maps/${mapId}/edit`, payload: { rev, put: [point(id, 36)], delete: [] } });

const errorOf = (res: { json: () => unknown }) => (res.json() as ErrorBody).error;

describe("auth", () => {
  test("everything under the API prefix is 401 without an actor", async () => {
    const { app, map } = await setup("editor", { anonymous: true });
    for (const [method, url] of [
      ["GET", `${API}/session`],
      ["GET", `${API}/maps/${map.id}`],
      ["POST", `${API}/maps/${map.id}/edit`],
      ["POST", `${API}/maps/${map.id}/publish`],
      // Unknown paths too: an anonymous caller must not be able to map the API
      // by telling 404 from 401.
      ["GET", `${API}/nope`],
    ] as const) {
      const res = await app.inject({ method, url });
      assert.equal(res.statusCode, 401, `${method} ${url}`);
      assert.equal(errorOf(res), "unauthorised", `${method} ${url}`);
    }
    await app.close();
  });

  test("the artifact route is absent unless asked for", async () => {
    // Production serves artifacts from the CDN. Left on, this route would be an
    // open proxy onto the bucket.
    const repo = new MemoryMapRepo();
    const store = new MemoryArtifactStore();
    await store.put("t/x/m/y/latest.json", "{}", {
      contentType: "application/json",
      cacheControl: "max-age=5",
      etag: '"e"',
    });
    const app = buildServer({ repo, store, auth: new StaticAuth(null) });
    const res = await app.inject({ method: "GET", url: "/public/t/x/m/y/latest.json" });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

describe("tenant scoping", () => {
  // Another tenant's map id is 404, not 403: its existence is not disclosed.
  test("a map in another tenant is not visible", async () => {
    const { app, repo } = await setup();
    const other = await makeMap(repo, "t-2", "u-2");
    const res = await app.inject({ method: "GET", url: `${API}/maps/${other.id}` });
    assert.equal(res.statusCode, 404);
    assert.equal(errorOf(res), "not_found");
    await app.close();
  });
});

describe("POST /maps/:id/edit", () => {
  test("a viewer cannot edit", async () => {
    const { app, map } = await setup("viewer");
    const res = await edit(app, map.id, map.rev);
    assert.equal(res.statusCode, 403);
    assert.equal(errorOf(res), "forbidden");
    await app.close();
  });

  test("a contributor CAN edit a map it created", async () => {
    const { app, map } = await setup("contributor");
    const res = await edit(app, map.id, map.rev);
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  // The reason applyEdit returns a status union rather than a nullable
  // revision: an ownership refusal used to be indistinguishable from a lost
  // race, so it surfaced as 409 and told the client to retry forever.
  test("a contributor editing someone else's map is 403, not 409", async () => {
    const { app, map } = await setup("contributor", { createdBy: "u-someone-else" });
    const res = await edit(app, map.id, map.rev);
    assert.equal(res.statusCode, 403);
    assert.equal(errorOf(res), "forbidden");
    await app.close();
  });

  test("an editor can edit a map someone else created", async () => {
    const { app, map } = await setup("editor", { createdBy: "u-someone-else" });
    const res = await edit(app, map.id, map.rev);
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  test("an unknown role is denied rather than allowed", async () => {
    const { app, map } = await setup("wizard");
    const res = await edit(app, map.id, map.rev);
    assert.equal(res.statusCode, 403);
    assert.equal(errorOf(res), "forbidden");
    await app.close();
  });

  // Same regression as the contributor case: a missing row must not read as a lost race.
  test("editing an unknown map is 404, not 409", async () => {
    const { app } = await setup();
    const res = await edit(app, "nope", 0);
    assert.equal(res.statusCode, 404);
    assert.equal(errorOf(res), "not_found");
    await app.close();
  });

  test("a stale revision is 409, not 500", async () => {
    const { app, map } = await setup();
    assert.equal((await edit(app, map.id, map.rev, "a")).statusCode, 200);
    const res = await edit(app, map.id, map.rev, "b");
    assert.equal(res.statusCode, 409);
    assert.equal(errorOf(res), "stale_revision");
    await app.close();
  });
});

describe("GET /public/*", () => {
  // The polling read path depends on this: no body, validators repeated.
  test("a matching If-None-Match returns 304 with no body", async () => {
    const { app, map } = await setup();
    assert.equal((await app.inject({ method: "POST", url: `${API}/maps/${map.id}/publish` })).statusCode, 201);

    const url = `/public/${keys.pointer(TENANT_SLUG, map.slug)}`;
    const first = await app.inject({ method: "GET", url });
    assert.equal(first.statusCode, 200);
    const etag = first.headers["etag"] as string;
    assert.ok(etag);

    const second = await app.inject({ method: "GET", url, headers: { "if-none-match": etag } });
    assert.equal(second.statusCode, 304);
    assert.equal(second.body, "");
    assert.equal(second.headers["etag"], etag);
    await app.close();
  });
});

describe("end-to-end publish loop", () => {
  // Edit -> publish -> pointer -> artifact: the whole viewer read path.
  test("an edit becomes visible through the public path", async () => {
    const { app, map } = await setup();
    assert.equal((await app.inject({ method: "POST", url: `${API}/maps/${map.id}/publish` })).statusCode, 201);
    assert.equal((await edit(app, map.id, map.rev, "new-strike")).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `${API}/maps/${map.id}/publish` })).statusCode, 201);

    const ptr = await app.inject({ method: "GET", url: `/public/${keys.pointer(TENANT_SLUG, map.slug)}` });
    assert.equal(ptr.statusCode, 200);
    const pointer = ptr.json() as VersionPointer;
    assert.equal(pointer.version, 2);

    // The pointer's url is what a reader follows; with no CDN it is this server's /public.
    const artifact = await app.inject({ method: "GET", url: pointer.url });
    assert.equal(artifact.statusCode, 200);
    const version = artifact.json() as MapVersion;
    assert.equal(version.version, 2);
    assert.ok(
      version.features.some((f) => f.id === "new-strike"),
      "the edit never reached the published artifact",
    );
    await app.close();
  });
});
