import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildServer, StaticAuth, type Actor } from "../src/server.js";
import { MemoryMapRepo } from "../src/repo.js";
import { MemoryArtifactStore } from "../src/storage.js";
import { DEFAULT_LIMITS, type TenantLimits } from "../src/limits.js";
import {
  templateSettings,
  type CreateMapRequest,
  type ErrorBody,
  type MapDoc,
  type MapFeature,
  type MapSummary,
  type PointFeature,
} from "@livemap/core";

const TENANT = "t-1";
const USER = "u-1";
const API = "/api/v1";

function point(id: string): PointFeature {
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
    at: [35.5, 32],
    symbol: { icon: "strike" },
    color: { slot: 1 },
    size: 24,
  };
}

const CREATE: CreateMapRequest = { title: { value: "Flood watch", dir: "ltr" }, uiDir: "ltr", template: "blank" };

/**
 * A server whose token names USER as `claimed`, while the database grants
 * `granted` (the same role unless a test says otherwise; null for no
 * membership at all). The auth hook goes by the database.
 */
function setup(opts: { claimed?: string; granted?: string | null; member?: Partial<TenantLimits> } = {}) {
  const repo = new MemoryMapRepo();
  const claimed = opts.claimed ?? "editor";
  const granted = opts.granted === undefined ? claimed : opts.granted;
  if (granted !== null) repo.grant(TENANT, USER, granted);
  const actor: Actor = { userId: USER, tenantId: TENANT, tenantSlug: "acme-news", role: claimed };
  const app = buildServer({
    repo,
    store: new MemoryArtifactStore(),
    auth: new StaticAuth(actor),
    limits: { guest: DEFAULT_LIMITS.guest, member: { ...DEFAULT_LIMITS.member, ...opts.member } },
  });
  return { app, repo };
}

type App = ReturnType<typeof setup>["app"];

const createMap = (app: App, body: CreateMapRequest = CREATE) => app.inject({ method: "POST", url: `${API}/maps`, payload: body });

/** A map made through the repo directly, so a test about a refused route does not depend on that route. */
async function seedMap(repo: MemoryMapRepo, features: MapFeature[] = []): Promise<MapDoc> {
  const ctx = { tenantId: TENANT, userId: USER, role: "editor" };
  const created = await repo.createMap(ctx, { title: CREATE.title, uiDir: "ltr", settings: templateSettings("blank", "ltr") }, { maxMaps: 100 });
  if (created.status !== "created") throw new Error("fixture map was not created");
  if (features.length === 0) return created.map;
  const saved = await repo.applyEdit(ctx, created.map.id, { rev: 0, force: false, put: features, delete: [] }, { maxFeaturesPerMap: 100 });
  if (saved.status !== "applied") throw new Error("fixture features were not saved");
  return (await repo.getMap(ctx, created.map.id))!.map;
}

const errorOf = (res: { json: () => unknown }) => (res.json() as ErrorBody).error;

describe("creating maps", () => {
  test("a viewer cannot create a map", async () => {
    const { app, repo } = setup({ claimed: "viewer" });
    const res = await createMap(app);
    assert.equal(res.statusCode, 403);
    assert.equal(errorOf(res), "forbidden");
    assert.equal(await repo.countMaps({ tenantId: TENANT, userId: USER, role: "viewer" }), 0);
    await app.close();
  });
});

describe("archive and the map limit", () => {
  // Archived maps do not count against the limit (archiving is how a full
  // workspace makes room), so restoring one has to be checked against it, or
  // archive-create-restore would be a way past the limit.
  test("restoring an archived map is refused at the map limit", async () => {
    const { app } = setup({ claimed: "owner", member: { maxMaps: 1 } });
    const first = await createMap(app);
    assert.equal(first.statusCode, 201);
    const archived = (first.json() as { map: MapDoc }).map;

    assert.equal((await createMap(app)).statusCode, 403, "the limit of one was not enforced");
    assert.equal((await app.inject({ method: "POST", url: `${API}/maps/${archived.id}/archive` })).statusCode, 204);
    assert.equal((await createMap(app)).statusCode, 201, "archiving did not make room");

    const res = await app.inject({ method: "POST", url: `${API}/maps/${archived.id}/unarchive` });
    assert.equal(res.statusCode, 403);
    assert.equal(errorOf(res), "quota_exceeded");

    // It stays archived.
    const list = await app.inject({ method: "GET", url: `${API}/maps?archived=true` });
    assert.deepEqual(
      (list.json() as { maps: MapSummary[] }).maps.map((m) => m.id),
      [archived.id],
    );
    await app.close();
  });
});

describe("edit quotas", () => {
  test("an edit past the feature limit is refused whole", async () => {
    const { app, repo } = setup({ member: { maxFeaturesPerMap: 2 } });
    const map = await seedMap(repo, [point("p1")]);
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps/${map.id}/edit`,
      payload: { rev: map.rev, put: [point("p2"), point("p3")], delete: [] },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(errorOf(res), "quota_exceeded");

    // Neither feature landed and the revision did not move.
    const got = await app.inject({ method: "GET", url: `${API}/maps/${map.id}` });
    const body = got.json() as { map: MapDoc; features: MapFeature[] };
    assert.deepEqual(body.features.map((f) => f.id), ["p1"]);
    assert.equal(body.map.rev, map.rev);
    await app.close();
  });
});

describe("role resolution", () => {
  test("the database's role wins over the token's claim", async () => {
    // A token minted when the user was an editor, used after a demotion.
    const { app, repo } = setup({ claimed: "editor", granted: "viewer" });
    const map = await seedMap(repo);
    const res = await app.inject({
      method: "POST",
      url: `${API}/maps/${map.id}/edit`,
      payload: { rev: map.rev, put: [point("p1")], delete: [] },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(errorOf(res), "forbidden");

    const session = await app.inject({ method: "GET", url: `${API}/session` });
    assert.equal((session.json() as { role: string }).role, "viewer");
    await app.close();
  });

  test("a valid token with no membership left is 401", async () => {
    const { app, repo } = setup({ granted: null });
    // Someone else is still a member: it is this user's membership that is gone.
    repo.grant(TENANT, "u-someone-else", "owner");
    const res = await app.inject({ method: "GET", url: `${API}/session` });
    assert.equal(res.statusCode, 401);
    assert.equal(errorOf(res), "unauthorised");
    await app.close();
  });
});
