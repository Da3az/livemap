import type { FeatureKind, MapFeature, MapSettings, MapVersion, RichText } from "@/model/types";
import { deepEqual } from "./doc";
import { legendEntries } from "./legend";
import { sortKeyed } from "./ordering";
import { presetLookup, resolveStyle, type PresetLookup } from "./style";
import { bi, type Bilingual } from "./text";

/** What about a feature differs between two versions. */
export type FeatureAspect = "geometry" | "style" | "text" | "dates" | "order" | "group";

/** What each aspect is called in the diff list. */
export const ASPECT_LABELS: Record<FeatureAspect, Bilingual> = {
  geometry: bi("Shape or position", "الشكل أو الموقع"),
  style: bi("Style", "النمط"),
  text: bi("Name or text", "الاسم أو النص"),
  dates: bi("Dates", "التواريخ"),
  order: bi("Draw order", "ترتيب الرسم"),
  group: bi("Group", "المجموعة"),
};

/** A feature present in only one of the two versions. */
export interface DiffFeature {
  id: string;
  kind: FeatureKind;
  name: RichText;
  feature: MapFeature;
}

/** A feature present in both versions that is not the same in both. */
export interface ChangedFeature {
  id: string;
  kind: FeatureKind;
  /** The name in the newer version. */
  name: RichText;
  before: MapFeature;
  after: MapFeature;
  /** In a fixed order: geometry, style, text, dates, order, group. */
  aspects: FeatureAspect[];
}

/** The part of the map settings a change belongs to. */
export type SettingArea =
  | "title"
  | "direction"
  | "titleBlock"
  | "legend"
  | "basemap"
  | "openingView"
  | "presets"
  | "groups"
  | "timeline"
  | "embed";

/** One changed part of the settings, with what changed in words. */
export interface SettingChange {
  area: SettingArea;
  /** The heading: "Title block". */
  label: Bilingual;
  /** One line per change: "Source changed", "Basemap: positron → dark". */
  details: Bilingual[];
}

/** The difference between two published versions, ready to list. */
export interface VersionDiff {
  fromVersion: number;
  toVersion: number;
  /** In the newer version only; topmost first. */
  added: DiffFeature[];
  /** In the older version only; topmost first. */
  removed: DiffFeature[];
  /** In both and different; topmost first by the newer version. */
  changed: ChangedFeature[];
  /** Changed settings in a fixed order: title, direction, title block, legend, basemap, then the rest. */
  settings: SettingChange[];
  counts: { added: number; removed: number; changed: number; settings: number };
  /** True when nothing differs. */
  identical: boolean;
}

function geometryOf(feature: MapFeature): unknown {
  switch (feature.kind) {
    case "area":
      return feature.rings;
    case "line":
    case "frontline":
      return feature.path;
    case "arrow":
      return [feature.control, feature.curvature, feature.bend ?? "left"];
    case "point":
      return feature.at;
    case "annotation":
      return [feature.anchor, feature.textAt];
  }
}

function styleOf(feature: MapFeature, presets: PresetLookup): unknown {
  const { fill, stroke, color } = resolveStyle(feature, presets);
  const shared = { fill, stroke, color, labelStyle: feature.labelStyle ?? null };
  switch (feature.kind) {
    case "area":
    case "line":
      return shared;
    case "arrow":
      return { ...shared, head: feature.head, tapered: feature.tapered };
    case "frontline":
      return {
        ...shared,
        facing: feature.facing,
        toothShape: feature.toothShape,
        toothSpacing: feature.toothSpacing,
        toothSize: feature.toothSize,
      };
    case "point":
      return { ...shared, symbol: feature.symbol, size: feature.size };
    case "annotation":
      return { ...shared, leader: feature.leader };
  }
}

function textOf(feature: MapFeature): unknown {
  return [feature.name, feature.label ?? null, feature.kind === "annotation" ? feature.text : null];
}

