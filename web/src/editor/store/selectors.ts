import type { ToolId } from "@/editor/controller";
import type { FeatureGroup, FeatureKind, IsoDateTime, MapFeature, RichText, Session, StylePreset } from "@/model/types";
import { controllerDrawDefaults, type DrawDefaults } from "./defaults";
import { changeSet, type ChangeSet, type Doc } from "./doc";
import { legendEntries, type LegendEntry } from "./legend";
import { sortKeyed } from "./ordering";
import type { EditorState, HistoryState, MapMeta } from "./state";
import { presetLookup, resolveStyle, swatchOf, type PresetLookup, type ResolvedStyle, type Swatch } from "./style";
import type { Bilingual } from "./text";
import {
  isValidInWindow,
  timeExtent,
  timeHistogram,
  timeWindowFor,
  type TimeBucket,
  type TimeExtent,
  type TimeWindow,
} from "./time";

/**
 * Remember the last result: called again with the same arguments (by
 * identity), the same object comes back. Every selector here is built on it,
 * so selectors are safe to run on each store change and their results are
 * stable snapshots for `useEditorStore`.
 */
export function memoLast<Args extends readonly unknown[], Result>(compute: (...args: Args) => Result): (...args: Args) => Result {
  let cache: { args: Args; result: Result } | null = null;
  return (...args: Args): Result => {
    const hit = cache;
    if (hit !== null && hit.args.length === args.length && args.every((arg, i) => Object.is(arg, hit.args[i]))) {
      return hit.result;
    }
    const result = compute(...args);
    cache = { args, result };
    return result;
  };
}

/* ------------------------------------------------------------ draw order */

const drawOrder = memoLast((features: Doc["features"]) => sortKeyed(features.values()));

/** Every feature in draw order, bottom first. The array is the same object until a feature changes. */
export function selectDrawOrder(state: EditorState): MapFeature[] {
  return drawOrder(state.doc.features);
}

/** One feature by id. */
export function selectFeature(state: EditorState, id: string): MapFeature | undefined {
  return state.doc.features.get(id);
}

const presetIndex = memoLast((presets: readonly StylePreset[]) => presetLookup(presets));

/** Presets by id. */
export function selectPresetLookup(state: EditorState): PresetLookup {
  return presetIndex(state.doc.settings.presets);
}

/** The style a feature is drawn with, through its preset. null when the feature does not exist. */
export function selectResolvedStyle(state: EditorState, id: string): ResolvedStyle | null {
  const feature = state.doc.features.get(id);
  return feature === undefined ? null : resolveStyle(feature, selectPresetLookup(state));
}

/* -------------------------------------------------------------- list tree */

/** One feature row of the list. The same object until the feature, its group or the presets change. */
export interface FeatureRow {
  id: string;
  kind: FeatureKind;
  name: RichText;
  groupId: string | null;
  /** The feature's own flags. */
  hidden: boolean;
  locked: boolean;
  /** Its own flag or its group's: what actually applies. */
  effectiveHidden: boolean;
  effectiveLocked: boolean;
  /** The colour chip and kind icon. */
  swatch: Swatch;
  presetId: string | null;
  validFrom: IsoDateTime | null;
  validTo: IsoDateTime | null;
  lineageId: string | null;
  hasLabel: boolean;
}

/** One group row with its features, topmost first. */
export interface GroupRow {
  id: string;
  name: RichText;
  hidden: boolean;
  locked: boolean;
  collapsed: boolean;
  features: FeatureRow[];
}

/** The feature list as it is shown. */
export interface ListTree {
  /** Groups in list order (ascending group key). */
  groups: GroupRow[];
  /** Features in no group, topmost first. */
  ungrouped: FeatureRow[];
  /** Every feature id in the order the rows read, for keyboard and range selection. */
  flatIds: string[];
  total: number;
}

const rowCache = new WeakMap<MapFeature, { group: FeatureGroup | null; presets: PresetLookup; row: FeatureRow }>();

function rowFor(feature: MapFeature, group: FeatureGroup | null, presets: PresetLookup): FeatureRow {
  const cached = rowCache.get(feature);
  if (cached !== undefined && cached.group === group && cached.presets === presets) return cached.row;
  const swatch = swatchOf(feature, presets);
  const row: FeatureRow = {
    id: feature.id,
    kind: feature.kind,
    name: feature.name,
    groupId: group?.id ?? null,
    hidden: feature.hidden,
    locked: feature.locked,
    effectiveHidden: feature.hidden || (group?.hidden ?? false),
    effectiveLocked: feature.locked || (group?.locked ?? false),
    swatch,
    presetId: swatch.presetId,
    validFrom: feature.validFrom,
    validTo: feature.validTo,
    lineageId: feature.lineageId,
    hasLabel: feature.kind === "annotation" || feature.label !== undefined,
  };
  rowCache.set(feature, { group, presets, row });
  return row;
}

