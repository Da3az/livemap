import {
  buildVersion,
  canonicalJson,
  pointerCachePolicy,
  pointerFor,
  versionedCachePolicy,
  type MapVersion,
} from "@livemap/core";
import type { ArtifactStore } from "./storage.js";
import { keys } from "./storage.js";
import { authorizePublish } from "./authz.js";
import type { MapRepo, RepoCtx, VersionDraft, VersionRecord } from "./repo.js";

export type PublishOutcome =
  | { readonly status: "published"; readonly version: MapVersion }
  | { readonly status: "unchanged"; readonly version: number; readonly etag: string }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden"; readonly reason: string };

export interface PublishInput {
  readonly ctx: RepoCtx;
  readonly tenantSlug: string;
  readonly mapId: string;
  /** Override the clock, for deterministic tests. */
  readonly now?: () => string;
}

/**
 * Step order is the correctness argument on two axes.
 *
 * Across systems: the database and object storage are not one transaction, so
 * the pointer is written last. Pointer first would briefly advertise an
 * artifact that does not exist; any interruption before it leaves readers on
 * the previous version, which is always a valid map.
 *
 * Within the database: this is THREE transactions, not five and not one.
 *   1. `loadForPublish` — doc, features and the newest version from one
 *      snapshot, so the etag comparison cannot straddle a concurrent edit.
 *   2. `recordNextVersion` — allocate the version number and insert the ledger
 *      row together, serialised against other publishers of this map.
 *   3. `setPublishedVersion` — must come after the artifact exists, or the maps
 *      row would point at bytes nobody can fetch.
 *
 * One transaction is impossible: step 3 has to wait for an object store that
 * cannot join a Postgres transaction. Two would mean advancing
 * `published_version` before the artifact is written.
 */
export async function publishMap(
  repo: MapRepo,
  store: ArtifactStore,
  input: PublishInput,
): Promise<PublishOutcome> {
  const decision = authorizePublish(input.ctx);
  if (!decision.allowed) {
    return { status: "forbidden", reason: decision.reason! };
  }

  // 1 — one consistent read
  const snapshot = await repo.loadForPublish(input.ctx, input.mapId);
  if (!snapshot) return { status: "not_found" };
  const { doc, features, latest } = snapshot;

  // `buildVersion` keeps version/publishedAt/publishedBy out of the hash, so
  // the etag is a pure function of the content. That is what lets us compare
  // etags here, before a version number has been allocated: whatever number
  // step 2 hands back, the etag is the same.
  const candidate = buildVersion({
    doc,
    features,
    version: (latest?.version ?? 0) + 1,
    publishedBy: input.ctx.userId,
    ...(input.now ? { publishedAt: input.now() } : {}),
  });

  // No new version for unchanged content; readers would re-download an
  // identical map and lose a warm cache.
  if (latest && latest.etag === candidate.etag) {
    return { status: "unchanged", version: latest.version, etag: latest.etag };
  }

  // 2 — ledger. The callback runs inside the allocating transaction, because
  // the storage key and the byte count both depend on the number it assigns.
  let built = candidate;
  let body = canonicalJson(candidate);

  const record = await repo.recordNextVersion(input.ctx, input.mapId, (version) => {
    built = { ...candidate, version };
    body = canonicalJson(built);
    return {
      etag: built.etag,
      storageKey: keys.version(input.tenantSlug, doc.slug, version),
      byteSize: Buffer.byteLength(body, "utf8"),
      featureCount: built.features.length,
      publishedAt: built.publishedAt,
      publishedBy: built.publishedBy,
    } satisfies VersionDraft;
  });

  // The map was archived or deleted between the read and the allocation.
  if (!record) return { status: "not_found" };

  // 3 — immutable artifact
  const vPolicy = versionedCachePolicy(built.etag);
  await store.put(record.storageKey, body, {
    contentType: "application/json; charset=utf-8",
    cacheControl: vPolicy.cacheControl,
    etag: vPolicy.etag,
  });

  // 4 — pointer. The map goes live at this line and not before.
  const pointer = pointerFor(built);
  const pPolicy = pointerCachePolicy(built.etag);
  await store.put(
    keys.pointer(input.tenantSlug, doc.slug),
    canonicalJson(pointer),
    {
      contentType: "application/json; charset=utf-8",
      cacheControl: pPolicy.cacheControl,
      etag: pPolicy.etag,
    },
  );

  // 5 — bookkeeping
  await repo.setPublishedVersion(input.ctx, doc.id, built.version);

  return { status: "published", version: built };
}

/** Republishes an earlier version's bytes as a new version; the ledger stays append-only. */
export async function rollbackMap(
  repo: MapRepo,
  store: ArtifactStore,
  input: PublishInput & { readonly toVersion: number },
): Promise<PublishOutcome> {
  const decision = authorizePublish(input.ctx);
  if (!decision.allowed) {
    return { status: "forbidden", reason: decision.reason! };
  }

  const doc = await repo.getMap(input.ctx, input.mapId);
  if (!doc) return { status: "not_found" };

  const sourceKey = keys.version(input.tenantSlug, doc.slug, input.toVersion);
  const source = await store.get(sourceKey);
  if (!source) return { status: "not_found" };

  const previous = JSON.parse(source.body) as MapVersion;

  let republished: MapVersion = previous;
  let body = canonicalJson(previous);

  const record = await repo.recordNextVersion(input.ctx, input.mapId, (version) => {
    republished = {
      ...previous,
      version,
      publishedAt: input.now ? input.now() : new Date().toISOString(),
      publishedBy: input.ctx.userId,
    };
    body = canonicalJson(republished);
    return {
      // Same content, same ETag, so a reader holding the old bytes gets a 304.
      etag: previous.etag,
      storageKey: keys.version(input.tenantSlug, doc.slug, version),
      byteSize: Buffer.byteLength(body, "utf8"),
      featureCount: republished.features.length,
      publishedAt: republished.publishedAt,
      publishedBy: republished.publishedBy,
    } satisfies VersionDraft;
  });

  if (!record) return { status: "not_found" };

  const vPolicy = versionedCachePolicy(previous.etag);
  await store.put(record.storageKey, body, {
    contentType: "application/json; charset=utf-8",
    cacheControl: vPolicy.cacheControl,
    etag: vPolicy.etag,
  });

  const pPolicy = pointerCachePolicy(previous.etag);
  await store.put(
    keys.pointer(input.tenantSlug, doc.slug),
    canonicalJson(pointerFor(republished)),
    {
      contentType: "application/json; charset=utf-8",
      cacheControl: pPolicy.cacheControl,
      etag: pPolicy.etag,
    },
  );

  await repo.setPublishedVersion(input.ctx, doc.id, record.version);

  return { status: "published", version: republished };
}

/** Version rows whose artifact is missing — an interrupted publish. For a periodic sweep. */
export async function findOrphanedVersions(
  store: ArtifactStore,
  records: readonly VersionRecord[],
): Promise<VersionRecord[]> {
  const out: VersionRecord[] = [];
  for (const r of records) {
    if (!(await store.has(r.storageKey))) out.push(r);
  }
  return out;
}
