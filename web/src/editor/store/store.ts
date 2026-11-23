import type { ApiClient } from "@/api/client";
import type { DrawProgress, FeatureChange, PointerInfo, ToolId } from "@/editor/controller";
import type {
  ColorRef,
  FeatureGroup,
  FeatureKind,
  Fill,
  IsoDateTime,
  LegendItem,
  LngLat,
  MapDoc,
  MapFeature,
  MapSettings,
  RichText,
  Session,
  Stroke,
  StylePreset,
  Viewport,
} from "@/model/types";
import { defaultFeatureName, initialDrawDefaults, type DrawDefaults } from "./defaults";
import {
  applyPatch,
  changeSet,
  deepEqual,
  docFrom,
  Draft,
  mergePatches,
  sameFeature,
  toEditRequest,
  type Doc,
  type DraftResult,
  type UiDir,
} from "./doc";
import { legendKey, materialiseLegend } from "./legend";
import { allocateKeys, sortKeyed } from "./ordering";
import { publishStateFromError, saveStateFromError } from "./save";
import type {
  CommandResult,
  EditorState,
  HistoryStep,
  PublishState,
  ReadOnlyReason,
  Refusal,
  SaveState,
  Selection,
  PenMode,
  ViewState,
} from "./state";
import { copyStyleOf, detachPreset, pasteStyleOnto, presetLookup, presetStyleFrom, PRESET_KINDS } from "./style";
import { applyStylePatch, patchProperties, stylePropertyLabel, type StylePatch } from "./style-properties";
import { bi, featuresNoun, newId, rich, verbFeatures, type Bilingual } from "./text";
import { eventTimes, timeExtent, toIso } from "./time";

/** How many undo steps are kept. Older ones fall off the bottom. */
export const HISTORY_LIMIT = 300;

/** Consecutive tweaks of the same property on the same targets merge within this many milliseconds. */
export const COALESCE_MS = 1000;

/** The default width of the moving time window: one day. */
export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The narrowest moving window: one minute of map time. */
const MIN_WINDOW_MS = 60 * 1000;

/** What `createEditorStore` needs. */
export interface EditorStoreInit {
  map: MapDoc;
  features: MapFeature[];
  /** Decides read-only mode, the feature limit and who edits are stamped with. */
  session: Pick<Session, "userId" | "capabilities" | "limits">;
  /** The clock. Defaults to the real one. */
  now?: () => Date;
}

/** Where a moved item lands, relative to another. */
export interface OrderTarget {
  /** The feature it is placed next to. */
  relativeTo: string;
  /** "above" draws over the target (and lists before it); "below" draws under it. */
  side: "above" | "below";
}

/** What `applyEngineChange` reports back to the wiring. */
export type EngineChangeResult = CommandResult & {
  /** True when the store now holds exactly what the engine sent, so nothing needs sending back. */
  inSync: boolean;
};

interface CommitOptions {
  /** Steps with the same key merge while the previous one is open and recent. */
  coalesce?: string;
  /** Ignore the time limit when merging (map gestures run as long as the drag does). */
  sticky?: boolean;
  /** Close the step at once so nothing merges into it. */
  seal?: boolean;
  /** The selection after the command; default keeps the current one. */
  select?: (result: DraftResult) => Selection;
  /** false applies the change without an undo step (interface-only document fields). */
  history?: boolean;
}

type Build = (draft: Draft) => Refusal | undefined;

const OK_UNCHANGED: CommandResult = { ok: true, changed: false };
const OK_CHANGED: CommandResult = { ok: true, changed: true };
const NO_SELECTION: Selection = { ids: [], groupId: null };

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function pruneSelection(selection: Selection, doc: Doc): Selection {
  const ids = selection.ids.filter((id) => doc.features.has(id));
  const groupId =
    selection.groupId !== null && doc.settings.groups.some((group) => group.id === selection.groupId)
      ? selection.groupId
      : null;
  if (ids.length === selection.ids.length && groupId === selection.groupId) return selection;
  return { ids, groupId };
}

const PEN_KEY = "livemap.pen-mode";

/** Pen mode is remembered for the tab's session, so turning it off sticks across maps. */
function readPenMode(): PenMode {
  try {
    const raw = window.sessionStorage.getItem(PEN_KEY);
    return raw === "on" || raw === "off" ? raw : "auto";
  } catch {
    return "auto";
  }
}

function writePenMode(mode: PenMode): void {
  try {
    window.sessionStorage.setItem(PEN_KEY, mode);
  } catch {
    /* Lasts for this map. */
  }
}

const COLLAPSED_KEY = (mapId: string): string => `livemap.collapsed-groups.${mapId}`;

/** Storage can be blocked (a sandboxed frame, a privacy mode); folding then lasts for the visit. */
function readCollapsedGroups(mapId: string): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY(mapId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeCollapsedGroups(mapId: string, ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) window.localStorage.removeItem(COLLAPSED_KEY(mapId));
    else window.localStorage.setItem(COLLAPSED_KEY(mapId), JSON.stringify([...ids]));
  } catch {
    /* Folding still works for this visit. */
  }
}

function lockedGroups(settings: MapSettings): Set<string> {
  return new Set(settings.groups.filter((group) => group.locked).map((group) => group.id));
}

function translate(feature: MapFeature, offset: LngLat): MapFeature {
  const move = (at: LngLat): LngLat => [at[0] + offset[0], at[1] + offset[1]];
  switch (feature.kind) {
    case "area":
      return { ...feature, rings: feature.rings.map((ring) => ring.map(move)) };
    case "line":
    case "frontline":
      return { ...feature, path: feature.path.map(move) };
    case "arrow":
      return { ...feature, control: feature.control.map(move) };
    case "point":
      return { ...feature, at: move(feature.at) };
    case "annotation":
      return { ...feature, anchor: move(feature.anchor), textAt: move(feature.textAt) };
  }
}

/** The stored feature with the geometry the engine reported; null when the kinds differ. */
function withGeometry(current: MapFeature, incoming: MapFeature): MapFeature | null {
  switch (current.kind) {
    case "area":
      return incoming.kind === "area" ? { ...current, rings: incoming.rings } : null;
    case "line":
      return incoming.kind === "line" ? { ...current, path: incoming.path } : null;
    case "frontline":
      return incoming.kind === "frontline" ? { ...current, path: incoming.path } : null;
    case "arrow":
      return incoming.kind === "arrow"
        ? { ...current, control: incoming.control, curvature: incoming.curvature, bend: incoming.bend }
        : null;
    case "point":
      return incoming.kind === "point" ? { ...current, at: incoming.at } : null;
    case "annotation":
      return incoming.kind === "annotation" ? { ...current, anchor: incoming.anchor, textAt: incoming.textAt } : null;
  }
}

/** Move `ids` to `indexIn(others)` of the draw order, re-keying as little as possible. */
function placeAt(
  draft: Draft,
  ids: readonly string[],
  indexIn: (others: MapFeature[]) => number,
  change: (feature: MapFeature) => MapFeature = (feature) => feature,
): void {
  const moving = new Set(ids);
  const sorted = draft.sorted();
  const block = sorted.filter((feature) => moving.has(feature.id));
  const others = sorted.filter((feature) => !moving.has(feature.id));
  const index = Math.max(0, Math.min(indexIn(others), others.length));
  const alreadyThere = block.every((feature, i) => sorted[index + i] === feature);
  if (alreadyThere) {
    for (const feature of block) draft.put(change(feature));
    return;
  }
  const allocation = allocateKeys(others, index, block.length);
  block.forEach((feature, i) => {
    draft.put(change({ ...feature, order: allocation.keys[i] ?? feature.order }));
  });
  for (const [id, order] of allocation.rekeyed) {
    const neighbour = draft.get(id);
    if (neighbour !== undefined) draft.put({ ...neighbour, order });
  }
}

/** Add new features at `indexIn(existing)` of the draw order, in the order given (first is lowest). */
function insertAt(draft: Draft, features: readonly MapFeature[], indexIn: (existing: MapFeature[]) => number): void {
  const existing = draft.sorted();
  const index = Math.max(0, Math.min(indexIn(existing), existing.length));
  const allocation = allocateKeys(existing, index, features.length);
  for (const [id, order] of allocation.rekeyed) {
    const neighbour = draft.get(id);
    if (neighbour !== undefined) draft.put({ ...neighbour, order });
  }
  features.forEach((feature, i) => {
    draft.put({ ...feature, order: allocation.keys[i] ?? feature.order });
  });
}

function replaceGroup(settings: MapSettings, id: string, change: (group: FeatureGroup) => FeatureGroup): MapSettings {
  return { ...settings, groups: settings.groups.map((group) => (group.id === id ? change(group) : group)) };
}

/**
 * The document store for one open map: the document, every operation on it,
 * undo and redo, selection, interface state and saving.
 *
 * - Read with `getState()` / `subscribe()` (or the `useEditorStore` hook) and
 *   derive with the `select*` functions.
 * - Every command returns a `CommandResult` and never throws. A refusal
 *   (read-only map, feature limit, locked target...) is also kept in
 *   `state.refusal` for an in-place notice.
 * - Commands that take `ids?` act on the selection when it is omitted.
 * - Locked features (directly or through their group) are skipped by commands
 *   that change geometry, style, dates or existence. Renaming, ordering,
 *   grouping, hiding and locking still work on them.
 * - Each command is one undo step. Steps of the same kind on the same targets
 *   merge while they follow each other closely (`COALESCE_MS`); call
 *   `closeStep()` on pointer-up or blur to end a run explicitly.
 */
export class EditorStore {
  private state: EditorState;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => Date;
  private stepSeq = 0;
  private refusalSeq = 0;
  private saving: Promise<SaveState> | null = null;