const listTree = memoLast(
  (ordered: MapFeature[], groups: readonly FeatureGroup[], presets: PresetLookup, collapsedGroups: ReadonlySet<string>): ListTree => {
    const byId = new Map<string, { group: FeatureGroup; features: FeatureRow[] }>();
    for (const group of sortKeyed(groups)) byId.set(group.id, { group, features: [] });
    const ungrouped: FeatureRow[] = [];
    for (let i = ordered.length - 1; i >= 0; i--) {
      const feature = ordered[i];
      if (feature === undefined) continue;
      const entry = feature.groupId === null ? undefined : byId.get(feature.groupId);
      if (entry === undefined) ungrouped.push(rowFor(feature, null, presets));
      else entry.features.push(rowFor(feature, entry.group, presets));
    }
    const rows: GroupRow[] = [];
    const flatIds: string[] = [];
    for (const { group, features } of byId.values()) {
      rows.push({
        id: group.id,
        name: group.name,
        hidden: group.hidden,
        locked: group.locked,
        collapsed: collapsedGroups.has(group.id),
        features,
      });
      for (const row of features) flatIds.push(row.id);
    }
    for (const row of ungrouped) flatIds.push(row.id);
    return { groups: rows, ungrouped, flatIds, total: ordered.length };
  },
);

/**
 * The feature list: groups in order with their features, then ungrouped
 * features. Within each, rows read topmost first, so the top row draws on top.
 */
export function selectListTree(state: EditorState): ListTree {
  return listTree(selectDrawOrder(state), state.doc.settings.groups, selectPresetLookup(state), state.view.collapsedGroups);
}

/* ----------------------------------------------------------------- legend */

const legend = memoLast((settings: Doc["settings"], features: Doc["features"]) =>
  legendEntries(settings, features.values()),
);

/** The map key as it will render, in order, including entries the editor hid (`hidden: true`). */
export function selectLegend(state: EditorState): LegendEntry[] {
  return legend(state.doc.settings, state.doc.features);
}

/* ------------------------------------------------------ counts and limits */

/** How close the map is to its plan's feature limit. */
export type LimitStatus = "ok" | "near" | "at" | "over";

/** Counts for the status bar and the limit notice. */
export interface Counts {
  features: number;
  byKind: Record<FeatureKind, number>;
  groups: number;
  presets: number;
  /** Features hidden directly or through their group; these are not published. */
  hidden: number;
  limit: { max: number; used: number; remaining: number; status: LimitStatus };
}

const counts = memoLast(
  (features: Doc["features"], groups: readonly FeatureGroup[], presetCount: number, limits: Session["limits"]): Counts => {
    const byKind: Record<FeatureKind, number> = { area: 0, line: 0, arrow: 0, frontline: 0, point: 0, annotation: 0 };
    const hiddenGroups = new Set(groups.filter((group) => group.hidden).map((group) => group.id));
    let hidden = 0;
    for (const feature of features.values()) {
      byKind[feature.kind] += 1;
      if (feature.hidden || (feature.groupId !== null && hiddenGroups.has(feature.groupId))) hidden += 1;
    }
    const max = limits.maxFeaturesPerMap;
    const used = features.size;
    const status: LimitStatus = used > max ? "over" : used === max ? "at" : used >= max * 0.9 ? "near" : "ok";
    return {
      features: used,
      byKind,
      groups: groups.length,
      presets: presetCount,
      hidden,
      limit: { max, used, remaining: Math.max(0, max - used), status },
    };
  },
);

/** Feature counts and where the map stands against `Session.limits.maxFeaturesPerMap`. */
export function selectCounts(state: EditorState): Counts {
  return counts(state.doc.features, state.doc.settings.groups, state.doc.settings.presets.length, state.access.limits);
}

/* ------------------------------------------------------------------- time */

const extent = memoLast((features: Doc["features"]) => timeExtent(features.values()));

/** The span of time the dated features cover; null when none is dated. */
export function selectTimeExtent(state: EditorState): TimeExtent | null {
  return extent(state.doc.features);
}

const histogram = memoLast((features: Doc["features"], span: TimeExtent | null, buckets: number) =>
  timeHistogram(features.values(), span, buckets),
);

/** Features over time for the timeline bar, in `buckets` equal bars across the extent. */
export function selectTimeHistogram(state: EditorState, buckets = 48): TimeBucket[] {
  return histogram(state.doc.features, selectTimeExtent(state), buckets);
}

const timeWindow = memoLast((playhead: IsoDateTime | null, windowMs: number, mode: "moving" | "cumulative") =>
  timeWindowFor(playhead, windowMs, { mode }),
);

/**
 * The authoring time filter in force, in the shape `EditorController.setTimeFilter`
 * takes; null ("All time") shows everything. It follows the playhead alone:
 * the author can scrub a map whose readers get no timeline.
 */
