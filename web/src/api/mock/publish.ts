/**
 * What the publish pipeline does to a draft: drop what is editor-only, order
 * the features, and derive the content hash, etag and byte size of the
 * artifact. The real pipeline lives on the server; see INTEGRATION.md.
 */
import { buildArtifact as buildCoreArtifact, publishHash, type Publishable as CorePublishable, type PublishedFeature } from "@livemap/core";
import { fromArtifact } from "@/model/published";
import type { MapFeature, MapVersion } from "@/model/types";

export { POINTER_CACHE_CONTROL, VERSION_CACHE_CONTROL } from "@livemap/core";

export type Publishable = CorePublishable & { features: MapFeature[] };

/** The artifact for a draft, built by the same rules the server publishes with (@livemap/core). */
export function buildArtifact(draft: Publishable, version: number, publishedAt: string): MapVersion {
  return fromArtifact(buildCoreArtifact(draft, version, publishedAt));
}

/** What decides "has anything publishable changed": the server's hash over what readers receive. */
export function contentHash(artifact: MapVersion): string {
  return publishHash({ ...artifact, features: artifact.features.map(({ updatedAt: _at, updatedBy: _by, ...rest }) => rest) as PublishedFeature[] });
}

/** A 53-bit string hash (cyrb53). Enough to tell two stored objects apart in a mock. */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function digest(text: string): string {
  return cyrb53(text, 1).toString(16).padStart(14, "0") + cyrb53(text, 2).toString(16).padStart(14, "0");
}

/** The stored object's etag and size, as an object store would report them. */
export function measure(artifact: MapVersion): { etag: string; byteSize: number } {
  const body = JSON.stringify(artifact);
  return { etag: `"${digest(body)}"`, byteSize: new TextEncoder().encode(body).length };
}

/** The server's object key layout (packages/api/src/storage.ts). */
export function versionKey(tenantSlug: string, mapSlug: string, version: number): string {
  return `t/${tenantSlug}/m/${mapSlug}/v/${version}.json`;
}

export function pointerKey(tenantSlug: string, mapSlug: string): string {
  return `t/${tenantSlug}/m/${mapSlug}/latest.json`;
}