  constructor(init: EditorStoreInit) {
    this.now = init.now ?? (() => new Date());
    const { map, session } = init;
    const doc = docFrom(map, init.features);
    const readOnly: ReadOnlyReason | null = map.archived
      ? "archived"
      : session.capabilities.includes("map:edit")
        ? null
        : "viewer";
    this.state = {
      meta: {
        id: map.id,
        tenantId: map.tenantId,
        slug: map.slug,
        rev: map.rev,
        publishedVersion: map.publishedVersion,
        publishedRev: map.publishedRev,
        archived: map.archived,
        updatedAt: map.updatedAt,
        updatedBy: map.updatedBy,
      },
      access: {
        readOnly,
        canPublish: !map.archived && session.capabilities.includes("map:publish"),
        userId: session.userId,
        limits: session.limits,
      },
      doc,
      baseline: doc,
      selection: NO_SELECTION,
      tool: "select",
      drawDefaults: initialDrawDefaults(),
      timeline: { playhead: null, playing: false },
      view: {
        snapping: true,
        toolLocked: false,
        penMode: readPenMode(),
        listCollapsed: false,
        inspectorCollapsed: false,
        reshapingId: null,
        paletteOpen: false,
        shortcutSheetOpen: false,
        collapsedGroups: readCollapsedGroups(map.id),
      },
      history: { undo: [], redo: [] },
      save: { kind: "idle" },
      publish: { kind: "idle" },
      clipboard: { features: [], style: null },
      live: { ready: false, draw: null, crosshair: false, moving: false, pointer: null, viewport: null, problem: null },
      refusal: null,
    };
  }

  /* --------------------------------------------------------------- reading */

  /** The current state. The same object until something changes. */
  getState = (): EditorState => this.state;

  /** Call `listener` after every change. Returns the unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(change: Partial<EditorState>): void {
    let next: EditorState = { ...this.state, ...change };
    const reshaping = next.view.reshapingId;
    if (reshaping !== null && !next.doc.features.has(reshaping)) {
      next = { ...next, view: { ...next.view, reshapingId: null } };
    }
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  private refuse(refusal: Refusal): { ok: false; refusal: Refusal } {
    this.refusalSeq += 1;
    this.set({ refusal: { seq: this.refusalSeq, refusal } });
    return { ok: false, refusal };
  }

  /** Clear `state.refusal` once its notice has been dismissed. */
  dismissRefusal(): void {
    if (this.state.refusal !== null) this.set({ refusal: null });
  }

  private commit(label: Bilingual | (() => Bilingual), build: Build, options: CommitOptions = {}): CommandResult {
    const readOnly = this.state.access.readOnly;
    if (readOnly !== null) return this.refuse({ code: "read_only", why: readOnly });
    const draft = new Draft(this.state.doc, { at: this.now().toISOString(), by: this.state.access.userId });
    const refusal = build(draft);
    if (refusal !== undefined) return this.refuse(refusal);
    const result = draft.finish();
    if (result === null) return OK_UNCHANGED;
    const selectionAfter = pruneSelection(options.select?.(result) ?? this.state.selection, result.doc);
    if (options.history === false) {
      this.set({ doc: result.doc, selection: selectionAfter });
      return OK_CHANGED;
    }
    const at = this.now().getTime();
    const previous = this.state.history.undo;
    const top = previous[previous.length - 1];
    const key = options.coalesce ?? null;
    let undo: HistoryStep[];
    if (
      top !== undefined &&
      top.open &&
      key !== null &&
      top.coalesceKey === key &&
      (options.sticky === true || at - top.touchedAt <= COALESCE_MS)
    ) {
      const merged: HistoryStep = {
        ...top,
        undo: mergePatches(result.undo, top.undo),
        redo: mergePatches(top.redo, result.redo),
        selectionAfter,
        touchedAt: at,
        open: options.seal !== true,
      };
      undo = [...previous.slice(0, -1), merged];
    } else {
      this.stepSeq += 1;
      const step: HistoryStep = {
        id: this.stepSeq,
        label: typeof label === "function" ? label() : label,
        undo: result.undo,
        redo: result.redo,
        selectionBefore: this.state.selection,
        selectionAfter,
        coalesceKey: key,
        touchedAt: at,
        open: key !== null && options.seal !== true,
      };
      undo = [...previous, step].slice(-HISTORY_LIMIT);
    }
    this.set({ doc: result.doc, selection: selectionAfter, history: { undo, redo: [] } });
    return OK_CHANGED;
  }

  private targetIds(ids: readonly string[] | undefined): readonly string[] {
    return ids ?? this.state.selection.ids;
  }

  /** The existing targets, split by whether a lock covers them. */
  private resolveTargets(
    draft: Draft,
    ids: readonly string[] | undefined,
  ): { all: MapFeature[]; editable: MapFeature[] } {
    const locked = lockedGroups(draft.settings);
    const all: MapFeature[] = [];
    const editable: MapFeature[] = [];
    const seen = new Set<string>();
    for (const id of this.targetIds(ids)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const feature = draft.get(id);
      if (feature === undefined) continue;
      all.push(feature);
      if (!feature.locked && !(feature.groupId !== null && locked.has(feature.groupId))) editable.push(feature);
    }
    return { all, editable };
  }

  /** Map `change` over the editable targets; refuses when there are none. */
  private editEach(
    draft: Draft,
    ids: readonly string[] | undefined,
    change: (feature: MapFeature) => MapFeature,
  ): Refusal | undefined {
    const { all, editable } = this.resolveTargets(draft, ids);
    if (all.length === 0) return { code: "no_target" };
    if (editable.length === 0) return { code: "locked" };
    for (const feature of editable) draft.put(change(feature));
    return undefined;
  }

  /** Map `change` over all targets, locked or not. */
  private touchEach(
    draft: Draft,
    ids: readonly string[] | undefined,
    change: (feature: MapFeature) => MapFeature,
  ): Refusal | undefined {
    const { all } = this.resolveTargets(draft, ids);
    if (all.length === 0) return { code: "no_target" };
    for (const feature of all) draft.put(change(feature));
    return undefined;
  }

  private count(ids: readonly string[] | undefined): number {
    return this.targetIds(ids).filter((id) => this.state.doc.features.has(id)).length;
  }

  private idsKey(ids: readonly string[] | undefined): string {
    return [...this.targetIds(ids)].sort().join(",");
  }

  /* ------------------------------------------------------------- selection */

  /** Change the selection. `mode` follows the controller's click and box-select modes. */
  select(ids: readonly string[], mode: "replace" | "add" | "toggle" = "replace"): void {
    const existing = ids.filter((id) => this.state.doc.features.has(id));
    const current = this.state.selection.ids;
    let next: string[];
    if (mode === "replace") {
      next = [...new Set(existing)];
    } else if (mode === "add") {
      next = [...new Set([...current, ...existing])];
    } else {
      const toggled = new Set(existing);
      next = [...current.filter((id) => !toggled.has(id)), ...existing.filter((id) => !current.includes(id))];
    }
    if (sameIds(next, current) && this.state.selection.groupId === null) return;
    this.set({ selection: { ids: next, groupId: null } });
  }

  /** Select every feature that is not hidden or locked. */
  selectAll(): void {
    const { settings, features } = this.state.doc;
    const off = new Set(settings.groups.filter((group) => group.hidden || group.locked).map((group) => group.id));
    const ids = sortKeyed(features.values())
      .filter((feature) => !feature.hidden && !feature.locked && !(feature.groupId !== null && off.has(feature.groupId)))
      .map((feature) => feature.id);
    this.select(ids);
  }

  clearSelection(): void {
    if (this.state.selection.ids.length === 0 && this.state.selection.groupId === null) return;
    this.set({ selection: NO_SELECTION });
  }

  /** Select a group row: the inspector shows the group, and bulk commands reach its features. */
  selectGroup(groupId: string): void {
    if (!this.state.doc.settings.groups.some((group) => group.id === groupId)) return;
    const ids = sortKeyed(this.state.doc.features.values())
      .filter((feature) => feature.groupId === groupId)
      .map((feature) => feature.id);
    this.set({ selection: { ids, groupId } });
  }

  /* ------------------------------------------------- tool, view and engine */

  /** Switch tool. In read-only mode only the select tool is available. */
  setTool(tool: ToolId): void {
    const next = this.state.access.readOnly !== null ? "select" : tool;
    if (next === this.state.tool) return;
    this.set({
      tool: next,
      view: next === "select" ? this.state.view : { ...this.state.view, reshapingId: null },
    });
  }

  /** Change the style the next drawn feature of a kind gets, including its preset. */
  setDrawDefaults<K extends FeatureKind>(kind: K, patch: Partial<DrawDefaults[K]>): void {
    const current: DrawDefaults[K] = this.state.drawDefaults[kind];
    this.set({ drawDefaults: { ...this.state.drawDefaults, [kind]: { ...current, ...patch } } });
  }

  private setView(patch: Partial<ViewState>): void {
    this.set({ view: { ...this.state.view, ...patch } });
  }

  setSnapping(enabled: boolean): void {
    if (this.state.view.snapping !== enabled) this.setView({ snapping: enabled });
  }

  setToolLocked(locked: boolean): void {
    if (this.state.view.toolLocked !== locked) this.setView({ toolLocked: locked });
  }

  setPenMode(mode: PenMode): void {
    if (this.state.view.penMode === mode) return;
    writePenMode(mode);
    this.setView({ penMode: mode });
  }

  toggleList(): void {
    this.setView({ listCollapsed: !this.state.view.listCollapsed });
  }

  toggleInspector(): void {
    this.setView({ inspectorCollapsed: !this.state.view.inspectorCollapsed });
  }

