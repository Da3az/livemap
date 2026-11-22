/**
 * The published artifact and everything derived from it. Readers poll with
 * `If-None-Match`, so hashing must be deterministic across processes and
 * machines or the 304s stop.
 */
import type { MapFeature, MapSettings, MapVersion, PublishedFeature, RichText, TextDir, VersionPointer } from "./model.js";
import { compareOrder } from "./order.js";

/**
 * Keys sorted at every level. `JSON.stringify` preserves insertion order, so
 * two identical features built by different code paths would hash differently.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(object).sort()) {
    const item = object[key];
    // Drop undefined so `{a:1, b:undefined}` and `{a:1}` hash identically.
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * 128-bit FNV-1a-derived content hash, as 32 lowercase hex chars. Not
 * cryptographic: a cache key, not a signature. Synchronous in Node and the
 * browser alike, so the editor's preview and the server agree without
 * `crypto.subtle`.
 */
export function contentHash(input: string): string {
  const lanes = new Uint32Array([0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]);
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    for (let l = 0; l < 4; l++) {
      let h = lanes[l] ?? 0;
      h ^= c + l;
      h = Math.imul(h, 0x01000193);
      // Avalanche, so adjacent inputs do not produce adjacent hashes.
      h ^= h >>> 13;
      lanes[l] = h >>> 0;
    }
  }
  let out = "";
  for (let l = 0; l < 4; l++) out += ((lanes[l] ?? 0) >>> 0).toString(16).padStart(8, "0");
  return out;
}

/** Strong ETag, quoted per RFC 9110. */
export const etagFor = (hash: string): string => `"${hash}"`;

export interface Publishable {
  mapId: string;
  title: RichText;
  uiDir: Exclude<TextDir, "auto">;
  settings: MapSettings;
  features: readonly MapFeature[];
}

/**
 * What a reader receives for a draft. Left out: hidden features, features in
 * a hidden group, hidden groups, legend entries for what was left out or that
 * the author hid, and who changed each feature and when. `hidden` and `locked`
 * are reset on what remains, as nothing is hidden or locked for a reader.
 * Features are sorted by draw order so the artifact is byte-stable whatever
 * order rows came back in.
 */
export function buildArtifact(draft: Publishable, version: number, publishedAt: string): MapVersion {
  const hiddenGroups = new Set(draft.settings.groups.filter((group) => group.hidden).map((group) => group.id));
  const features: PublishedFeature[] = draft.features
    .filter((feature) => !feature.hidden && !(feature.groupId !== null && hiddenGroups.has(feature.groupId)))
    .slice()
    .sort(compareOrder)
    .map((feature) => {
      const { updatedAt: _at, updatedBy: _by, ...rest } = feature;
      return { ...rest, hidden: false, locked: false } as PublishedFeature;
    });
  const published = new Set(features.map((feature) => feature.id));
  const usedPresets = new Set(features.map((feature) => feature.presetId).filter((id): id is string => id !== null));
  const legendPresets = new Set(
    draft.settings.legend.items.flatMap((item) => ("presetId" in item.ref && !item.hidden ? [item.ref.presetId] : [])),
  );
  const settings: MapSettings = {
    ...draft.settings,
    /* A preset nothing published uses, and no legend entry names, would only tell a reader about the draft. */
    presets: draft.settings.presets.filter((preset) => usedPresets.has(preset.id) || legendPresets.has(preset.id)),
    groups: draft.settings.groups.filter((group) => !group.hidden).map((group) => ({ ...group, hidden: false, locked: false })),
    legend: {
      ...draft.settings.legend,
      items: draft.settings.legend.items.filter(
        (item) => !item.hidden && (!("featureId" in item.ref) || published.has(item.ref.featureId)),
      ),
    },
  };
  return { mapId: draft.mapId, version, title: draft.title, uiDir: draft.uiDir, settings, features, publishedAt };
}

/**
 * What decides "has anything a reader sees changed": the artifact itself,
 * without its version number and publish time. Hashing the built artifact,
 * rather than the draft, means the hash covers exactly what readers receive
 * and nothing that only the editor holds.
 */
export function publishHash(artifact: MapVersion): string {
  const { version: _version, publishedAt: _at, ...content } = artifact;
  return contentHash(canonicalJson(content));
}

export const VERSION_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const POINTER_CACHE_CONTROL = "public, max-age=5, stale-while-revalidate=30, stale-if-error=90";

/** The body of `latest.json`. `etag` carries the same quoted value as the artifact's ETag header. */
export function pointerBody(input: { version: number | null; url: string; etag: string | null; updatedAt: string | null }): VersionPointer {
  return { version: input.version, url: input.url, etag: input.etag, cacheControl: POINTER_CACHE_CONTROL, updatedAt: input.updatedAt };
}