/** Ids whose position relative to the others changed: those outside the longest run that kept its order. */
function reordered(before: readonly string[], after: readonly string[]): Set<string> {
  const rank = new Map(before.map((id, index) => [id, index]));
  const sequence: number[] = [];
  const ids: string[] = [];
  for (const id of after) {
    const index = rank.get(id);
    if (index !== undefined) {
      sequence.push(index);
      ids.push(id);
    }
  }
  /* Longest increasing subsequence by patience sorting, with back-pointers. */
  const tails: number[] = [];
  const previous: number[] = [];
  for (let i = 0; i < sequence.length; i++) {
    const value = sequence[i] ?? 0;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sequence[tails[mid] ?? 0] ?? 0) < value) lo = mid + 1;
      else hi = mid;
    }
    previous[i] = lo > 0 ? (tails[lo - 1] ?? -1) : -1;
    tails[lo] = i;
  }
  const kept = new Set<number>();
  for (let i = tails[tails.length - 1] ?? -1; i >= 0; i = previous[i] ?? -1) kept.add(i);
  const moved = new Set<string>();
  ids.forEach((id, index) => {
    if (!kept.has(index)) moved.add(id);
  });
  return moved;
}

function quote(text: RichText | null): string {
  return text === null || text.value === "" ? "—" : `“${text.value}”`;
}

function fromTo(en: string, ar: string, before: string, after: string): Bilingual {
  return bi(`${en}: ${before} → ${after}`, `${ar}: ${before} ← ${after}`);
}

function named<T extends { id: string; name: RichText }>(
  before: readonly T[],
  after: readonly T[],
  words: { added: Bilingual; removed: Bilingual; renamed: Bilingual; changed: Bilingual },
  comparable: (item: T) => unknown,
): Bilingual[] {
  const details: Bilingual[] = [];
  const old = new Map(before.map((item) => [item.id, item]));
  const current = new Set(after.map((item) => item.id));
  for (const item of after) {
    const was = old.get(item.id);
    if (was === undefined) {
      details.push(bi(`${words.added.en} ${quote(item.name)}`, `${words.added.ar} ${quote(item.name)}`));
      continue;
    }
    if (!deepEqual(was.name, item.name)) {
      details.push(fromTo(words.renamed.en, words.renamed.ar, quote(was.name), quote(item.name)));
    }
    if (!deepEqual(comparable(was), comparable(item))) {
      details.push(bi(`${words.changed.en} ${quote(item.name)}`, `${words.changed.ar} ${quote(item.name)}`));
    }
  }
  for (const item of before) {
    if (!current.has(item.id)) {
      details.push(bi(`${words.removed.en} ${quote(item.name)}`, `${words.removed.ar} ${quote(item.name)}`));
    }
  }
  return details;
}