  setPaletteOpen(open: boolean): void {
    if (this.state.view.paletteOpen !== open) this.setView({ paletteOpen: open });
  }

  setShortcutSheetOpen(open: boolean): void {
    if (this.state.view.shortcutSheetOpen !== open) this.setView({ shortcutSheetOpen: open });
  }

  /** Show vertex handles for one feature (null stops). Refused for locked features and in read-only mode. */
  setReshaping(id: string | null): CommandResult {
    if (id === this.state.view.reshapingId) return OK_UNCHANGED;
    if (id === null) {
      this.setView({ reshapingId: null });
      return OK_CHANGED;
    }
    const readOnly = this.state.access.readOnly;
    if (readOnly !== null) return this.refuse({ code: "read_only", why: readOnly });
    const feature = this.state.doc.features.get(id);
    if (feature === undefined) return this.refuse({ code: "not_found", what: "feature" });
    const locked = lockedGroups(this.state.doc.settings);
    if (feature.locked || (feature.groupId !== null && locked.has(feature.groupId))) {
      return this.refuse({ code: "locked" });
    }
    this.set({ tool: "select", selection: { ids: [id], groupId: null }, view: { ...this.state.view, reshapingId: id } });
    return OK_CHANGED;
  }

  /**
   * What Escape does, innermost first: close the palette or shortcut sheet,
   * stop reshaping, return to the select tool, then clear the selection.
   * Returns false when there was nothing to back out of.
   */
  escape(): boolean {
    const { view, tool, selection } = this.state;
    if (view.paletteOpen || view.shortcutSheetOpen) {
      this.setView({ paletteOpen: false, shortcutSheetOpen: false });
      return true;
    }
    if (view.reshapingId !== null) {
      this.setView({ reshapingId: null });
      return true;
    }
    if (tool !== "select") {
      this.setTool("select");
      return true;
    }
    if (selection.ids.length > 0 || selection.groupId !== null) {
      this.clearSelection();
      return true;
    }
    return false;
  }

  /** The engine finished loading. Called by the wiring. */
  setEngineReady(ready: boolean): void {
    if (this.state.live.ready !== ready) this.set({ live: { ...this.state.live, ready } });
  }

  /** Length and area of the shape being drawn. Called by the wiring. */
  setDrawProgress(draw: DrawProgress | null): void {
    if (this.state.live.draw !== draw) this.set({ live: { ...this.state.live, draw } });
  }

  /** Keyboard placement started or stopped. Called by the wiring. */
  setCrosshair(crosshair: boolean): void {
    if (this.state.live.crosshair !== crosshair) this.set({ live: { ...this.state.live, crosshair } });
  }

  /** A move by destination started or ended. Called by the wiring. */
  setMoving(moving: boolean): void {
    if (this.state.live.moving !== moving) this.set({ live: { ...this.state.live, moving } });
  }

  /** Where the pointer is. Called by the wiring. */
  setPointer(pointer: PointerInfo | null): void {
    this.set({ live: { ...this.state.live, pointer } });
  }

  /** The current map view. Called by the wiring. */
  setViewport(viewport: Viewport | null): void {
    this.set({ live: { ...this.state.live, viewport } });
  }

  /** An engine problem to show in place; null clears it. */
  setEngineProblem(problem: EditorState["live"]["problem"]): void {
    this.set({ live: { ...this.state.live, problem } });
  }

  /* -------------------------------------------------------------- timeline */

  /** Move the playhead. null removes the time filter. */
  setPlayhead(playhead: IsoDateTime | null): void {
    if (playhead === this.state.timeline.playhead) return;
    this.set({ timeline: { ...this.state.timeline, playhead, playing: playhead === null ? false : this.state.timeline.playing } });
  }

  /**
   * Width of the moving window, in milliseconds of map time. It is the map's
   * own setting, so readers get the same window; a drag coalesces into one
   * undo step until `closeStep()`.
   */
  setTimeWindow(windowMs: number): CommandResult {
    return this.setTimelineSettings({ windowMs: Math.max(MIN_WINDOW_MS, Math.round(windowMs)) });
  }

  /** Start playback, from the beginning when the playhead is unset or at the end. Does nothing without dated features. */
  play(): void {
    const extent = timeExtent(this.state.doc.features.values());
    if (extent === null || extent.toMs === extent.fromMs) return;
    const at = this.state.timeline.playhead === null ? Number.NaN : Date.parse(this.state.timeline.playhead);
    const playhead = Number.isNaN(at) || at >= extent.toMs || at < extent.fromMs ? extent.from : toIso(at);
    this.set({ timeline: { ...this.state.timeline, playhead, playing: true } });
  }

  pause(): void {
    if (this.state.timeline.playing) this.set({ timeline: { ...this.state.timeline, playing: false } });
  }

  togglePlay(): void {
    if (this.state.timeline.playing) this.pause();
    else this.play();
  }

  /**
   * Advance playback by `elapsedMs` of real time (call from an animation
   * frame while `timeline.playing`). Stops at the end of the extent.
   */
  tickPlayback(elapsedMs: number): void {
    const { playing, playhead } = this.state.timeline;
    if (!playing || playhead === null) return;
    const extent = timeExtent(this.state.doc.features.values());
    const at = Date.parse(playhead);
    if (extent === null || Number.isNaN(at)) {
      this.pause();
      return;
    }
    const next = at + elapsedMs * this.state.doc.settings.timeline.speed;
    if (next >= extent.toMs) this.set({ timeline: { ...this.state.timeline, playhead: extent.to, playing: false } });
    else this.set({ timeline: { ...this.state.timeline, playhead: toIso(next) } });
  }

  /** Jump the playhead to the next (1) or previous (-1) moment at which a feature starts or ends. */
  stepPlayhead(direction: 1 | -1): void {
    const times = eventTimes(this.state.doc.features.values());
    if (times.length === 0) return;
    const current = this.state.timeline.playhead === null ? Number.NaN : Date.parse(this.state.timeline.playhead);
    let target: number | undefined;
    if (Number.isNaN(current)) target = direction === 1 ? times[0] : times[times.length - 1];
    else if (direction === 1) target = times.find((time) => time > current);
    else target = times.findLast((time) => time < current);
    if (target === undefined) return;
    this.set({ timeline: { ...this.state.timeline, playhead: toIso(target), playing: false } });
  }

  /* --------------------------------------------------------------- history */

  private readOnlyRefusal(): { ok: false; refusal: Refusal } | null {
    const readOnly = this.state.access.readOnly;
    return readOnly === null ? null : this.refuse({ code: "read_only", why: readOnly });
  }

  /** Revert the last step, restoring the document and the selection it had. */
  undo(): CommandResult {
    const refused = this.readOnlyRefusal();
    if (refused !== null) return refused;
    const { undo, redo } = this.state.history;
    const step = undo[undo.length - 1];
    if (step === undefined) return OK_UNCHANGED;
    const doc = applyPatch(this.state.doc, step.undo);
    this.set({
      doc,
      selection: pruneSelection(step.selectionBefore, doc),
      history: { undo: undo.slice(0, -1), redo: [...redo, { ...step, open: false }] },
    });
    return OK_CHANGED;
  }

  /** Reapply the step last undone. */
  redo(): CommandResult {
    const refused = this.readOnlyRefusal();
    if (refused !== null) return refused;
    const { undo, redo } = this.state.history;
    const step = redo[redo.length - 1];
    if (step === undefined) return OK_UNCHANGED;
    const doc = applyPatch(this.state.doc, step.redo);
    this.set({
      doc,
      selection: pruneSelection(step.selectionAfter, doc),
      history: { undo: [...undo, step], redo: redo.slice(0, -1) },
    });
    return OK_CHANGED;
  }

  /** End the current run of merging tweaks: the next change starts a new undo step. */
  closeStep(): void {
    const { undo, redo } = this.state.history;
    const top = undo[undo.length - 1];
    if (top === undefined || !top.open) return;
    this.set({ history: { undo: [...undo.slice(0, -1), { ...top, open: false }], redo } });
  }

  /* ---------------------------------------------------------------- adding */

  private limitRefusal(draft: Draft, adding: number): Refusal | undefined {
    const max = this.state.access.limits.maxFeaturesPerMap;
    const wouldBe = draft.size + adding;
    return wouldBe > max ? { code: "feature_limit", max, wouldBe } : undefined;
  }

  /** Give arriving features fresh ids where they collide and a numbered name where they have none. */
  private prepareNew(draft: Draft, features: readonly MapFeature[]): MapFeature[] {
    const perKind = new Map<FeatureKind, number>();
    for (const feature of draft.values()) perKind.set(feature.kind, (perKind.get(feature.kind) ?? 0) + 1);
    const groups = new Set(draft.settings.groups.map((group) => group.id));
    const presets = new Set(draft.settings.presets.map((preset) => preset.id));
    const taken = new Set<string>();
    return features.map((feature) => {
      const ordinal = (perKind.get(feature.kind) ?? 0) + 1;
      perKind.set(feature.kind, ordinal);
      const id = feature.id === "" || draft.has(feature.id) || taken.has(feature.id) ? newId() : feature.id;
      taken.add(id);
      return {
        ...feature,
        id,
        name: feature.name.value === "" ? defaultFeatureName(feature.kind, ordinal, draft.uiDir) : feature.name,
        groupId: feature.groupId !== null && groups.has(feature.groupId) ? feature.groupId : null,
        presetId: feature.presetId !== null && presets.has(feature.presetId) ? feature.presetId : null,
      };
    });
  }

  private addOnTop(label: Bilingual, features: readonly MapFeature[]): CommandResult {
    if (features.length === 0) return OK_UNCHANGED;
    return this.commit(
      label,
      (draft) => {
        const refusal = this.limitRefusal(draft, features.length);
        if (refusal !== undefined) return refusal;
        insertAt(draft, this.prepareNew(draft, features), (existing) => existing.length);
        return undefined;
      },
      { select: (result) => ({ ids: result.added, groupId: null }) },
    );
  }