export function selectTimeWindow(state: EditorState): TimeWindow | null {
  return timeWindow(state.timeline.playhead, state.doc.settings.timeline.windowMs, state.doc.settings.timeline.mode);
}

/** Whether the author can scrub: the map has at least one dated feature. Independent of `settings.timeline.enabled`. */
export function selectTimelineUsable(state: EditorState): boolean {
  return selectTimeExtent(state) !== null;
}

/** What shows on the map right now. */
export interface Visibility {
  /** Features that are not hidden and are valid at the playhead. */
  ids: ReadonlySet<string>;
  count: number;
  /** Features left out only because of the time filter. */
  outsideTime: number;
}

const visibility = memoLast(
  (features: Doc["features"], groups: readonly FeatureGroup[], window: TimeWindow | null): Visibility => {
    const hiddenGroups = new Set(groups.filter((group) => group.hidden).map((group) => group.id));
    const ids = new Set<string>();
    let outsideTime = 0;
    for (const feature of features.values()) {
      if (feature.hidden || (feature.groupId !== null && hiddenGroups.has(feature.groupId))) continue;
      if (isValidInWindow(feature, window)) ids.add(feature.id);
      else outsideTime += 1;
    }
    return { ids, count: ids.size, outsideTime };
  },
);

/** What is visible at the playhead: not hidden, and valid in the time window. */
export function selectVisibleAtPlayhead(state: EditorState): Visibility {
  return visibility(state.doc.features, state.doc.settings.groups, selectTimeWindow(state));
}

/* ------------------------------------------------------ saving and status */

const pending = memoLast((baseline: Doc, doc: Doc): ChangeSet => changeSet(baseline, doc));

/** What the next save would send: `put`, `delete`, and the settings, title and direction if they changed. */
export function selectChangeSet(state: EditorState): ChangeSet {
  return pending(state.baseline, state.doc);
}

/** True when there are unsaved changes. */
export function selectIsDirty(state: EditorState): boolean {
  return state.baseline !== state.doc && !selectChangeSet(state).empty;
}

/** The one-word state of the save control. */
export type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "read_only";

/** Unsaved-change status for the top bar, combining the change set with the save state. */
export function selectSaveStatus(state: EditorState): SaveStatus {
  if (state.access.readOnly !== null) return "read_only";
  if (state.save.kind === "saving") return "saving";
  const failed = state.save.kind !== "idle" && state.save.kind !== "saved" && state.save.kind !== "nothing_to_save";
  if (failed) return "error";
  return selectIsDirty(state) ? "unsaved" : "saved";
}

/** Where the draft stands against the live version. */
export interface DraftStatus {
  /**
   * `never_published`: nothing is live. `live`: the live version is this
   * draft. `draft_ahead`: there are saved or unsaved changes not yet published.
   */
  state: "never_published" | "live" | "draft_ahead";
  liveVersion: number | null;
  /** True when part of what is ahead of live has not been saved yet. */
  unsaved: boolean;
}

const draftStatus = memoLast((meta: MapMeta, dirty: boolean): DraftStatus => {
  if (meta.publishedVersion === null) return { state: "never_published", liveVersion: null, unsaved: dirty };
  const ahead = dirty || meta.publishedRev === null || meta.rev > meta.publishedRev;
  return { state: ahead ? "draft_ahead" : "live", liveVersion: meta.publishedVersion, unsaved: dirty };
});

/** "Never published", "live" or "draft ahead of live", for the publish control. */
export function selectDraftStatus(state: EditorState): DraftStatus {
  return draftStatus(state.meta, selectIsDirty(state));
}

/* ---------------------------------------------------------------- history */

/** What the Edit menu needs. Labels are null when there is nothing to undo or redo. */
export interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: Bilingual | null;
  redoLabel: Bilingual | null;
  /** Steps available to undo, for a counter. */
  depth: number;
}

const historyInfo = memoLast((history: HistoryState, readOnly: boolean): HistoryInfo => {
  const undo = history.undo[history.undo.length - 1];
  const redo = history.redo[history.redo.length - 1];
  return {
    canUndo: !readOnly && undo !== undefined,
    canRedo: !readOnly && redo !== undefined,
    undoLabel: undo?.label ?? null,
    redoLabel: redo?.label ?? null,
    depth: history.undo.length,
  };
});

/** Whether undo and redo are available and what they would do, in both languages. */
export function selectHistoryInfo(state: EditorState): HistoryInfo {
  return historyInfo(state.history, state.access.readOnly !== null);
}

/* ----------------------------------------------------------------- engine */

const engineDefaults = memoLast((tool: ToolId, defaults: DrawDefaults) => controllerDrawDefaults(tool, defaults));

/** The draw defaults of the active tool, in the shape the controller takes; null for the select tool. */
export function selectControllerDrawDefaults(state: EditorState): Partial<MapFeature> | null {
  return engineDefaults(state.tool, state.drawDefaults);
}