function settingsDiff(older: MapVersion, newer: MapVersion): SettingChange[] {
  const out: SettingChange[] = [];
  const add = (area: SettingArea, label: Bilingual, details: Bilingual[]): void => {
    if (details.length > 0) out.push({ area, label, details });
  };
  const a: MapSettings = older.settings;
  const b: MapSettings = newer.settings;

  add(
    "title",
    bi("Title", "العنوان"),
    deepEqual(older.title, newer.title) ? [] : [fromTo("Title", "العنوان", quote(older.title), quote(newer.title))],
  );
  add(
    "direction",
    bi("Direction", "الاتجاه"),
    older.uiDir === newer.uiDir
      ? []
      : [
          newer.uiDir === "rtl"
            ? bi("Now right to left", "أصبح من اليمين إلى اليسار")
            : bi("Now left to right", "أصبح من اليسار إلى اليمين"),
        ],
  );

  const block: Bilingual[] = [];
  if (a.titleBlock.show !== b.titleBlock.show) {
    block.push(b.titleBlock.show ? bi("Title block shown", "إظهار الترويسة") : bi("Title block hidden", "إخفاء الترويسة"));
  }
  const blockFields = [
    ["subtitle", bi("Subtitle", "العنوان الفرعي")],
    ["source", bi("Source", "المصدر")],
    ["credit", bi("Credit", "الإسناد")],
    ["note", bi("Note", "الملاحظة")],
  ] as const;
  for (const [field, word] of blockFields) {
    if (!deepEqual(a.titleBlock[field], b.titleBlock[field])) {
      block.push(fromTo(word.en, word.ar, quote(a.titleBlock[field]), quote(b.titleBlock[field])));
    }
  }
  if (a.titleBlock.asOf !== b.titleBlock.asOf) {
    block.push(fromTo("“As of” time", "وقت «حتى تاريخ»", a.titleBlock.asOf ?? "—", b.titleBlock.asOf ?? "—"));
  }
  add("titleBlock", bi("Title block", "الترويسة"), block);

  const key: Bilingual[] = [];
  if (a.legend.show !== b.legend.show) {
    key.push(b.legend.show ? bi("Map key shown", "إظهار مفتاح الخريطة") : bi("Map key hidden", "إخفاء مفتاح الخريطة"));
  }
  if (!deepEqual(a.legend.title, b.legend.title)) {
    key.push(fromTo("Key title", "عنوان المفتاح", quote(a.legend.title), quote(b.legend.title)));
  }
  if (a.legend.position !== b.legend.position) key.push(bi("Key moved to another corner", "نقل المفتاح إلى زاوية أخرى"));
  const shown = (version: MapVersion): { key: string; label: RichText }[] =>
    legendEntries(version.settings, version.features)
      .filter((entry) => !entry.hidden)
      .map((entry) => ({ key: entry.key, label: entry.label }));
  const entriesBefore = shown(older);
  const entriesAfter = shown(newer);
  if (!deepEqual(entriesBefore, entriesAfter)) {
    const before = new Map(entriesBefore.map((entry) => [entry.key, entry.label]));
    const after = new Map(entriesAfter.map((entry) => [entry.key, entry.label]));
    let itemised = false;
    for (const entry of entriesAfter) {
      const was = before.get(entry.key);
      if (was === undefined) key.push(bi(`Entry added: ${quote(entry.label)}`, `إضافة عنصر: ${quote(entry.label)}`));
      else if (!deepEqual(was, entry.label)) key.push(fromTo("Entry relabelled", "تغيير تسمية عنصر", quote(was), quote(entry.label)));
      else continue;
      itemised = true;
    }
    for (const entry of entriesBefore) {
      if (after.has(entry.key)) continue;
      key.push(bi(`Entry removed: ${quote(entry.label)}`, `إزالة عنصر: ${quote(entry.label)}`));
      itemised = true;
    }
    if (!itemised) key.push(bi("Entries reordered", "إعادة ترتيب العناصر"));
  }
  add("legend", bi("Map key", "مفتاح الخريطة"), key);

  const basemap: Bilingual[] = [];
  if (a.basemap.styleId !== b.basemap.styleId) {
    basemap.push(fromTo("Basemap", "خريطة الأساس", a.basemap.styleId, b.basemap.styleId));
  }
  if (a.basemap.labelLanguage !== b.basemap.labelLanguage) {
    basemap.push(fromTo("Label language", "لغة التسميات", a.basemap.labelLanguage, b.basemap.labelLanguage));
  }
  add("basemap", bi("Basemap", "خريطة الأساس"), basemap);

  add(
    "openingView",
    bi("Opening view", "العرض الافتتاحي"),
    deepEqual(a.openingView, b.openingView) ? [] : [bi("Opening view changed", "تغيّر العرض الافتتاحي")],
  );
  add(
    "presets",
    bi("Style presets", "الأنماط المحفوظة"),
    named(
      a.presets,
      b.presets,
      {
        added: bi("Preset added:", "إضافة نمط:"),
        removed: bi("Preset removed:", "حذف نمط:"),
        renamed: bi("Preset renamed", "إعادة تسمية نمط"),
        changed: bi("Preset restyled:", "تغيير مظهر نمط:"),
      },
      (preset) => ({ ...preset, name: null }),
    ),
  );
  add(
    "groups",
    bi("Groups", "المجموعات"),
    named(
      a.groups,
      b.groups,
      {
        added: bi("Group added:", "إضافة مجموعة:"),
        removed: bi("Group removed:", "حذف مجموعة:"),
        renamed: bi("Group renamed", "إعادة تسمية مجموعة"),
        changed: bi("Group changed:", "تغيير مجموعة:"),
      },
      () => null,
    ),
  );

  const timeline: Bilingual[] = [];
  if (a.timeline.enabled !== b.timeline.enabled) {
    timeline.push(b.timeline.enabled ? bi("Timeline turned on", "تفعيل الخط الزمني") : bi("Timeline turned off", "إيقاف الخط الزمني"));
  }
  if (a.timeline.mode !== b.timeline.mode) timeline.push(fromTo("Mode", "الوضع", a.timeline.mode, b.timeline.mode));
  if (a.timeline.speed !== b.timeline.speed) {
    timeline.push(fromTo("Playback speed", "سرعة التشغيل", String(a.timeline.speed), String(b.timeline.speed)));
  }
  if (a.timeline.windowMs !== b.timeline.windowMs) {
    const hours = (ms: number): string => String(Math.round((ms / 3_600_000) * 10) / 10);
    timeline.push(
      bi(
        `Window: ${hours(a.timeline.windowMs)} h → ${hours(b.timeline.windowMs)} h`,
        `النافذة: ${hours(a.timeline.windowMs)} س ← ${hours(b.timeline.windowMs)} س`,
      ),
    );
  }
  add("timeline", bi("Timeline", "الخط الزمني"), timeline);

  add(
    "embed",
    bi("Embed options", "خيارات التضمين"),
    deepEqual(a.embed, b.embed) ? [] : [bi("Embed options changed", "تغيّرت خيارات التضمين")],
  );
  return out;
}