  /**
   * Add complete features on top of the draw order and select them. Ids that
   * collide are replaced, empty names are numbered, and draw-order keys are
   * assigned here; the given array order becomes the draw order, first lowest.
   */
  addFeatures(features: readonly MapFeature[]): CommandResult {
    return this.addOnTop(verbFeatures("Add", "إضافة", features.length), features);
  }

  /**
   * Add the features of an import result (`importGeoJson(...).features`) as one undo step.
   * With `newGroup`, a group of that id and name is created at the top of the
   * list in the same step and the features go into it.
   */
  importFeatures(
    features: readonly MapFeature[],
    options: { newGroup?: { id: string; name: RichText } } = {},
  ): CommandResult {
    const label = verbFeatures("Import", "استيراد", features.length);
    const newGroup = options.newGroup;
    if (newGroup === undefined) return this.addOnTop(label, features);
    if (features.length === 0) return OK_UNCHANGED;
    return this.commit(
      label,
      (draft) => {
        const refusal = this.limitRefusal(draft, features.length);
        if (refusal !== undefined) return refusal;
        if (draft.settings.groups.some((group) => group.id === newGroup.id)) {
          return { code: "invalid", detail: "A group with this id already exists." };
        }
        const groups = sortKeyed(draft.settings.groups);
        const allocation = allocateKeys(groups, 0, 1);
        const group: FeatureGroup = {
          id: newGroup.id,
          name: newGroup.name,
          order: allocation.keys[0] ?? "V",
          hidden: false,
          locked: false,
        };
        draft.settings = {
          ...draft.settings,
          groups: [
            ...draft.settings.groups.map((existing) => {
              const order = allocation.rekeyed.get(existing.id);
              return order === undefined ? existing : { ...existing, order };
            }),
            group,
          ],
        };
        const grouped = features.map((feature) => ({ ...feature, groupId: newGroup.id }));
        insertAt(draft, this.prepareNew(draft, grouped), (existing) => existing.length);
        return undefined;
      },
      { select: (result) => ({ ids: result.added, groupId: null }) },
    );
  }

  /**
   * Duplicate features just above the originals and select the copies.
   * `offset` shifts the copies in degrees so they do not sit exactly on top.
   */
  duplicate(ids?: readonly string[], options: { offset?: LngLat } = {}): CommandResult {
    return this.commit(
      verbFeatures("Duplicate", "تكرار", this.count(ids)),
      (draft) => {
        const { all } = this.resolveTargets(draft, ids);
        if (all.length === 0) return { code: "no_target" };
        const refusal = this.limitRefusal(draft, all.length);
        if (refusal !== undefined) return refusal;
        const originals = sortKeyed(all);
        const suffix = draft.uiDir === "rtl" ? " (نسخة)" : " copy";
        const copies = originals.map((feature) => {
          const copy: MapFeature = {
            ...feature,
            id: newId(),
            name: { ...feature.name, value: feature.name.value + suffix },
            lineageId: null,
            locked: false,
          };
          return options.offset === undefined ? copy : translate(copy, options.offset);
        });
        const topmost = originals[originals.length - 1];
        insertAt(draft, copies, (existing) => existing.findIndex((feature) => feature.id === topmost?.id) + 1);
        return undefined;
      },
      { select: (result) => ({ ids: result.added, groupId: null }) },
    );
  }

  /** Copy features to the store's clipboard. Works in read-only mode. */
  copy(ids?: readonly string[]): CommandResult {
    const features = sortKeyed(
      this.targetIds(ids)
        .map((id) => this.state.doc.features.get(id))
        .filter((feature) => feature !== undefined),
    );
    if (features.length === 0) return this.refuse({ code: "no_target" });
    this.set({ clipboard: { ...this.state.clipboard, features } });
    return OK_CHANGED;
  }

  /** Copy, then delete. */
  cut(ids?: readonly string[]): CommandResult {
    const refused = this.readOnlyRefusal();
    if (refused !== null) return refused;
    const copied = this.copy(ids);
    return copied.ok ? this.deleteFeatures(ids) : copied;
  }

  /** Paste the clipboard on top of the draw order and select the result. */
  paste(options: { offset?: LngLat } = {}): CommandResult {
    const clipboard = this.state.clipboard.features;
    if (clipboard.length === 0) return this.refuse({ code: "empty_clipboard" });
    const copies = clipboard.map((feature) => {
      const copy: MapFeature = { ...feature, id: newId(), lineageId: null, locked: false };
      return options.offset === undefined ? copy : translate(copy, options.offset);
    });
    return this.addOnTop(verbFeatures("Paste", "لصق", copies.length), copies);
  }

  /**
   * Take in what the user did on the map. `update` events of a gesture merge
   * into one undo step that the `commit` closes. For features the store
   * already holds only geometry is taken, so style and other fields changed
   * elsewhere are never overwritten by the engine's copy. New features get a
   * top draw-order key and a numbered name when they arrive without one.
   */
  applyEngineChange(change: FeatureChange): EngineChangeResult {
    let created = 0;
    let reshaped = 0;
    let removed = 0;
    let neighboursRekeyed = false;
    const result = this.commit(
      () => {
        if (created > 0 && reshaped === 0 && removed === 0) return verbFeatures("Draw", "رسم", created);
        if (removed > 0 && created === 0 && reshaped === 0) return verbFeatures("Delete", "حذف", removed);
        if (reshaped > 0 && created === 0 && removed === 0) return verbFeatures("Reshape", "تعديل شكل", reshaped);
        return bi("Edit map", "تعديل الخريطة");
      },
      (draft) => {
        const locked = lockedGroups(draft.settings);
        const isLocked = (feature: MapFeature): boolean =>
          feature.locked || (feature.groupId !== null && locked.has(feature.groupId));
        const fresh: MapFeature[] = [];
        for (const incoming of change.put) {
          const current = draft.get(incoming.id);
          if (current === undefined) {
            fresh.push(incoming);
            continue;
          }
          if (isLocked(current)) continue;
          const next = withGeometry(current, incoming);
          if (next === null || sameFeature(next, current)) continue;
          draft.put(next);
          reshaped += 1;
        }
        if (fresh.length > 0) {
          const refusal = this.limitRefusal(draft, fresh.length);
          if (refusal !== undefined) return refusal;
          const existing = draft.sorted();
          const top = existing[existing.length - 1]?.order ?? null;
          const prepared = this.prepareNew(draft, fresh);
          const keepsOrder = prepared.every((feature, i) => {
            const below = i === 0 ? top : (prepared[i - 1]?.order ?? null);
            return feature.order !== "" && (below === null || feature.order > below);
          });
          if (keepsOrder) {
            for (const feature of prepared) draft.put(feature);
          } else {
            const allocation = allocateKeys(existing, existing.length, prepared.length);
            neighboursRekeyed = allocation.rekeyed.size > 0;
            insertAt(draft, prepared, (all) => all.length);
          }
          created = prepared.length;
        }
        for (const id of change.delete) {
          const current = draft.get(id);
          if (current === undefined || isLocked(current)) continue;
          draft.remove(id);
          removed += 1;
        }
        return undefined;
      },
      {
        coalesce: "gesture",
        sticky: true,
        seal: change.gesture === "commit",
        select: (done) =>
          done.added.length > 0 && change.gesture === "commit" ? { ids: done.added, groupId: null } : this.state.selection,
      },
    );
    if (change.gesture === "commit") this.closeStep();
    const features = this.state.doc.features;
    const inSync =
      result.ok &&
      !neighboursRekeyed &&
      change.put.every((sent) => {
        const held = features.get(sent.id);
        return held !== undefined && sameFeature(held, sent);
      }) &&
      change.delete.every((id) => !features.has(id));
    return { ...result, inSync };
  }

  /* -------------------------------------------------------------- deleting */

  /** Delete features. Locked ones are left alone. */
  deleteFeatures(ids?: readonly string[]): CommandResult {
    return this.commit(verbFeatures("Delete", "حذف", this.count(ids)), (draft) => {
      const { all, editable } = this.resolveTargets(draft, ids);
      if (all.length === 0) return { code: "no_target" };
      if (editable.length === 0) return { code: "locked" };
      for (const feature of editable) draft.remove(feature.id);
      return undefined;
    });
  }

  /* --------------------------------------------------------------- styling */

  /**
   * Change style properties on one or many features. Each feature takes the
   * properties its kind has. Changing something a preset governs detaches that
   * feature from the preset. Consecutive tweaks of the same properties on the
   * same targets are one undo step (a slider drag).
   */
  restyle(patch: StylePatch, ids?: readonly string[]): CommandResult {
    const properties = patchProperties(patch);
    if (properties.length === 0) return OK_UNCHANGED;
    const first = properties[0];
    const what =
      properties.length === 1 && first !== undefined ? stylePropertyLabel(first) : bi("style", "النمط");
    return this.commit(
      bi(`Change ${what.en}`, `تغيير ${what.ar}`),
      (draft) => {
        const presets = presetLookup(draft.settings.presets);
        return this.editEach(draft, ids, (feature) => applyStylePatch(feature, patch, presets));
      },
      { coalesce: `style:${properties.join("+")}:${this.idsKey(ids)}` },
    );
  }

  /** Make features follow a preset. Kinds the preset does not apply to are skipped. */
  applyPreset(presetId: string, ids?: readonly string[]): CommandResult {
    return this.commit(bi("Apply style preset", "تطبيق نمط محفوظ"), (draft) => {
      const preset = draft.settings.presets.find((candidate) => candidate.id === presetId);
      if (preset === undefined) return { code: "not_found", what: "preset" };
      return this.editEach(draft, ids, (feature) =>
        preset.appliesTo.includes(feature.kind) ? { ...feature, presetId } : feature,
      );
    });
  }

