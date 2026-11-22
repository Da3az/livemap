import {
  buildArtifact,
  canonicalJson,
  etagFor,
  pointerBody,
  POINTER_CACHE_CONTROL,
  publishHash,
  VERSION_CACHE_CONTROL,
  type MapVersion,
} from "@livemap/core";
import { ARCHIVED_REASON, type MapRepo, type RepoCtx, type VersionDraft, type VersionRow } from "./repo.js";
import { keys, type ArtifactStore } from "./storage.js";
import { authorizePublish } from "./authz.js";

export type PublishOutcome =
  | { readonly status: "published"; readonly version: VersionRow }
  | { readonly status: "unchanged"; readonly version: number; readonly etag: string }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden"; readonly reason: string }
  | { readonly status: "quota"; readonly reason: string };

export interface PublishInput {
  readonly ctx: RepoCtx;
  readonly tenantSlug: string;
  readonly mapId: string;
  /** Where readers fetch artifacts from, without a trailing slash. */
  readonly artifactBase: string;
  /**
   * Most versions this map may ever have. Versions are numbered from 1 without
   * gaps, so the newest number is also the count. Omit or null for no limit.
   */
  readonly maxVersions?: number | null;
  /** Override the clock, for deterministic runs. */
  readonly now?: () => string;
}

const JSON_TYPE = "application/json; charset=utf-8";

export function artifactUrl(artifactBase: string, storageKey: string): string {
  return `${artifactBase}/${storageKey}`;
}

/**
 * Step order is the correctness argument on two axes.
 *
 * Across systems: the database and object storage are not one transaction, so
 * the immutable artifact is written before anything points at it, and the
 * pointer last. Any interruption before the pointer leaves readers on the
 * previous version, which is always a valid map.
 *
 * Within the database, three transactions:
 *   1. `loadForPublish` — doc, features and the newest version from one
 *      snapshot, so the hash comparison cannot straddle a concurrent edit.
 *   2. `recordNextVersion` — allocate the version number and insert the ledger
 *      row together, serialised against other publishers of this map.
 *   3. `setPublished` — point the map at the version and write the pointer
 *      object, under the same per-map lock and guarded so that a slower,
 *      older publish can never move the map or the pointer backwards.
 */
export async function publishMap(repo: MapRepo, store: ArtifactStore, input: PublishInput): Promise<PublishOutcome> {
  const decision = authorizePublish(input.ctx);
  if (!decision.allowed) return { status: "forbidden", reason: decision.reason! };

  // 1 — one consistent read
  const snapshot = await repo.loadForPublish(input.ctx, input.mapId);
  if (!snapshot) return { status: "not_found" };
  const { doc, features, latest } = snapshot;
  if (doc.archived) return { status: "forbidden", reason: ARCHIVED_REASON };

  const publishedAt = input.now ? input.now() : new Date().toISOString();
  const draft = { mapId: doc.id, title: doc.title, uiDir: doc.uiDir, settings: doc.settings, features };
  // The hash leaves out the version number and the time, so it can be
  // compared before a number is allocated.
  const etag = etagFor(publishHash(buildArtifact(draft, 0, publishedAt)));

  // No new version for content readers already have; they would re-download an
  // identical map and lose a warm cache. The draft at this revision now counts
  // as published, and the pointer is rewritten in case an earlier publish was
  // interrupted after its artifact but before its pointer.
  if (latest && latest.etag === etag) {
    await repo.confirmPublishedRev(input.ctx, doc.id, { version: latest.version, rev: doc.rev });
    await writePointer(store, input, doc.slug, latest);
    return { status: "unchanged", version: latest.version, etag: latest.etag };
  }

  const full = versionQuota(input.maxVersions, latest);
  if (full) return full;

  // 2 — ledger. The callback runs inside the allocating transaction, because
  // the storage key and the byte count both depend on the number it assigns.
  let body = "";
  const record = await repo.recordNextVersion(input.ctx, input.mapId, (version) => {
    const artifact = buildArtifact(draft, version, publishedAt);
    body = canonicalJson(artifact);
    return {
      etag,
      storageKey: keys.version(input.tenantSlug, doc.slug, version),
      byteSize: Buffer.byteLength(body, "utf8"),
      featureCount: artifact.features.length,
      publishedAt,
      sourceRev: doc.rev,
      origin: { type: "publish", rev: doc.rev },
    } satisfies VersionDraft;
  });
  // The map was archived or deleted between the read and the allocation.
  if (!record) return { status: "not_found" };

  // 3 — the immutable artifact, then the map and its pointer.
  await store.put(record.storageKey, body, { contentType: JSON_TYPE, cacheControl: VERSION_CACHE_CONTROL, etag: record.etag });
  await repo.setPublished(input.ctx, doc.id, { version: record.version, rev: doc.rev }, () =>
    writePointer(store, input, doc.slug, record),
  );
  return { status: "published", version: record };
}

