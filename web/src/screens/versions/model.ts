import type { MapDoc, MapFeature, MapVersion, Session, VersionRecord } from "@/model/types";

/* ------------------------------------------------------------- formatting */

const number = new Intl.NumberFormat("en-GB");

/** "812 B", "48.2 KB", "1.31 MB": decimal units, as object stores bill and browsers report. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${number.format(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 100_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

/** An etag without its quotes, cut to what tells two apart at a glance. */
export function shortEtag(etag: string): string {
  const bare = etag.replace(/^W\//, "").replaceAll('"', "");
  return bare.length > 10 ? `${bare.slice(0, 10)}…` : bare;
}

function duration(seconds: number): string {
  if (seconds >= 31_536_000) return `${Math.round(seconds / 31_536_000)} y`;
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)} d`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${seconds} s`;
}

/** A Cache-Control header in the few words that matter: "immutable · 1 y", "5 s, stale for 30 s". */
export function cachePolicy(header: string): string {
  const maxAge = /max-age=(\d+)/.exec(header);
  const stale = /stale-while-revalidate=(\d+)/.exec(header);
  const parts: string[] = [];
  if (header.includes("immutable")) parts.push("immutable");
  if (maxAge?.[1]) parts.push(duration(Number(maxAge[1])));
  const short = parts.join(" · ");
  return stale?.[1] ? `${short}, stale for ${duration(Number(stale[1]))}` : short;
}

/* ---------------------------------------------------------------- sorting */

export type SortKey = "version" | "when" | "by" | "features" | "size";
export interface Sort {
  key: SortKey;
  descending: boolean;
}
export const DEFAULT_SORT: Sort = { key: "version", descending: true };

export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, descending: !current.descending };
  return { key, descending: key !== "by" };
}

const collator = new Intl.Collator(["en", "ar"], { sensitivity: "base" });

export function sortVersions(versions: readonly VersionRecord[], sort: Sort): VersionRecord[] {
  const compare = (a: VersionRecord, b: VersionRecord): number => {
    switch (sort.key) {
      case "version":
        return a.version - b.version;
      case "when":
        return Date.parse(a.publishedAt) - Date.parse(b.publishedAt);
      case "by":
        return collator.compare(a.publishedBy.name, b.publishedBy.name) || a.version - b.version;
      case "features":
        return a.featureCount - b.featureCount || a.version - b.version;
      case "size":
        return a.byteSize - b.byteSize || a.version - b.version;
    }
  };
  const sorted = [...versions].sort(compare);
  return sort.descending ? sorted.reverse() : sorted;
}

/* ------------------------------------------------------------------ draft */

export type DraftState =
  | { kind: "never"; rev: number }
  | { kind: "level"; rev: number; version: number }
  | { kind: "ahead"; rev: number; publishedRev: number; version: number };

export function draftState(map: Pick<MapDoc, "rev" | "publishedRev" | "publishedVersion">): DraftState {
  if (map.publishedVersion === null || map.publishedRev === null) return { kind: "never", rev: map.rev };
  if (map.rev > map.publishedRev) return { kind: "ahead", rev: map.rev, publishedRev: map.publishedRev, version: map.publishedVersion };
  return { kind: "level", rev: map.rev, version: map.publishedVersion };
}

/**
 * What publishing the draft now would produce, for comparing it with a
 * published version. The same rule the publish pipeline applies: hidden
 * features and hidden groups are left out, and editor-only flags are reset.
 */
export function draftArtifact(map: MapDoc, features: readonly MapFeature[]): MapVersion {
  const hiddenGroups = new Set(map.settings.groups.filter((group) => group.hidden).map((group) => group.id));
  const published = features
    .filter((feature) => !feature.hidden && !(feature.groupId !== null && hiddenGroups.has(feature.groupId)))
    .map((feature): MapFeature => ({ ...feature, hidden: false, locked: false }));
  const ids = new Set(published.map((feature) => feature.id));
  return {
    mapId: map.id,
    version: 0,
    title: map.title,
    uiDir: map.uiDir,
    settings: {
      ...map.settings,
      groups: map.settings.groups.filter((group) => !group.hidden).map((group) => ({ ...group, hidden: false, locked: false, collapsed: false })),
      legend: { ...map.settings.legend, items: map.settings.legend.items.filter((item) => !("featureId" in item.ref) || ids.has(item.ref.featureId)) },
    },
    features: published,
    publishedAt: map.updatedAt,
  };
}

/* ---------------------------------------------------------------- compare */

/** One side of a comparison: a published version, or the draft as it would publish. */
export type Side = number | "draft";