  /** Stop following the preset; the features keep its look as their own style. */
  detachPreset(ids?: readonly string[]): CommandResult {
    return this.commit(bi("Detach style preset", "فصل النمط المحفوظ"), (draft) => {
      const presets = presetLookup(draft.settings.presets);
      return this.editEach(draft, ids, (feature) => detachPreset(feature, presets));
    });
  }

  /** Copy the look of a feature (default: the primary selection). Works in read-only mode. */
  copyStyle(id?: string): CommandResult {
    const source = id ?? this.state.selection.ids[this.state.selection.ids.length - 1];
    const feature = source === undefined ? undefined : this.state.doc.features.get(source);
    if (feature === undefined) return this.refuse({ code: "no_target" });
    const style = copyStyleOf(feature, presetLookup(this.state.doc.settings.presets));
    this.set({ clipboard: { ...this.state.clipboard, style } });
    return OK_CHANGED;
  }

  /** Paste the copied look onto features, translating between kinds where it can. */
  pasteStyle(ids?: readonly string[]): CommandResult {
    const clip = this.state.clipboard.style;
    if (clip === null) return this.refuse({ code: "empty_clipboard" });
    return this.commit(bi("Paste style", "لصق النمط"), (draft) => {
      const presets = presetLookup(draft.settings.presets);
      return this.editEach(draft, ids, (feature) => pasteStyleOnto(feature, clip, presets));
    });
  }

  /** Rename a feature in the list. */
  renameFeature(id: string, name: RichText): CommandResult {
    return this.commit(
      bi("Rename feature", "إعادة تسمية العنصر"),
      (draft) => {
        const feature = draft.get(id);
        if (feature === undefined) return { code: "not_found", what: "feature" };
        draft.put({ ...feature, name });
        return undefined;
      },
      { coalesce: `rename:${id}` },
    );
  }

  /* -------------------------------------------------------------- ordering */

  /**
   * Move features next to another one in the draw order, keeping their order
   * among themselves. By default they also join the target's group, which is
   * what dropping a row inside a group means; pass `groupId` to choose.
   * In the list, rows read top-first, so "before row X" is `side: "above"`.
   */
  moveFeatures(ids: readonly string[], target: OrderTarget, options: { groupId?: string | null } = {}): CommandResult {
    return this.commit(verbFeatures("Move", "نقل", this.count(ids)), (draft) => {
      const { all } = this.resolveTargets(draft, ids);
      if (all.length === 0) return { code: "no_target" };
      const anchor = draft.get(target.relativeTo);
      if (anchor === undefined) return { code: "not_found", what: "feature" };
      if (all.some((feature) => feature.id === anchor.id)) {
        return { code: "invalid", detail: "A feature cannot be moved next to itself." };
      }
      const groupId = options.groupId === undefined ? anchor.groupId : options.groupId;
      if (groupId !== null && !draft.settings.groups.some((group) => group.id === groupId)) {
        return { code: "not_found", what: "group" };
      }
      placeAt(
        draft,
        all.map((feature) => feature.id),
        (others) => others.findIndex((feature) => feature.id === anchor.id) + (target.side === "above" ? 1 : 0),
        (feature) => (feature.groupId === groupId ? feature : { ...feature, groupId }),
      );
      return undefined;
    });
  }

  private orderLabel(ids: readonly string[] | undefined, verbEn: string, whereEn: string, verbAr: string, whereAr: string): Bilingual {
    const noun = featuresNoun(this.count(ids));
    return bi(`${verbEn} ${noun.en} ${whereEn}`, `${verbAr} ${noun.ar} ${whereAr}`);
  }

  /** Bring features to the top of the draw order. */
  bringToFront(ids?: readonly string[]): CommandResult {
    return this.commit(this.orderLabel(ids, "Bring", "to front", "إحضار", "إلى الأمام"), (draft) => {
      const { all } = this.resolveTargets(draft, ids);
      if (all.length === 0) return { code: "no_target" };
      placeAt(draft, all.map((feature) => feature.id), (others) => others.length);
      return undefined;
    });
  }

  /** Send features to the bottom of the draw order. */
  sendToBack(ids?: readonly string[]): CommandResult {
    return this.commit(this.orderLabel(ids, "Send", "to back", "إرسال", "إلى الخلف"), (draft) => {
      const { all } = this.resolveTargets(draft, ids);
      if (all.length === 0) return { code: "no_target" };
      placeAt(draft, all.map((feature) => feature.id), () => 0);
      return undefined;
    });
  }

  private step(ids: readonly string[] | undefined, direction: 1 | -1): CommandResult {
    const label =
      direction === 1
        ? this.orderLabel(ids, "Bring", "forward", "تقديم", "خطوة")
        : this.orderLabel(ids, "Send", "backward", "تأخير", "خطوة");
    return this.commit(label, (draft) => {
      const { all } = this.resolveTargets(draft, ids);
      if (all.length === 0) return { code: "no_target" };
      const selected = new Set(all.map((feature) => feature.id));
      const contexts = new Set(all.map((feature) => feature.groupId));
      for (const groupId of contexts) {
        const siblings = draft.sorted().filter((feature) => feature.groupId === groupId);
        /* Each selected feature passes the one unselected sibling next to it; the ones that passed the same sibling move as a block. */
        const passed = new Map<string, string[]>();
        let blocker: MapFeature | null = null;
        const scan = direction === 1 ? [...siblings].reverse() : siblings;
        let run: string[] = [];
        for (const feature of scan) {
          if (selected.has(feature.id)) {
            if (blocker !== null) run.push(feature.id);
            continue;
          }
          if (run.length > 0 && blocker !== null) passed.set(blocker.id, run);
          blocker = feature;
          run = [];
        }
        if (run.length > 0 && blocker !== null) passed.set(blocker.id, run);
        for (const [anchorId, movers] of passed) {
          placeAt(
            draft,
            movers,
            (others) => others.findIndex((feature) => feature.id === anchorId) + (direction === 1 ? 1 : 0),
          );
        }
      }
      return undefined;
    });
  }

  /** Move features one place up among their siblings (the same group, or the ungrouped features). */
  stepForward(ids?: readonly string[]): CommandResult {
    return this.step(ids, 1);
  }

  /** Move features one place down among their siblings. */
  stepBackward(ids?: readonly string[]): CommandResult {
    return this.step(ids, -1);
  }

  /** Move features into a group, or out of every group with null. Draw order does not change. */
  moveToGroup(groupId: string | null, ids?: readonly string[]): CommandResult {
    const label = groupId === null ? bi("Remove from group", "إخراج من المجموعة") : bi("Move into group", "نقل إلى المجموعة");
    return this.commit(label, (draft) => {
      if (groupId !== null && !draft.settings.groups.some((group) => group.id === groupId)) {
        return { code: "not_found", what: "group" };
      }
      return this.touchEach(draft, ids, (feature) => (feature.groupId === groupId ? feature : { ...feature, groupId }));
    });
  }

  /** Reorder groups in the list: put one before or after another. */
  moveGroup(groupId: string, target: { relativeTo: string; side: "before" | "after" }): CommandResult {
    return this.commit(bi("Reorder groups", "إعادة ترتيب المجموعات"), (draft) => {
      const groups = sortKeyed(draft.settings.groups);
      const moving = groups.find((group) => group.id === groupId);
      const others = groups.filter((group) => group.id !== groupId);
      const anchorIndex = others.findIndex((group) => group.id === target.relativeTo);
      if (moving === undefined || anchorIndex < 0) return { code: "not_found", what: "group" };
      const index = anchorIndex + (target.side === "after" ? 1 : 0);
      if (groups[index] === moving) return undefined;
      const allocation = allocateKeys(others, index, 1);
      const order = allocation.keys[0] ?? moving.order;
      draft.settings = {
        ...draft.settings,
        groups: draft.settings.groups.map((group) => {
          if (group.id === groupId) return { ...group, order };
          const rekeyed = allocation.rekeyed.get(group.id);
          return rekeyed === undefined ? group : { ...group, order: rekeyed };
        }),
      };
      return undefined;
    });
  }

  /* ------------------------------------------------------- hiding, locking */

  /** Hide or show features. Hidden features are never published. */
  setHidden(hidden: boolean, ids?: readonly string[]): CommandResult {
    const label = hidden
      ? verbFeatures("Hide", "إخفاء", this.count(ids))
      : verbFeatures("Show", "إظهار", this.count(ids));
    return this.commit(label, (draft) =>
      this.touchEach(draft, ids, (feature) => (feature.hidden === hidden ? feature : { ...feature, hidden })),
    );
  }

  /** Hide the targets, or show them if all are already hidden. */
  toggleHidden(ids?: readonly string[]): CommandResult {
    const features = this.targetIds(ids).map((id) => this.state.doc.features.get(id));
    const allHidden = features.length > 0 && features.every((feature) => feature === undefined || feature.hidden);
    return this.setHidden(!allHidden, ids);
  }

  /** Lock or unlock features. */
  setLocked(locked: boolean, ids?: readonly string[]): CommandResult {
    const label = locked
      ? verbFeatures("Lock", "قفل", this.count(ids))
      : verbFeatures("Unlock", "فتح قفل", this.count(ids));
    return this.commit(label, (draft) =>
      this.touchEach(draft, ids, (feature) => (feature.locked === locked ? feature : { ...feature, locked })),
    );
  }

  /** Lock the targets, or unlock them if all are already locked. */
  toggleLocked(ids?: readonly string[]): CommandResult {
    const features = this.targetIds(ids).map((id) => this.state.doc.features.get(id));
    const allLocked = features.length > 0 && features.every((feature) => feature === undefined || feature.locked);
    return this.setLocked(!allLocked, ids);
  }

