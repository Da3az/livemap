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
import type { MapRepo, VersionRecord } from "./repo.js";

export type PublishOutcome =
  | { readonly status: "published"; readonly version: MapVersion }
  | { readonly status: "unchanged"; readonly version: number; readonly etag: string }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden"; readonly reason: string };

export interface PublishInput {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly mapId: string;
  readonly actorId: string;
  /** Roles permitted to publish; `contributor` is not one of them. */
  readonly actorRole: string;
  /** Override the clock, for deterministic tests. */
  readonly now?: () => string;
}

const PUBLISHING_ROLES = new Set(["owner", "admin", "editor"]);

/**
 * Step order is the correctness argument: the database and object storage are
 * not one transaction, so the pointer is written last. Pointer first would
 * briefly advertise an artifact that does not exist; any interruption before
 * it leaves readers on the previous version.
 */
export async function publishMap(
  repo: MapRepo,
  store: ArtifactStore,
  input: PublishInput,
): Promise<PublishOutcome> {
  if (!PUBLISHING_ROLES.has(input.actorRole)) {
    return {
      status: "forbidden",
      reason: `role "${input.actorRole}" cannot publish; submit for review instead`,
    };
  }

  const doc = await repo.getMap(input.tenantId, input.mapId);
  if (!doc) return { status: "not_found" };

  const features = await repo.listFeatures(input.tenantId, input.mapId);
  const latest = await repo.getLatestVersion(input.tenantId, input.mapId);

  // `buildVersion` keeps version/publishedAt/publishedBy out of the hash, so
  // the etag comparison below is about content only.
  const nextVersion = await repo.nextVersion(input.tenantId, input.mapId);
  const built = buildVersion({
    doc,
    features,
    version: nextVersion,
    publishedBy: input.actorId,
    ...(input.now ? { publishedAt: input.now() } : {}),
  });

  // No new version for unchanged content; readers would re-download an
  // identical map and lose a warm cache.
  if (latest && latest.etag === built.etag) {
    return { status: "unchanged", version: latest.version, etag: latest.etag };
  }

  const body = canonicalJson(built);
  const versionKey = keys.version(input.tenantSlug, doc.slug, built.version);
  const pointerKey = keys.pointer(input.tenantSlug, doc.slug);

  const record: VersionRecord = {
    mapId: doc.id,
    version: built.version,
    etag: built.etag,
    storageKey: versionKey,
    byteSize: Buffer.byteLength(body, "utf8"),
    featureCount: built.features.length,
    publishedAt: built.publishedAt,
    publishedBy: built.publishedBy,
  };

  // 1 — ledger
  await repo.recordVersion(input.tenantId, record);

  // 2 — immutable artifact
  const vPolicy = versionedCachePolicy(built.etag);
  await store.put(versionKey, body, {
    contentType: "application/json; charset=utf-8",
    cacheControl: vPolicy.cacheControl,
    etag: vPolicy.etag,
  });

  // 3 — pointer. The map goes live at this line and not before.
  const pointer = pointerFor(built);
  const pPolicy = pointerCachePolicy(built.etag);
  await store.put(pointerKey, canonicalJson(pointer), {
    contentType: "application/json; charset=utf-8",
    cacheControl: pPolicy.cacheControl,
    etag: pPolicy.etag,
  });

  // 4 — bookkeeping
  await repo.setPublishedVersion(input.tenantId, doc.id, built.version);

  return { status: "published", version: built };
}

/** Republishes an earlier version's bytes as a new version; the ledger stays append-only. */
export async function rollbackMap(
  repo: MapRepo,
  store: ArtifactStore,
  input: PublishInput & { readonly toVersion: number },
): Promise<PublishOutcome> {
  if (!PUBLISHING_ROLES.has(input.actorRole)) {
    return {
      status: "forbidden",
      reason: `role "${input.actorRole}" cannot publish`,
    };
  }

  const doc = await repo.getMap(input.tenantId, input.mapId);
  if (!doc) return { status: "not_found" };

  const sourceKey = keys.version(input.tenantSlug, doc.slug, input.toVersion);
  const source = await store.get(sourceKey);
  if (!source) return { status: "not_found" };

  const previous = JSON.parse(source.body) as MapVersion;
  const nextVersion = await repo.nextVersion(input.tenantId, input.mapId);

  const republished: MapVersion = {
    ...previous,
    version: nextVersion,
    publishedAt: input.now ? input.now() : new Date().toISOString(),
    publishedBy: input.actorId,
  };

  const body = canonicalJson(republished);
  const versionKey = keys.version(input.tenantSlug, doc.slug, nextVersion);

  await repo.recordVersion(input.tenantId, {
    mapId: doc.id,
    version: nextVersion,
    // Same content, same ETag, so a reader holding the old bytes gets a 304.
    etag: previous.etag,
    storageKey: versionKey,
    byteSize: Buffer.byteLength(body, "utf8"),
    featureCount: republished.features.length,
    publishedAt: republished.publishedAt,
    publishedBy: republished.publishedBy,
  });

  const vPolicy = versionedCachePolicy(previous.etag);
  await store.put(versionKey, body, {
    contentType: "application/json; charset=utf-8",
    cacheControl: vPolicy.cacheControl,
    etag: vPolicy.etag,
  });

  const pPolicy = pointerCachePolicy(previous.etag);
  await store.put(keys.pointer(input.tenantSlug, doc.slug), canonicalJson(pointerFor(republished)), {
    contentType: "application/json; charset=utf-8",
    cacheControl: pPolicy.cacheControl,
    etag: pPolicy.etag,
  });

  await repo.setPublishedVersion(input.tenantId, doc.id, nextVersion);

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
