import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MemoryArtifactStore,
  FailingArtifactStore,
  keys,
} from "../src/storage.js";
import { MemoryMapRepo } from "../src/repo.js";
import { publishMap, rollbackMap, findOrphanedVersions } from "../src/publish.js";
import type { MapDoc, MapFeature, PointFeature } from "@livemap/core";

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
  rev: 3,
};

function point(id: string, lng: number, color = "#E03C31"): PointFeature {
  return {
    id,
    kind: "point",
    at: "V",
    at_: [lng, 32],
    icon: "ocha:Attack",
    iconColor: color,
    iconSize: 1,
  };
}

function setup(features: MapFeature[] = [point("p1", 35.5)]) {
  const repo = new MemoryMapRepo();
  repo.seed(DOC, features);
  const store = new MemoryArtifactStore();
  return { repo, store };
}

const BASE = {
  tenantId: TENANT,
  tenantSlug: TENANT_SLUG,
  mapId: MAP_ID,
  actorId: "u-1",
  actorRole: "editor",
  now: () => "2026-11-07T10:00:00.000Z",
};

describe("publishMap", () => {
  test("publishes a map and writes both objects", async () => {
    const { repo, store } = setup();
    const out = await publishMap(repo, store, BASE);

    assert.equal(out.status, "published");
    if (out.status !== "published") return;
    assert.equal(out.version.version, 1);

    const vKey = keys.version(TENANT_SLUG, DOC.slug, 1);
    const pKey = keys.pointer(TENANT_SLUG, DOC.slug);
    assert.ok(await store.get(vKey), "version artifact missing");
    assert.ok(await store.get(pKey), "pointer missing");
  });

  // Pointer first would briefly advertise an artifact that does not exist.
  test("writes the artifact BEFORE the pointer", async () => {
    const { repo, store } = setup();
    await publishMap(repo, store, BASE);

    const vKey = keys.version(TENANT_SLUG, DOC.slug, 1);
    const pKey = keys.pointer(TENANT_SLUG, DOC.slug);
    assert.deepEqual(store.writeLog, [vKey, pKey]);
  });

  test("a failed artifact upload never leaves a live pointer", async () => {
    const { repo } = setup();
    const inner = new MemoryArtifactStore();
    const store = new FailingArtifactStore(inner, (k) => k.includes("/v/"));

    await assert.rejects(() => publishMap(repo, store, BASE));

    const pKey = keys.pointer(TENANT_SLUG, DOC.slug);
    assert.equal(
      await inner.get(pKey),
      null,
      "pointer was written despite the artifact failing",
    );
  });

  test("version artifact is immutable, pointer is short-lived", async () => {
    const { repo, store } = setup();
    await publishMap(repo, store, BASE);

    const v = (await store.get(keys.version(TENANT_SLUG, DOC.slug, 1)))!;
    const p = (await store.get(keys.pointer(TENANT_SLUG, DOC.slug)))!;

    assert.match(v.cacheControl, /immutable/);
    assert.match(v.cacheControl, /max-age=31536000/);
    assert.match(p.cacheControl, /max-age=5/);
    assert.match(p.cacheControl, /stale-while-revalidate=30/);
    assert.match(p.cacheControl, /stale-if-error=90/);
  });

  test("ETags are strong-quoted and match between objects", async () => {
    const { repo, store } = setup();
    const out = await publishMap(repo, store, BASE);
    if (out.status !== "published") throw new Error("expected publish");

    const v = (await store.get(keys.version(TENANT_SLUG, DOC.slug, 1)))!;
    assert.equal(v.etag, `"${out.version.etag}"`);
  });

  // A new version would make readers re-download an identical map.
  test("republishing unchanged content is a no-op", async () => {
    const { repo, store } = setup();
    const first = await publishMap(repo, store, BASE);
    assert.equal(first.status, "published");

    const writesAfterFirst = store.writeLog.length;
    const second = await publishMap(repo, store, BASE);

    assert.equal(second.status, "unchanged");
    if (second.status !== "unchanged") return;
    assert.equal(second.version, 1);
    assert.equal(
      store.writeLog.length,
      writesAfterFirst,
      "a no-op publish still wrote to storage",
    );
    assert.equal(repo.allVersions(TENANT, MAP_ID).length, 1);
  });

  test("a real change mints a new version", async () => {
    const { repo, store } = setup();
    await publishMap(repo, store, BASE);

    const rev = (await repo.getMap(TENANT, MAP_ID))!.rev;
    await repo.applyEdit(TENANT, MAP_ID, rev, [point("p2", 36)], []);

    const out = await publishMap(repo, store, BASE);
    assert.equal(out.status, "published");
    if (out.status !== "published") return;
    assert.equal(out.version.version, 2);
    assert.equal(repo.allVersions(TENANT, MAP_ID).length, 2);
  });

  test("feature row order does not affect the ETag", async () => {
    const a = setup([point("p1", 35.5), point("p2", 36)]);
    const b = setup([point("p2", 36), point("p1", 35.5)]);

    const ra = await publishMap(a.repo, a.store, BASE);
    const rb = await publishMap(b.repo, b.store, BASE);
    if (ra.status !== "published" || rb.status !== "published") {
      throw new Error("expected both to publish");
    }
    assert.equal(ra.version.etag, rb.version.etag);
  });

  test("the pointer names the immutable artifact", async () => {
    const { repo, store } = setup();
    await publishMap(repo, store, BASE);
    const p = (await store.get(keys.pointer(TENANT_SLUG, DOC.slug)))!;
    const parsed = JSON.parse(p.body) as { href: string; version: number };
    assert.equal(parsed.href, "v/1.json");
    assert.equal(parsed.version, 1);
  });

  test("bookkeeping records the published version", async () => {
    const { repo, store } = setup();
    await publishMap(repo, store, BASE);
    assert.equal((await repo.getMap(TENANT, MAP_ID))!.publishedVersion, 1);
  });

  test("missing map is reported, not thrown", async () => {
    const { repo, store } = setup();
    const out = await publishMap(repo, store, { ...BASE, mapId: "nope" });
    assert.equal(out.status, "not_found");
  });
});