  private editGroup(
    label: Bilingual,
    groupId: string,
    change: (group: FeatureGroup) => FeatureGroup,
    options: CommitOptions = {},
  ): CommandResult {
    return this.commit(
      label,
      (draft) => {
        if (!draft.settings.groups.some((group) => group.id === groupId)) return { code: "not_found", what: "group" };
        draft.settings = replaceGroup(draft.settings, groupId, change);
        return undefined;
      },
      options,
    );
  }

  /** Hide or show a group and everything in it as a unit. */
  setGroupHidden(groupId: string, hidden: boolean): CommandResult {
    const label = hidden ? bi("Hide group", "إخفاء المجموعة") : bi("Show group", "إظهار المجموعة");
    return this.editGroup(label, groupId, (group) => (group.hidden === hidden ? group : { ...group, hidden }));
  }

  /** Lock or unlock a group and everything in it as a unit. */
  setGroupLocked(groupId: string, locked: boolean): CommandResult {
    const label = locked ? bi("Lock group", "قفل المجموعة") : bi("Unlock group", "فتح قفل المجموعة");
    return this.editGroup(label, groupId, (group) => (group.locked === locked ? group : { ...group, locked }));
  }

  /**
   * Fold or unfold a group in the list. Folding is each person's own view, so
   * it is kept in this browser, never saved with the map and never an undo step.
   */
  setGroupCollapsed(groupId: string, collapsed: boolean): CommandResult {
    if (!this.state.doc.settings.groups.some((group) => group.id === groupId)) return { ok: false, refusal: { code: "not_found", what: "group" } };
    const current = this.state.view.collapsedGroups;
    if (current.has(groupId) === collapsed) return OK_UNCHANGED;
    const next = new Set(current);
    if (collapsed) next.add(groupId);
    else next.delete(groupId);
    writeCollapsedGroups(this.state.meta.id, next);
    this.set({ view: { ...this.state.view, collapsedGroups: next } });
    return OK_CHANGED;
  }

  /* ---------------------------------------------------------------- groups */

  /**
   * Create a group at the top of the list from features (default: the
   * selection; may be empty) and select it. Pass `id` (from `newId()`) to know
   * the group's id in advance.
   */
  createGroup(input: { name?: RichText; ids?: readonly string[]; id?: string } = {}): CommandResult {
    const id = input.id ?? newId();
    return this.commit(
      bi("Group features", "تجميع العناصر"),
      (draft) => {
        if (draft.settings.groups.some((group) => group.id === id)) {
          return { code: "invalid", detail: "A group with this id already exists." };
        }
        const groups = sortKeyed(draft.settings.groups);
        const allocation = allocateKeys(groups, 0, 1);
        const word = draft.uiDir === "rtl" ? "مجموعة" : "Group";
        const group: FeatureGroup = {
          id,
          name: input.name ?? rich(`${word} ${groups.length + 1}`, draft.uiDir),
          order: allocation.keys[0] ?? "V",
          hidden: false,
          locked: false,
        };
        draft.settings = {
          ...draft.settings,
          groups: [
            ...draft.settings.groups.map((existing) => {
              const order = allocation.rekeyed.get(existing.id);
              return order === undefined ? existing : { ...existing, order };
            }),
            group,
          ],
        };
        for (const feature of this.resolveTargets(draft, input.ids).all) draft.put({ ...feature, groupId: id });
        return undefined;
      },
      {
        select: (result) => ({
          ids: sortKeyed([...result.doc.features.values()].filter((feature) => feature.groupId === id)).map(
            (feature) => feature.id,
          ),
          groupId: id,
        }),
      },
    );
  }

  renameGroup(groupId: string, name: RichText): CommandResult {
    return this.editGroup(bi("Rename group", "إعادة تسمية المجموعة"), groupId, (group) => ({ ...group, name }), {
      coalesce: `rename-group:${groupId}`,
    });
  }

  private removeGroup(label: Bilingual, groupId: string, withFeatures: boolean): CommandResult {
    return this.commit(
      label,
      (draft) => {
        if (!draft.settings.groups.some((group) => group.id === groupId)) return { code: "not_found", what: "group" };
        draft.settings = {
          ...draft.settings,
          groups: draft.settings.groups.filter((group) => group.id !== groupId),
        };
        for (const feature of [...draft.values()]) {
          if (feature.groupId !== groupId) continue;
          if (withFeatures) draft.remove(feature.id);
          else draft.put({ ...feature, groupId: null });
        }
        return undefined;
      },
      {
        select: (result) => ({
          ids: this.state.selection.ids.filter((id) => result.doc.features.has(id)),
          groupId: null,
        }),
      },
    );
  }

  /** Dissolve a group; its features stay, ungrouped. */
  ungroup(groupId: string): CommandResult {
    return this.removeGroup(bi("Ungroup", "فك التجميع"), groupId, false);
  }

  /** Delete a group, either with its features or leaving them ungrouped. */
  deleteGroup(groupId: string, options: { withFeatures: boolean }): CommandResult {
    const label = options.withFeatures
      ? bi("Delete group and its features", "حذف المجموعة وعناصرها")
      : bi("Delete group", "حذف المجموعة");
    return this.removeGroup(label, groupId, options.withFeatures);
  }

  /* ------------------------------------------------------ dates and lineage */

  /** Set when features start and stop existing on the timeline. Omitted fields are left as they are. */
  setValidity(
    patch: { validFrom?: IsoDateTime | null; validTo?: IsoDateTime | null },
    ids?: readonly string[],
  ): CommandResult {
    const keys = [patch.validFrom !== undefined ? "from" : "", patch.validTo !== undefined ? "to" : ""].join("");
    return this.commit(
      bi("Change dates", "تغيير التواريخ"),
      (draft) => {
        let inverted = false;
        const refusal = this.editEach(draft, ids, (feature) => {
          const validFrom = patch.validFrom === undefined ? feature.validFrom : patch.validFrom;
          const validTo = patch.validTo === undefined ? feature.validTo : patch.validTo;
          if (validFrom !== null && validTo !== null && Date.parse(validFrom) > Date.parse(validTo)) inverted = true;
          return { ...feature, validFrom, validTo };
        });
        if (refusal !== undefined) return refusal;
        return inverted ? { code: "invalid", detail: "A feature cannot end before it starts." } : undefined;
      },
      { coalesce: `dates:${keys}:${this.idsKey(ids)}` },
    );
  }

  /** Set or clear the lineage id that links successive states of the same thing. */
  setLineage(lineageId: string | null, ids?: readonly string[]): CommandResult {
    const label = lineageId === null ? bi("Unlink from sequence", "فصل عن التسلسل") : bi("Link as sequence", "ربط كتسلسل");
    return this.commit(label, (draft) => this.editEach(draft, ids, (feature) => ({ ...feature, lineageId })));
  }

  /** Link the targets as successive states of one thing, reusing a lineage one of them already has. */
  linkLineage(ids?: readonly string[]): CommandResult {
    const existing = this.targetIds(ids)
      .map((id) => this.state.doc.features.get(id)?.lineageId ?? null)
      .find((lineageId) => lineageId !== null);
    return this.setLineage(existing ?? newId(), ids);
  }

  /**
   * "Continue this feature from here": end the feature at `at` (default: the
   * playhead) and start a copy there with the same lineage, placed just above
   * it and selected, ready to be reshaped.
   */
  continueFromHere(id?: string, at?: IsoDateTime): CommandResult {
    const sourceId = id ?? this.state.selection.ids[this.state.selection.ids.length - 1];
    const moment = at ?? this.state.timeline.playhead;
    return this.commit(
      bi("Continue feature from here", "متابعة العنصر من هنا"),
      (draft) => {
        const feature = sourceId === undefined ? undefined : draft.get(sourceId);
        if (feature === undefined) return { code: "no_target" };
        if (moment === null) return { code: "no_playhead" };
        const when = Date.parse(moment);
        if (Number.isNaN(when)) return { code: "invalid", detail: "The time is not a valid date." };
        if (feature.validFrom !== null && when <= Date.parse(feature.validFrom)) {
          return { code: "invalid", detail: "The feature has not started yet at this time." };
        }
        if (feature.validTo !== null && when >= Date.parse(feature.validTo)) {
          return { code: "invalid", detail: "The feature has already ended at this time." };
        }
        const refusal = this.limitRefusal(draft, 1);
        if (refusal !== undefined) return refusal;
        const lineageId = feature.lineageId ?? newId();
        const next: MapFeature = { ...feature, id: newId(), validFrom: moment, lineageId, locked: false };
        draft.put({ ...feature, validTo: moment, lineageId });
        insertAt(draft, [next], (existing) => existing.findIndex((other) => other.id === feature.id) + 1);
        return undefined;
      },
      { select: (result) => ({ ids: result.added, groupId: null }) },
    );
  }

  /* --------------------------------------------------------------- presets */

  /**
   * Create a preset from a feature's current look (default: the primary
   * selection) and make that feature follow it. Pass `id` to know the
   * preset's id in advance.
   */
  createPreset(input: { name: RichText; fromFeatureId?: string; id?: string }): CommandResult {
    const id = input.id ?? newId();
    const sourceId = input.fromFeatureId ?? this.state.selection.ids[this.state.selection.ids.length - 1];
    return this.commit(bi("Create style preset", "إنشاء نمط محفوظ"), (draft) => {
      const source = sourceId === undefined ? undefined : draft.get(sourceId);
      if (source === undefined) return { code: "no_target" };
      const style = presetStyleFrom(source, presetLookup(draft.settings.presets));
      if (style === null) return { code: "invalid", detail: "Text annotations cannot define a style preset." };
      if (draft.settings.presets.some((preset) => preset.id === id)) {
        return { code: "invalid", detail: "A preset with this id already exists." };
      }
      const preset: StylePreset = { id, name: input.name, ...style };
      draft.settings = { ...draft.settings, presets: [...draft.settings.presets, preset] };
      draft.put({ ...source, presetId: id });
      return undefined;
    });
  }