/** The pointer object readers poll. `etag` in the body is the artifact's, quoted as on the wire. */
async function writePointer(store: ArtifactStore, input: PublishInput, mapSlug: string, live: VersionRow): Promise<void> {
  const body = pointerBody({
    version: live.version,
    url: artifactUrl(input.artifactBase, live.storageKey),
    etag: live.etag,
    updatedAt: live.publishedAt,
  });
  await store.put(keys.pointer(input.tenantSlug, mapSlug), canonicalJson(body), {
    contentType: JSON_TYPE,
    cacheControl: POINTER_CACHE_CONTROL,
    // The pointer's own validator changes whenever the live version does.
    etag: etagFor(`${live.etag.replaceAll('"', "")}-v${live.version}`),
  });
}

function versionQuota(max: number | null | undefined, latest: VersionRow | null): PublishOutcome | null {
  if (max === null || max === undefined || !latest || latest.version < max) return null;
  return { status: "quota", reason: `A map in this workspace can have ${max} published versions, and this one has reached it.` };
}

/**
 * Republishes an earlier version's content as a new version; the ledger stays
 * append-only and the draft is left alone. The map's live revision becomes the
 * one the restored content was built from.
 */
export async function rollbackMap(
  repo: MapRepo,
  store: ArtifactStore,
  input: PublishInput & { readonly toVersion: number },
): Promise<PublishOutcome> {
  const decision = authorizePublish(input.ctx);
  if (!decision.allowed) return { status: "forbidden", reason: decision.reason! };

  const loaded = await repo.getMap(input.ctx, input.mapId);
  if (!loaded) return { status: "not_found" };
  const doc = loaded.map;
  if (doc.archived) return { status: "forbidden", reason: ARCHIVED_REASON };

  // The key comes from the ledger row, not from rebuilding it out of today's
  // slugs: the row records where the bytes actually went.
  const target = await repo.getVersion(input.ctx, input.mapId, input.toVersion);
  if (!target) return { status: "not_found" };
  const source = await store.get(target.storageKey);
  if (!source) return { status: "not_found" };

  const full = versionQuota(input.maxVersions, await repo.getLatestVersion(input.ctx, input.mapId));
  if (full) return full;

  const previous = JSON.parse(source.body) as MapVersion;
  const publishedAt = input.now ? input.now() : new Date().toISOString();
  let body = "";
  const record = await repo.recordNextVersion(input.ctx, input.mapId, (version) => {
    body = canonicalJson({ ...previous, version, publishedAt });
    return {
      // Same content, same etag: a reader already holding it keeps its cache.
      etag: target.etag,
      storageKey: keys.version(input.tenantSlug, doc.slug, version),
      byteSize: Buffer.byteLength(body, "utf8"),
      featureCount: previous.features.length,
      publishedAt,
      sourceRev: target.sourceRev,
      origin: { type: "rollback", fromVersion: target.version },
    } satisfies VersionDraft;
  });
  if (!record) return { status: "not_found" };

  await store.put(record.storageKey, body, { contentType: JSON_TYPE, cacheControl: VERSION_CACHE_CONTROL, etag: record.etag });
  await repo.setPublished(input.ctx, doc.id, { version: record.version, rev: target.sourceRev }, () =>
    writePointer(store, input, doc.slug, record),
  );
  return { status: "published", version: record };
}

/** Version rows whose artifact is missing — an interrupted publish. For a periodic sweep. */
export async function findOrphanedVersions(store: ArtifactStore, records: readonly VersionRow[]): Promise<VersionRow[]> {
  const out: VersionRow[] = [];
  for (const r of records) if (!(await store.has(r.storageKey))) out.push(r);
  return out;
}
