// Immutable published artifacts for the CDN read path. Readers poll with
// `If-None-Match`, so hashing must be deterministic across processes and
// machines or the 304s stop.

import type { MapDoc, MapFeature, MapVersion } from "./types.js";
import { compareOrder } from "./order.js";

/**
 * Keys sorted at every level. `JSON.stringify` preserves insertion order, so
 * two identical features built by different code paths would hash differently.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    // Drop undefined so `{a:1, b:undefined}` and `{a:1}` hash identically.
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * 128-bit FNV-1a-derived content hash, as 32 lowercase hex chars. NOT
 * cryptographic — a cache key, not a signature. Chosen over SHA-256 so it runs
 * synchronously in both Node and the browser without `crypto.subtle`.
 */
export function contentHash(input: string): string {
  const seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  const lanes = new Uint32Array(seeds);

  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    for (let l = 0; l < 4; l++) {
      let h = lanes[l]!;
      h ^= c + l;
      // h *= 16777619, in 32-bit integer math.
      h = Math.imul(h, 0x01000193);
      // Avalanche, so adjacent inputs do not produce adjacent hashes.
      h ^= h >>> 13;
      lanes[l] = h >>> 0;
    }
  }

  let out = "";
  for (let l = 0; l < 4; l++) {
    out += (lanes[l]! >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

/** Strong ETag, quoted per RFC 9110. */
export const etagFor = (hash: string): string => `"${hash}"`;

export interface BuildVersionInput {
  readonly doc: MapDoc;
  readonly features: readonly MapFeature[];
  readonly version: number;
  readonly publishedBy: string;
  readonly publishedAt?: string;
}

/**
 * Features are sorted by order key so the artifact is byte-stable whatever
 * order rows came back in. `publishedAt`/`publishedBy` are excluded from the
 * hash: republishing an unchanged map must return the same ETag.
 */
export function buildVersion(input: BuildVersionInput): MapVersion {
  const { doc, version, publishedBy } = input;
  const features = [...input.features].sort(compareOrder);

  const hashable = {
    features,
    viewport: doc.viewport,
    basemap: doc.basemap,
    title: doc.title,
    uiDir: doc.uiDir,
  };

  return {
    mapId: doc.id,
    version,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    publishedBy,
    title: doc.title,
    viewport: doc.viewport,
    basemap: doc.basemap,
    uiDir: doc.uiDir,
    features,
    etag: contentHash(canonicalJson(hashable)),
  };
}

/**
 * Two objects, two policies: the versioned artifact (`/v/{n}.json`) is
 * immutable and gets a long max-age; the pointer (`/latest.json`) gets a short
 * TTL plus `stale-while-revalidate`, matching the BBC's live results pages.
 */
export interface CachePolicy {
  readonly cacheControl: string;
  readonly etag: string;
}

export function versionedCachePolicy(etag: string): CachePolicy {
  return {
    cacheControl: "public, max-age=31536000, immutable",
    etag: etagFor(etag),
  };
}

export function pointerCachePolicy(
  etag: string,
  maxAgeSeconds = 5,
): CachePolicy {
  return {
    cacheControl: `public, max-age=${maxAgeSeconds}, stale-while-revalidate=30, stale-if-error=90`,
    etag: etagFor(etag),
  };
}

/** The document readers poll. Kept small on purpose. */
export interface LatestPointer {
  readonly mapId: string;
  readonly version: number;
  readonly etag: string;
  readonly publishedAt: string;
  /** Path to the immutable artifact, relative to the map's CDN prefix. */
  readonly href: string;
}

export function pointerFor(v: MapVersion): LatestPointer {
  return {
    mapId: v.mapId,
    version: v.version,
    etag: v.etag,
    publishedAt: v.publishedAt,
    href: `v/${v.version}.json`,
  };
}