  /**
   * Edit a preset; every feature using it follows. If `appliesTo` drops a
   * kind, features of that kind keep the look as their own style.
   */
  updatePreset(
    presetId: string,
    patch: { fill?: Partial<Fill>; stroke?: Partial<Stroke>; iconColor?: ColorRef; appliesTo?: FeatureKind[] },
  ): CommandResult {
    const keys = [
      ...Object.keys(patch.fill ?? {}).map((key) => `fill.${key}`),
      ...Object.keys(patch.stroke ?? {}).map((key) => `stroke.${key}`),
      ...(patch.iconColor !== undefined ? ["iconColor"] : []),
      ...(patch.appliesTo !== undefined ? ["appliesTo"] : []),
    ].sort();
    return this.commit(
      bi("Edit style preset", "تعديل النمط المحفوظ"),
      (draft) => {
        const preset = draft.settings.presets.find((candidate) => candidate.id === presetId);
        if (preset === undefined) return { code: "not_found", what: "preset" };
        const appliesTo = patch.appliesTo?.filter((kind) => PRESET_KINDS.includes(kind)) ?? preset.appliesTo;
        const before = presetLookup(draft.settings.presets);
        for (const feature of [...draft.values()]) {
          if (feature.presetId === presetId && !appliesTo.includes(feature.kind)) {
            draft.put(detachPreset(feature, before));
          }
        }
        const fill = patch.fill !== undefined && preset.fill !== undefined ? { ...preset.fill, ...patch.fill } : preset.fill;
        const stroke =
          patch.stroke !== undefined && preset.stroke !== undefined ? { ...preset.stroke, ...patch.stroke } : preset.stroke;
        const iconColor = patch.iconColor ?? preset.iconColor;
        const next: StylePreset = {
          id: preset.id,
          name: preset.name,
          appliesTo,
          ...(fill !== undefined ? { fill } : {}),
          ...(stroke !== undefined ? { stroke } : {}),
          ...(iconColor !== undefined ? { iconColor } : {}),
        };
        if (deepEqual(next, preset)) return undefined;
        draft.settings = {
          ...draft.settings,
          presets: draft.settings.presets.map((candidate) => (candidate.id === presetId ? next : candidate)),
        };
        return undefined;
      },
      { coalesce: `preset:${presetId}:${keys.join("+")}` },
    );
  }

  /**
   * Add complete presets that no feature uses yet (a new blank style, or a
   * starter set) as one undo step. Ids already taken are refused.
   */
  addPresets(presets: readonly StylePreset[]): CommandResult {
    if (presets.length === 0) return OK_UNCHANGED;
    return this.commit(
      presets.length === 1 ? bi("Create style preset", "إنشاء نمط محفوظ") : bi("Add style presets", "إضافة أنماط محفوظة"),
      (draft) => {
        const taken = new Set(draft.settings.presets.map((preset) => preset.id));
        for (const preset of presets) {
          if (taken.has(preset.id)) return { code: "invalid", detail: "A preset with this id already exists." };
          taken.add(preset.id);
        }
        const added = presets.map((preset) => ({
          ...preset,
          appliesTo: preset.appliesTo.filter((kind) => PRESET_KINDS.includes(kind)),
        }));
        draft.settings = { ...draft.settings, presets: [...draft.settings.presets, ...added] };
        return undefined;
      },
    );
  }

  renamePreset(presetId: string, name: RichText): CommandResult {
    return this.commit(
      bi("Rename style preset", "إعادة تسمية النمط المحفوظ"),
      (draft) => {
        if (!draft.settings.presets.some((preset) => preset.id === presetId)) return { code: "not_found", what: "preset" };
        draft.settings = {
          ...draft.settings,
          presets: draft.settings.presets.map((preset) => (preset.id === presetId ? { ...preset, name } : preset)),
        };
        return undefined;
      },
      { coalesce: `rename-preset:${presetId}` },
    );
  }

  /** Delete a preset. Features that used it keep the look as their own style. */
  deletePreset(presetId: string): CommandResult {
    const result = this.commit(bi("Delete style preset", "حذف النمط المحفوظ"), (draft) => {
      if (!draft.settings.presets.some((preset) => preset.id === presetId)) return { code: "not_found", what: "preset" };
      const before = presetLookup(draft.settings.presets);
      for (const feature of [...draft.values()]) {
        if (feature.presetId === presetId) draft.put(detachPreset(feature, before));
      }
      draft.settings = {
        ...draft.settings,
        presets: draft.settings.presets.filter((preset) => preset.id !== presetId),
        legend: {
          ...draft.settings.legend,
          items: draft.settings.legend.items.filter(
            (item) => !("presetId" in item.ref && item.ref.presetId === presetId),
          ),
        },
      };
      return undefined;
    });
    if (result.ok && result.changed) {
      const defaults = this.state.drawDefaults;
      const clear = <T extends { presetId: string | null }>(entry: T): T =>
        entry.presetId === presetId ? { ...entry, presetId: null } : entry;
      this.set({
        drawDefaults: {
          ...defaults,
          area: clear(defaults.area),
          line: clear(defaults.line),
          arrow: clear(defaults.arrow),
          frontline: clear(defaults.frontline),
          point: clear(defaults.point),
        },
      });
    }
    return result;
  }

  /* ---------------------------------------------------------------- legend */

  private editSettings(
    label: Bilingual,
    coalesce: string | null,
    change: (settings: MapSettings, draft: Draft) => MapSettings | Refusal,
  ): CommandResult {
    return this.commit(
      label,
      (draft) => {
        const next = change(draft.settings, draft);
        if ("code" in next) return next;
        if (!deepEqual(next, draft.settings)) draft.settings = next;
        return undefined;
      },
      coalesce === null ? {} : { coalesce },
    );
  }

  /** Show or hide the map key, retitle it or move it to another corner. */
  setLegend(patch: Partial<Pick<MapSettings["legend"], "show" | "title" | "position">>): CommandResult {
    return this.editSettings(
      bi("Change map key", "تغيير مفتاح الخريطة"),
      `legend:${Object.keys(patch).sort().join("+")}`,
      (settings) => ({ ...settings, legend: { ...settings.legend, ...patch } }),
    );
  }

  private editLegendItems(
    label: Bilingual,
    coalesce: string | null,
    change: (items: LegendItem[], draft: Draft) => LegendItem[] | Refusal,
  ): CommandResult {
    return this.editSettings(label, coalesce, (settings, draft) => {
      const next = change(materialiseLegend(settings, draft.values()), draft);
      return Array.isArray(next) ? { ...settings, legend: { ...settings.legend, items: next } } : next;
    });
  }

  /** Override an entry's label (null restores the preset or feature name) or hide it from the key. */
  setLegendItem(ref: LegendItem["ref"], patch: { label?: RichText | null; hidden?: boolean }): CommandResult {
    const key = legendKey(ref);
    return this.editLegendItems(
      bi("Edit map key entry", "تعديل عنصر في مفتاح الخريطة"),
      `legend-item:${key}:${Object.keys(patch).sort().join("+")}`,
      (items) => {
        if (!items.some((item) => legendKey(item.ref) === key)) return { code: "not_found", what: "legend_item" };
        return items.map((item) => (legendKey(item.ref) === key ? { ...item, ...patch } : item));
      },
    );
  }

  /** Move an entry to a position in the key (0 is first). */
  moveLegendItem(ref: LegendItem["ref"], toIndex: number): CommandResult {
    const key = legendKey(ref);
    return this.editLegendItems(bi("Reorder map key", "إعادة ترتيب مفتاح الخريطة"), null, (items) => {
      const from = items.findIndex((item) => legendKey(item.ref) === key);
      const moving = items[from];
      if (moving === undefined) return { code: "not_found", what: "legend_item" };
      const rest = items.filter((_, index) => index !== from);
      rest.splice(Math.max(0, Math.min(toIndex, rest.length)), 0, moving);
      return rest;
    });
  }

  /** Give a feature without a preset its own entry in the key. */
  addLegendFeature(featureId: string): CommandResult {
    return this.editLegendItems(bi("Add to map key", "إضافة إلى مفتاح الخريطة"), null, (items, draft) => {
      const feature = draft.get(featureId);
      if (feature === undefined) return { code: "not_found", what: "feature" };
      const preset = draft.settings.presets.find((candidate) => candidate.id === feature.presetId);
      if (preset !== undefined && preset.appliesTo.includes(feature.kind)) {
        return { code: "invalid", detail: "This feature follows a preset, which already has an entry." };
      }
      if (items.some((item) => "featureId" in item.ref && item.ref.featureId === featureId)) return items;
      return [...items, { ref: { featureId }, label: null, hidden: false }];
    });
  }

  /** Take a single-feature entry out of the key. A preset entry is hidden instead, since it is derived. */
  removeLegendItem(ref: LegendItem["ref"]): CommandResult {
    if ("presetId" in ref) return this.setLegendItem(ref, { hidden: true });
    const key = legendKey(ref);
    return this.editSettings(bi("Remove from map key", "إزالة من مفتاح الخريطة"), null, (settings) => ({
      ...settings,
      legend: { ...settings.legend, items: settings.legend.items.filter((item) => legendKey(item.ref) !== key) },
    }));
  }

  /* ---------------------------------------------------------- map settings */

