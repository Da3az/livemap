/**
 * What the publish pipeline does to a draft: drop what is editor-only, order
 * the features, and derive the content hash, etag and byte size of the
 * artifact. The real pipeline lives on the server; see INTEGRATION.md.
 */
import { compareOrder } from "@/model/order";
import type { MapFeature, MapSettings, MapVersion, RichText, TextDir } from "@/model/types";

export const VERSION_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const POINTER_CACHE_CONTROL = "public, max-age=5, stale-while-revalidate=30";

export interface Publishable {
  mapId: string;
  title: RichText;
  uiDir: Exclude<TextDir, "auto">;
  settings: MapSettings;
  features: MapFeature[];
}

/**
 * The artifact for a draft. Hidden features, and features in a hidden group,
 * are left out. `hidden` and `locked` do not exist for a reader, so they are
 * reset on everything that remains, as is each group's collapsed state.
 */
export function buildArtifact(draft: Publishable, version: number, publishedAt: string): MapVersion {
  const hiddenGroups = new Set(draft.settings.groups.filter((g) => g.hidden).map((g) => g.id));
  const features = draft.features
    .filter((f) => !f.hidden && !(f.groupId !== null && hiddenGroups.has(f.groupId)))
    .map((f): MapFeature => ({ ...f, hidden: false, locked: false }))
    .sort(compareOrder);
  const published = new Set(features.map((f) => f.id));
  const settings: MapSettings = {
    ...draft.settings,
    groups: draft.settings.groups
      .filter((g) => !g.hidden)
      .map((g) => ({ ...g, hidden: false, locked: false, collapsed: false })),
    legend: {
      ...draft.settings.legend,
      items: draft.settings.legend.items.filter((item) => !("featureId" in item.ref) || published.has(item.ref.featureId)),
    },
  };
  return { mapId: draft.mapId, version, title: draft.title, uiDir: draft.uiDir, settings, features, publishedAt };
}

/** JSON with object keys sorted, so equal content always gives equal text. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A 53-bit string hash (cyrb53). Enough to tell two artifacts apart in a mock. */
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

/**
 * What decides "has anything publishable changed". It covers the title,
 * direction, settings and features, and leaves out the version number, the
 * publish time and who last touched each feature.
 */
export function contentHash(artifact: MapVersion): string {
  return digest(
    stableStringify({
      title: artifact.title,
      uiDir: artifact.uiDir,
      settings: artifact.settings,
      features: artifact.features.map(({ updatedAt: _at, updatedBy: _by, ...rest }) => rest),
    }),
  );
}

/** The stored object's etag and size, as an object store would report them. */
export function measure(artifact: MapVersion): { etag: string; byteSize: number } {
  const body = JSON.stringify(artifact);
  return { etag: `"${digest(body)}"`, byteSize: new TextEncoder().encode(body).length };
}

export function versionKey(tenantSlug: string, mapSlug: string, version: number): string {
  return `t/${tenantSlug}/${mapSlug}/v${version}.json`;
}

export function pointerKey(tenantSlug: string, mapSlug: string): string {
  return `t/${tenantSlug}/${mapSlug}/latest.json`;
}
