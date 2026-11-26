import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MemoryArtifactStore, FailingArtifactStore, keys } from "../src/storage.js";
import { MemoryMapRepo, type MapRepo, type RepoCtx } from "../src/repo.js";
import { publishMap, rollbackMap } from "../src/publish.js";
import { templateSettings, type MapFeature, type PointFeature } from "@livemap/core";

const TENANT_SLUG = "acme-news";
const CTX: RepoCtx = { tenantId: "t-1", userId: "u-1", role: "editor" };
const LIMITS = { maxFeaturesPerMap: 100 };

function point(id: string, lng: number, order = "V"): PointFeature {
  return {
    id,
    kind: "point",
    order,
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

/**
 * A map made by CTX's user, holding `features`. CTX is an editor and the
 * creator, so these tests exercise the role grid rather than row ownership;
 * the ownership cases are in server.test.ts, where the status code is the point.
 */
async function setup(features: MapFeature[] = [point("p1", 35.5)]) {
  const repo = new MemoryMapRepo();
  const store = new MemoryArtifactStore();
  const created = await repo.createMap(
    CTX,
    { title: { value: "Levant tracker", dir: "ltr" }, uiDir: "rtl", settings: templateSettings("blank", "rtl") },
    { maxMaps: 100 },
  );
  if (created.status !== "created") throw new Error("fixture map was not created");
  const mapId = created.map.id;
  const saved = await repo.applyEdit(CTX, mapId, { rev: 0, force: false, put: features, delete: [] }, LIMITS);
  if (saved.status !== "applied") throw new Error("fixture features were not saved");
  const slug = created.map.slug;
  const input = {
    ctx: CTX,
    tenantSlug: TENANT_SLUG,
    mapId,
    artifactBase: "/public",
    now: () => "2026-11-07T10:00:00.000Z",
  };
  return { repo, store, mapId, slug, input };
}

const revOf = async (repo: MapRepo, mapId: string) => (await repo.getMap(CTX, mapId))!.map.rev;

const putFeature = async (repo: MapRepo, mapId: string, feature: MapFeature) =>
  repo.applyEdit(CTX, mapId, { rev: await revOf(repo, mapId), force: false, put: [feature], delete: [] }, LIMITS);

describe("publishMap", () => {
  // Pointer first would briefly advertise an artifact that does not exist.
  test("writes the artifact BEFORE the pointer", async () => {
    const { repo, store, slug, input } = await setup();
    assert.equal((await publishMap(repo, store, input)).status, "published");
    assert.deepEqual(store.writeLog, [keys.version(TENANT_SLUG, slug, 1), keys.pointer(TENANT_SLUG, slug)]);
  });

  test("a failed artifact upload never leaves a live pointer", async () => {
    const { repo, slug, input } = await setup();
    const inner = new MemoryArtifactStore();
    const store = new FailingArtifactStore(inner, (k) => k.includes("/v/"));

    await assert.rejects(() => publishMap(repo, store, input));
    assert.equal(await inner.get(keys.pointer(TENANT_SLUG, slug)), null, "pointer was written despite the artifact failing");
  });

  // A new version would make readers re-download an identical map.
  test("republishing unchanged content is a no-op", async () => {
    const { repo, store, mapId, input } = await setup();
    assert.equal((await publishMap(repo, store, input)).status, "published");
    const writesAfterFirst = store.writeLog.filter((k) => k.includes("/v/")).length;

    const second = await publishMap(repo, store, input);
    assert.equal(second.status, "unchanged");
    if (second.status !== "unchanged") return;
    assert.equal(second.version, 1);
    assert.equal(
      store.writeLog.filter((k) => k.includes("/v/")).length,
      writesAfterFirst,
      "a no-op publish wrote another version artifact",
    );
    assert.equal((await repo.listVersions(CTX, mapId)).length, 1);
  });

  test("feature row order does not affect the ETag", async () => {
    // The same map read back with its rows in the opposite order must hash the
    // same, so republishing it is "unchanged" rather than a new version.
    const { repo, store, mapId, input } = await setup([point("p1", 35.5, "M"), point("p2", 36, "V")]);
    const first = await publishMap(repo, store, input);
    assert.equal(first.status, "published");
    if (first.status !== "published") return;

    let reversedOrder: string[] = [];
    const reversed: MapRepo = Object.create(repo, {
      loadForPublish: {
        value: async (ctx: RepoCtx, id: string) => {
          const snapshot = await repo.loadForPublish(ctx, id);
          if (!snapshot) return snapshot;
          const features = [...snapshot.features].reverse();
          reversedOrder = features.map((f) => f.id);
          return { ...snapshot, features };
        },
      },
    });
    const second = await publishMap(reversed, store, input);
    assert.deepEqual(reversedOrder, ["p2", "p1"], "the rows were not actually reordered");
    assert.equal(second.status, "unchanged");
    if (second.status !== "unchanged") return;
    assert.equal(second.etag, first.version.etag);
    assert.equal((await repo.listVersions(CTX, mapId)).length, 1);
  });
});

describe("publish authorisation", () => {
  test("a contributor cannot publish", async () => {
    const { repo, store, input } = await setup();
    const out = await publishMap(repo, store, { ...input, ctx: { ...CTX, role: "contributor" } });
    assert.equal(out.status, "forbidden");
    assert.equal(store.size, 0, "a forbidden publish still wrote objects");
  });

  test("a viewer cannot publish", async () => {
    const { repo, store, input } = await setup();
    const out = await publishMap(repo, store, { ...input, ctx: { ...CTX, role: "viewer" } });
    assert.equal(out.status, "forbidden");
    assert.equal(store.size, 0, "a forbidden publish still wrote objects");
  });

  test("an unknown role is denied rather than allowed", async () => {
    const { repo, store, input } = await setup();
    const out = await publishMap(repo, store, { ...input, ctx: { ...CTX, role: "wizard" } });
    assert.equal(out.status, "forbidden");
    assert.equal(store.size, 0, "a forbidden publish still wrote objects");
  });
});

describe("rollback", () => {
  test("republishes old bytes as a NEW version, keeping the ledger append-only", async () => {
    const { repo, store, mapId, input } = await setup();
    assert.equal((await publishMap(repo, store, input)).status, "published");
    assert.equal((await putFeature(repo, mapId, point("p2", 36))).status, "applied");
    assert.equal((await publishMap(repo, store, input)).status, "published");
    const before = await repo.listVersions(CTX, mapId);
    assert.equal(before.length, 2);

    const out = await rollbackMap(repo, store, { ...input, toVersion: 1 });
    assert.equal(out.status, "published");
    if (out.status !== "published") return;

    // A third version, not a mutation of version 1.
    assert.equal(out.version.version, 3);
    const all = [...(await repo.listVersions(CTX, mapId))].sort((a, b) => a.version - b.version);
    assert.deepEqual(all.map((v) => v.version), [1, 2, 3]);
    // The earlier rows are untouched.
    assert.deepEqual(all.slice(0, 2), [...before].sort((a, b) => a.version - b.version));
    assert.deepEqual(all[2]!.origin, { type: "rollback", fromVersion: 1 });

    // Same content as v1, same ETag, so a cached reader keeps its copy.
    assert.equal(all[2]!.etag, all[0]!.etag);
    const v1 = JSON.parse((await store.get(all[0]!.storageKey))!.body) as { features: unknown };
    const v3 = JSON.parse((await store.get(all[2]!.storageKey))!.body) as { features: unknown };
    assert.deepEqual(v3.features, v1.features);
  });

  test("a contributor cannot roll back", async () => {
    const { repo, store, mapId, input } = await setup();
    assert.equal((await publishMap(repo, store, input)).status, "published");
    const writes = store.writeLog.length;

    const out = await rollbackMap(repo, store, { ...input, ctx: { ...CTX, role: "contributor" }, toVersion: 1 });
    assert.equal(out.status, "forbidden");
    assert.equal(store.writeLog.length, writes, "a forbidden rollback still wrote objects");
    assert.equal((await repo.listVersions(CTX, mapId)).length, 1);
  });
});

describe("optimistic concurrency", () => {
  test("a stale writer loses instead of clobbering", async () => {
    const { repo, mapId } = await setup();
    const rev = await revOf(repo, mapId);

    const first = await repo.applyEdit(CTX, mapId, { rev, force: false, put: [point("a", 35)], delete: [] }, LIMITS);
    assert.equal(first.status, "applied");
    if (first.status !== "applied") return;
    assert.equal(first.rev, rev + 1);

    // Second writer still holds the old revision.
    const second = await repo.applyEdit(CTX, mapId, { rev, force: false, put: [point("b", 36)], delete: [] }, LIMITS);
    assert.equal(second.status, "stale", "stale write was accepted");

    const loaded = (await repo.getMap(CTX, mapId))!;
    assert.ok(loaded.features.some((f) => f.id === "a"));
    assert.ok(!loaded.features.some((f) => f.id === "b"), "stale write landed anyway");
    assert.equal(loaded.map.rev, rev + 1);
  });
});