  /** Title block fields: show, subtitle, source, credit, note and the "as of" stamp. */
  setTitleBlock(patch: Partial<MapSettings["titleBlock"]>): CommandResult {
    return this.editSettings(
      bi("Edit title block", "تعديل ترويسة الخريطة"),
      `titleBlock:${Object.keys(patch).sort().join("+")}`,
      (settings) => ({ ...settings, titleBlock: { ...settings.titleBlock, ...patch } }),
    );
  }

  /** Set the "as of" stamp; null hides it. */
  setAsOf(asOf: IsoDateTime | null): CommandResult {
    return this.editSettings(bi("Change “as of” time", "تغيير وقت «حتى تاريخ»"), "titleBlock:asOf", (settings) => ({
      ...settings,
      titleBlock: { ...settings.titleBlock, asOf },
    }));
  }

  /** Basemap style and the language its labels are pinned to. */
  setBasemap(patch: Partial<MapSettings["basemap"]>): CommandResult {
    return this.editSettings(bi("Change basemap", "تغيير خريطة الأساس"), null, (settings) => ({
      ...settings,
      basemap: { ...settings.basemap, ...patch },
    }));
  }

  /** What readers open on. Pass the controller's current viewport for "use this view". */
  setOpeningView(view: Viewport): CommandResult {
    return this.editSettings(bi("Set opening view", "تحديد العرض الافتتاحي"), null, (settings) => ({
      ...settings,
      openingView: view,
    }));
  }

  /** Embed options: legend, zoom buttons, scale bar, cooperative gestures, static mode, theme. */
  setEmbed(patch: Partial<MapSettings["embed"]>): CommandResult {
    return this.editSettings(bi("Change embed options", "تغيير خيارات التضمين"), null, (settings) => ({
      ...settings,
      embed: { ...settings.embed, ...patch },
    }));
  }

  /** Timeline settings: enabled, moving or cumulative, playback speed. */
  setTimelineSettings(patch: Partial<MapSettings["timeline"]>): CommandResult {
    return this.editSettings(
      bi("Change timeline settings", "تغيير إعدادات الخط الزمني"),
      `timeline:${Object.keys(patch).sort().join("+")}`,
      (settings) => ({ ...settings, timeline: { ...settings.timeline, ...patch } }),
    );
  }

  /** Retitle the map. */
  setTitle(title: RichText): CommandResult {
    return this.commit(
      bi("Change map title", "تغيير عنوان الخريطة"),
      (draft) => {
        if (!deepEqual(draft.title, title)) draft.title = title;
        return undefined;
      },
      { coalesce: "title" },
    );
  }

  /** Switch the editor and the published map's furniture between left-to-right and right-to-left. */
  setUiDir(uiDir: UiDir): CommandResult {
    return this.commit(bi("Change map direction", "تغيير اتجاه الخريطة"), (draft) => {
      draft.uiDir = uiDir;
      return undefined;
    });
  }

  /* ---------------------------------------------------------------- saving */

  /**
   * Save what changed since the last save. Resolves with the resulting save
   * state (also in `state.save`); never rejects. Edits made while the request
   * is in flight stay unsaved and are picked up by the next save. A second
   * call during a save returns the same pending result.
   *
   * `force: true` is "keep mine" after a stale revision: it overwrites what
   * the server holds for the features and settings this editor changed.
   */
  save(api: ApiClient, options: { force?: boolean } = {}): Promise<SaveState> {
    if (this.saving !== null) return this.saving;
    const readOnly = this.state.access.readOnly;
    if (readOnly !== null) {
      const refused: SaveState = { kind: "not_permitted", why: readOnly, reason: null };
      this.set({ save: refused });
      return Promise.resolve(refused);
    }
    const sent = this.state.doc;
    const changes = changeSet(this.state.baseline, sent);
    if (changes.empty) {
      const nothing: SaveState = { kind: "nothing_to_save" };
      this.set({ save: nothing });
      return Promise.resolve(nothing);
    }
    this.closeStep();
    this.set({ save: { kind: "saving", startedAt: this.now().getTime() } });
    const request = toEditRequest(changes, this.state.meta.rev, options.force === true);
    const run = async (): Promise<SaveState> => {
      let next: SaveState;
      try {
        const saved = await api.editMap(this.state.meta.id, request);
        next = { kind: "saved", at: saved.updatedAt, rev: saved.rev };
        this.saving = null;
        this.set({
          baseline: sent,
          meta: { ...this.state.meta, rev: saved.rev, updatedAt: saved.updatedAt, updatedBy: this.state.access.userId },
          save: next,
        });
      } catch (error) {
        next = saveStateFromError(error, this.now().getTime(), changes.put.length);
        this.saving = null;
        this.set({ save: next });
      }
      return next;
    };
    /* Deferred by a microtask so `saving` is assigned before `run` can clear it. */
    this.saving = Promise.resolve().then(run);
    return this.saving;
  }

  /**
   * "Reload theirs" after a stale revision: replace the document with what the
   * server holds now. This is one undo step, so the user's unsaved work comes
   * back with Undo — after which saving writes it over the reloaded version.
   */
  async reloadTheirs(api: ApiClient): Promise<SaveState> {
    let loaded: { map: MapDoc; features: MapFeature[] };
    try {
      loaded = await api.getMap(this.state.meta.id);
    } catch (error) {
      const failed = saveStateFromError(error, this.now().getTime(), 0);
      this.set({ save: failed });
      return failed;
    }
    const theirs = docFrom(loaded.map, loaded.features);
    const draft = new Draft(this.state.doc, { at: loaded.map.updatedAt, by: loaded.map.updatedBy });
    for (const feature of [...draft.values()]) if (!theirs.features.has(feature.id)) draft.remove(feature.id);
    for (const feature of theirs.features.values()) {
      const mine = draft.get(feature.id);
      if (mine === undefined || !sameFeature(mine, feature)) draft.putExact(feature);
    }
    if (!deepEqual(draft.settings, theirs.settings)) draft.settings = theirs.settings;
    if (!deepEqual(draft.title, theirs.title)) draft.title = theirs.title;
    draft.uiDir = theirs.uiDir;
    const result = draft.finish();
    const doc = result?.doc ?? this.state.doc;
    let history = this.state.history;
    if (result !== null) {
      this.stepSeq += 1;
      const step: HistoryStep = {
        id: this.stepSeq,
        label: bi("Load the newer version", "تحميل النسخة الأحدث"),
        undo: result.undo,
        redo: result.redo,
        selectionBefore: this.state.selection,
        selectionAfter: pruneSelection(this.state.selection, doc),
        coalesceKey: null,
        touchedAt: this.now().getTime(),
        open: false,
      };
      history = { undo: [...history.undo, step].slice(-HISTORY_LIMIT), redo: [] };
    }
    const next: SaveState = { kind: "saved", at: loaded.map.updatedAt, rev: loaded.map.rev };
    this.set({
      doc,
      baseline: doc,
      selection: pruneSelection(this.state.selection, doc),
      history,
      meta: {
        ...this.state.meta,
        rev: loaded.map.rev,
        publishedVersion: loaded.map.publishedVersion,
        publishedRev: loaded.map.publishedRev,
        updatedAt: loaded.map.updatedAt,
        updatedBy: loaded.map.updatedBy,
      },
      save: next,
    });
    return next;
  }

  /**
   * Publish the draft. Unsaved changes are saved first; if that fails the
   * publish state is `save_failed` and the save state says why. Resolves with
   * the resulting publish state (also in `state.publish`); never rejects.
   */
  async publish(api: ApiClient): Promise<PublishState> {
    const finish = (next: PublishState): PublishState => {
      this.set({ publish: next });
      return next;
    };
    if (this.state.publish.kind === "publishing") return this.state.publish;
    if (!this.state.access.canPublish) {
      return finish({ kind: "not_permitted", why: this.state.meta.archived ? "archived" : "forbidden", reason: null });
    }
    this.set({ publish: { kind: "publishing", startedAt: this.now().getTime() } });
    const unsaved = (): boolean => this.saving !== null || !changeSet(this.state.baseline, this.state.doc).empty;
    for (let attempt = 0; attempt < 2 && unsaved(); attempt++) {
      const saved = await this.save(api);
      if (saved.kind !== "saved" && saved.kind !== "nothing_to_save") return finish({ kind: "save_failed" });
    }
    const rev = this.state.meta.rev;
    try {
      const done = await api.publishMap(this.state.meta.id);
      this.set({ meta: { ...this.state.meta, publishedVersion: done.version, publishedRev: rev } });
      return finish(
        done.status === "published"
          ? { kind: "published", version: done.version, etag: done.etag, at: this.now().getTime() }
          : { kind: "unchanged", version: done.version },
      );
    } catch (error) {
      return finish(publishStateFromError(error, this.now().getTime()));
    }
  }

  /**
   * Take over what the server now says is live (after a publish or rollback
   * made elsewhere). Nothing else of a refetched map is ever applied: the
   * document on screen belongs to the editor.
   */
  setPublished(publishedVersion: number | null, publishedRev: number | null): void {
    const meta = this.state.meta;
    if (meta.publishedVersion === publishedVersion && meta.publishedRev === publishedRev) return;
    this.set({ meta: { ...meta, publishedVersion, publishedRev } });
  }

  /** Return the save and publish states to idle once their notices have been dismissed. */
  acknowledge(): void {
    const save: SaveState = this.state.save.kind === "saving" ? this.state.save : { kind: "idle" };
    const publish: PublishState = this.state.publish.kind === "publishing" ? this.state.publish : { kind: "idle" };
    this.set({ save, publish });
  }
}

/** Create the store for one open map from what `ApiClient.getMap` returned. */
export function createEditorStore(init: EditorStoreInit): EditorStore {
  return new EditorStore(init);
}
