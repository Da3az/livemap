/**
 * Settings travel as a patch (see `SettingsPatch`). The editor computes one
 * from its last saved settings and its current ones; the server applies it to
 * what it holds. Both use these two functions, so they cannot disagree.
 */
import type { KeyedChanges, SettingsPatch } from "./api.js";
import type { MapSettings } from "./model.js";

/** Structural equality for JSON-shaped values. Key order does not matter. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const other = Object.keys(right).filter((key) => right[key] !== undefined);
  if (keys.length !== other.length) return false;
  return keys.every((key) => deepEqual(left[key], right[key]));
}

const SECTIONS = ["basemap", "openingView", "legend", "titleBlock", "timeline", "embed"] as const;

function keyedChanges<T extends { id: string }>(before: readonly T[], after: readonly T[]): KeyedChanges<T> | null {
  const previous = new Map(before.map((item) => [item.id, item]));
  const next = new Set(after.map((item) => item.id));
  const put = after.filter((item) => {
    const old = previous.get(item.id);
    return old === undefined || !deepEqual(old, item);
  });
  const removed = before.filter((item) => !next.has(item.id)).map((item) => item.id);
  return put.length === 0 && removed.length === 0 ? null : { put, delete: removed };
}

/** What changed between two settings, or null when nothing did. */
export function settingsPatch(before: MapSettings, after: MapSettings): SettingsPatch | null {
  const patch: SettingsPatch = {};
  let any = false;
  for (const section of SECTIONS) {
    if (!deepEqual(before[section], after[section])) {
      (patch as Record<string, unknown>)[section] = after[section];
      any = true;
    }
  }
  const presets = keyedChanges(before.presets, after.presets);
  if (presets) {
    patch.presets = presets;
    any = true;
  }
  const groups = keyedChanges(before.groups, after.groups);
  if (groups) {
    patch.groups = groups;
    any = true;
  }
  return any ? patch : null;
}

function applyKeyed<T extends { id: string }>(items: readonly T[], changes: KeyedChanges<T> | undefined): T[] {
  if (!changes) return [...items];
  const removed = new Set(changes.delete);
  const replaced = new Map(changes.put.map((item) => [item.id, item]));
  const kept = items.filter((item) => !removed.has(item.id)).map((item) => replaced.get(item.id) ?? item);
  const present = new Set(kept.map((item) => item.id));
  /* New items keep the order the patch lists them in, after the ones already held. */
  const added = changes.put.filter((item) => !present.has(item.id) && !removed.has(item.id));
  return [...kept, ...added];
}

/** The settings after a patch. Sections it does not name are untouched. */
export function applySettingsPatch(settings: MapSettings, patch: SettingsPatch): MapSettings {
  return {
    basemap: patch.basemap ?? settings.basemap,
    openingView: patch.openingView ?? settings.openingView,
    legend: patch.legend ?? settings.legend,
    titleBlock: patch.titleBlock ?? settings.titleBlock,
    timeline: patch.timeline ?? settings.timeline,
    embed: patch.embed ?? settings.embed,
    presets: applyKeyed(settings.presets, patch.presets),
    groups: applyKeyed(settings.groups, patch.groups),
  };
}

const EMBED_DEFAULTS: MapSettings["embed"] = {
  legend: true,
  zoomButtons: true,
  panButtons: true,
  scaleBar: true,
  cooperativeGestures: true,
  static: false,
  theme: "auto",
};

/**
 * Settings as stored may predate a field the model has since gained; reading
 * them fills each missing field with its default, so every map has the whole
 * shape. Settings are one jsonb column, so a new field needs no migration.
 */
export function normaliseSettings(settings: MapSettings): MapSettings {
  return { ...settings, embed: { ...EMBED_DEFAULTS, ...settings.embed } };
}