describe("publish authorisation", () => {
  test("a contributor cannot publish", async () => {
    const { repo, store } = setup();
    const out = await publishMap(repo, store, {
      ...BASE,
      actorRole: "contributor",
    });
    assert.equal(out.status, "forbidden");
    assert.equal(store.size, 0, "a forbidden publish still wrote objects");
  });

  test("a viewer cannot publish", async () => {
    const { repo, store } = setup();
    const out = await publishMap(repo, store, { ...BASE, actorRole: "viewer" });
    assert.equal(out.status, "forbidden");
  });

  for (const role of ["owner", "admin", "editor"]) {
    test(`${role} can publish`, async () => {
      const { repo, store } = setup();
      const out = await publishMap(repo, store, { ...BASE, actorRole: role });
      assert.equal(out.status, "published");
    });
  }

  test("an unknown role is denied rather than allowed", async () => {
    const { repo, store } = setup();
    const out = await publishMap(repo, store, { ...BASE, actorRole: "wizard" });
    assert.equal(out.status, "forbidden");
  });
});

describe("rollback", () => {
  test("republishes old bytes as a NEW version, keeping the ledger append-only", async () => {
    const { repo, store } = setup();
    await publishMap(repo, store, BASE);

    const rev = (await repo.getMap(TENANT, MAP_ID))!.rev;
    await repo.applyEdit(TENANT, MAP_ID, rev, [point("p2", 36)], []);
    await publishMap(repo, store, BASE);
    assert.equal(repo.allVersions(TENANT, MAP_ID).length, 2);

    const out = await rollbackMap(repo, store, { ...BASE, toVersion: 1 });
    assert.equal(out.status, "published");
    if (out.status !== "published") return;

    // A third version, not a mutation of version 1.
    assert.equal(out.version.version, 3);
    const all = repo.allVersions(TENANT, MAP_ID);
    assert.equal(all.length, 3);
    assert.deepEqual(all.map((v) => v.version), [1, 2, 3]);

    // Same content as v1, same ETag, so a cached reader gets a 304.
    assert.equal(all[2]!.etag, all[0]!.etag);
  });

  test("rolling back to a version that was never stored is reported", async () => {
    const { repo, store } = setup();
    await publishMap(repo, store, BASE);
    const out = await rollbackMap(repo, store, { ...BASE, toVersion: 99 });
    assert.equal(out.status, "not_found");
  });

  test("a contributor cannot roll back", async () => {
    const { repo, store } = setup();
    await publishMap(repo, store, BASE);
    const out = await rollbackMap(repo, store, {
      ...BASE,
      actorRole: "contributor",
      toVersion: 1,
    });
    assert.equal(out.status, "forbidden");
  });
});

describe("orphan reconciliation", () => {
  test("finds version rows whose artifact is missing", async () => {
    const { repo, store } = setup();
    await publishMap(repo, store, BASE);

    const all = repo.allVersions(TENANT, MAP_ID);
    assert.deepEqual(await findOrphanedVersions(store, all), []);

    await store.delete(all[0]!.storageKey);
    const orphans = await findOrphanedVersions(store, all);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0]!.version, 1);
  });
});

describe("optimistic concurrency", () => {
  test("a stale writer loses instead of clobbering", async () => {
    const { repo } = setup();
    const rev = (await repo.getMap(TENANT, MAP_ID))!.rev;

    const first = await repo.applyEdit(TENANT, MAP_ID, rev, [point("a", 35)], []);
    assert.equal(first, rev + 1);

    // Second writer still holds the old revision.
    const second = await repo.applyEdit(TENANT, MAP_ID, rev, [point("b", 36)], []);
    assert.equal(second, null, "stale write was accepted");

    const feats = await repo.listFeatures(TENANT, MAP_ID);
    assert.ok(feats.some((f) => f.id === "a"));
    assert.ok(!feats.some((f) => f.id === "b"), "stale write landed anyway");
  });

  test("a writer that re-reads succeeds", async () => {
    const { repo } = setup();
    const rev1 = (await repo.getMap(TENANT, MAP_ID))!.rev;
    await repo.applyEdit(TENANT, MAP_ID, rev1, [point("a", 35)], []);

    const rev2 = (await repo.getMap(TENANT, MAP_ID))!.rev;
    const ok = await repo.applyEdit(TENANT, MAP_ID, rev2, [point("b", 36)], []);
    assert.equal(ok, rev2 + 1);
  });

  test("deletes are applied before puts within one edit", async () => {
    const { repo } = setup([point("p1", 35)]);
    const rev = (await repo.getMap(TENANT, MAP_ID))!.rev;
    // Re-creating the same id in the same transaction must keep the new value.
    await repo.applyEdit(TENANT, MAP_ID, rev, [point("p1", 99)], ["p1"]);
    const feats = (await repo.listFeatures(TENANT, MAP_ID)) as PointFeature[];
    assert.equal(feats.length, 1);
    assert.equal(feats[0]!.at_[0], 99);
  });
});