export function parseSide(value: string | null, known: ReadonlySet<number>, draftAllowed: boolean): Side | null {
  if (value === "draft") return draftAllowed ? "draft" : null;
  const version = Number(value);
  return value !== null && Number.isInteger(version) && known.has(version) ? version : null;
}

/**
 * The comparison that answers the question most likely being asked: what the
 * next publish would change when the draft is ahead, otherwise what the
 * latest publish changed.
 */
export function defaultSides(versions: readonly VersionRecord[], live: number | null, draftAhead: boolean): { from: Side; to: Side } | null {
  if (live !== null && draftAhead) return { from: live, to: "draft" };
  const numbers = versions.map((record) => record.version).sort((a, b) => b - a);
  const [latest, previous] = numbers;
  if (latest === undefined) return null;
  return { from: previous ?? latest, to: latest };
}

/** The version before this one in publishing order, or null for the first. */
export function previousVersion(versions: readonly VersionRecord[], version: number): number | null {
  const earlier = versions.map((record) => record.version).filter((candidate) => candidate < version);
  return earlier.length > 0 ? Math.max(...earlier) : null;
}

/* ------------------------------------------------------------ permissions */

export type RollbackBar = "role" | "archived" | "quota" | null;

/** Why a rollback cannot go ahead, when that is already known without asking the server. */
export function rollbackBar(session: Session, map: Pick<MapDoc, "archived">, versionCount: number): RollbackBar {
  if (!session.capabilities.includes("map:publish")) return "role";
  if (map.archived) return "archived";
  const limit = session.limits.maxVersionsPerMap;
  if (limit !== null && versionCount >= limit) return "quota";
  return null;
}

/* ------------------------------------------------------------- embed code */

export type EmbedSize = { kind: "ratio"; ratio: "16/9" | "4/3" | "1/1" | "4/5" } | { kind: "height"; px: number };
export interface EmbedOptions {
  size: EmbedSize;
  /** "map" leaves the theme to the map's own setting. */
  theme: "map" | "light" | "dark" | "auto";
  staticPicture: boolean;
  /** null leaves the key to the map's own setting. */
  key: boolean | null;
  /** The pan buttons beside the zoom buttons; null leaves them to the map's setting. */
  pan: boolean | null;
  lazy: boolean;
}

export const DEFAULT_EMBED: EmbedOptions = { size: { kind: "ratio", ratio: "16/9" }, theme: "map", staticPicture: false, key: null, pan: null, lazy: true };

/** The least height that leaves the map room under its title and over its credit; the timeline needs its own strip. */
export function embedMinHeight(timeline: boolean): number {
  return timeline ? 560 : 460;
}
/** Scripts to run at all; pop-ups so the credit line's links can open. No same-origin: the embed stores nothing. */
export const EMBED_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

export function embedUrl(origin: string, tenantSlug: string, mapSlug: string, options: EmbedOptions): string {
  const params = new URLSearchParams();
  if (options.theme !== "map") params.set("theme", options.theme);
  if (options.staticPicture) params.set("static", "1");
  if (options.key !== null) params.set("legend", options.key ? "1" : "0");
  if (options.pan !== null) params.set("pan", options.pan ? "1" : "0");
  const query = params.toString();
  return `${origin}/embed/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(mapSlug)}${query ? `?${query}` : ""}`;
}

function attribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/** One attribute of the embed code, in the order it is written. */
export interface EmbedAttribute {
  name: "src" | "title" | "style" | "loading" | "allow" | "sandbox" | "referrerpolicy";
  value: string;
}

export function embedAttributes(url: string, title: string, options: EmbedOptions, minHeight: number): EmbedAttribute[] {
  const size = options.size.kind === "ratio" ? `aspect-ratio:${options.size.ratio};min-height:${minHeight}px` : `height:${options.size.px}px`;
  return [
    { name: "src", value: url },
    { name: "title", value: title },
    { name: "style", value: `width:100%;${size};border:0` },
    ...(options.lazy ? [{ name: "loading" as const, value: "lazy" }] : []),
    { name: "allow", value: "fullscreen" },
    { name: "sandbox", value: EMBED_SANDBOX },
    { name: "referrerpolicy", value: "strict-origin-when-cross-origin" },
  ];
}

export function embedCode(url: string, title: string, options: EmbedOptions, minHeight: number): string {
  const attributes = embedAttributes(url, title, options, minHeight);
  return attributes.map((attr, index) => `${index === 0 ? "<iframe " : "  "}${attr.name}="${attribute(attr.value)}"${index === attributes.length - 1 ? "></iframe>" : ""}`).join("\n");
}