/**
 * Compare two published versions. `older` and `newer` name the roles, not a
 * requirement: any two versions of the same map can be compared.
 *
 * Style is compared as drawn, through each version's presets, so restyling a
 * preset marks every feature that follows it. Order is compared by position
 * relative to the other features, so re-spaced keys alone are not a change
 * and one moved feature is reported as one.
 */
export function diffVersions(older: MapVersion, newer: MapVersion): VersionDiff {
  const before = sortKeyed(older.features);
  const after = sortKeyed(newer.features);
  const beforeById = new Map(before.map((feature) => [feature.id, feature]));
  const afterIds = new Set(after.map((feature) => feature.id));
  const presetsBefore = presetLookup(older.settings.presets);
  const presetsAfter = presetLookup(newer.settings.presets);
  const moved = reordered(
    before.map((feature) => feature.id),
    after.map((feature) => feature.id),
  );

  const added: DiffFeature[] = [];
  const changed: ChangedFeature[] = [];
  for (let i = after.length - 1; i >= 0; i--) {
    const feature = after[i];
    if (feature === undefined) continue;
    const was = beforeById.get(feature.id);
    if (was === undefined) {
      added.push({ id: feature.id, kind: feature.kind, name: feature.name, feature });
      continue;
    }
    const aspects: FeatureAspect[] = [];
    const kindChanged = was.kind !== feature.kind;
    if (kindChanged || !deepEqual(geometryOf(was), geometryOf(feature))) aspects.push("geometry");
    if (kindChanged || !deepEqual(styleOf(was, presetsBefore), styleOf(feature, presetsAfter))) aspects.push("style");
    if (!deepEqual(textOf(was), textOf(feature))) aspects.push("text");
    if (was.validFrom !== feature.validFrom || was.validTo !== feature.validTo || was.lineageId !== feature.lineageId) {
      aspects.push("dates");
    }
    if (moved.has(feature.id)) aspects.push("order");
    if (was.groupId !== feature.groupId) aspects.push("group");
    if (aspects.length > 0) {
      changed.push({ id: feature.id, kind: feature.kind, name: feature.name, before: was, after: feature, aspects });
    }
  }
  const removed: DiffFeature[] = [];
  for (let i = before.length - 1; i >= 0; i--) {
    const feature = before[i];
    if (feature !== undefined && !afterIds.has(feature.id)) {
      removed.push({ id: feature.id, kind: feature.kind, name: feature.name, feature });
    }
  }

  const settings = settingsDiff(older, newer);
  return {
    fromVersion: older.version,
    toVersion: newer.version,
    added,
    removed,
    changed,
    settings,
    counts: { added: added.length, removed: removed.length, changed: changed.length, settings: settings.length },
    identical: added.length + removed.length + changed.length + settings.length === 0,
  };
}
