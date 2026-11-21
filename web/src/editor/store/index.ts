/**
 * The editor's document store: the in-memory map, every operation on it,
 * undo and redo, selection, interface state, saving and publishing.
 *
 * How the pieces are used:
 *
 * - `createEditorStore({ map, features, session })` once per open map, then
 *   `<EditorStoreProvider store={store}>`.
 * - Read with `useEditorStore(selector)` and the `select*` functions; act with
 *   the methods of `useEditorStoreApi()`. Every command returns a
 *   `CommandResult` and never throws; refusals also land in `state.refusal`.
 * - `useConnectController(controller)` wires the map engine in both directions.
 * - `store.save(api)` / `store.publish(api)` resolve with typed states that
 *   are also in `state.save` / `state.publish`.
 * - `importGeoJson`, `exportGeoJson`, `parseCoordinates` and `diffVersions`
 *   are pure and need no store.
 * - `SHORTCUTS` is the one table of commands and keys; `matchShortcut` and
 *   `runCommand` turn a key press into an action.
 */

export { createEditorStore, EditorStore, COALESCE_MS, DEFAULT_WINDOW_MS, HISTORY_LIMIT } from "./store";
export type { EditorStoreInit, EngineChangeResult, OrderTarget } from "./store";

export type {
  Access,
  CommandResult,
  EditorState,
  HistoryState,
  HistoryStep,
  LiveState,
  MapMeta,
  PublishState,
  ReadOnlyReason,
  Refusal,
  SaveState,
  Selection,
  TimelineState,
  ViewState,
} from "./state";

export {
  memoLast,
  selectChangeSet,
  selectControllerDrawDefaults,
  selectCounts,
  selectDraftStatus,
  selectDrawOrder,
  selectFeature,
  selectHistoryInfo,
  selectIsDirty,
  selectLegend,
  selectListTree,
  selectPresetLookup,
  selectResolvedStyle,
  selectSaveStatus,
  selectTimeExtent,
  selectTimeHistogram,
  selectTimeWindow,
  selectTimelineUsable,
  selectVisibleAtPlayhead,
} from "./selectors";
export type {
  Counts,
  DraftStatus,
  FeatureRow,
  GroupRow,
  HistoryInfo,
  LimitStatus,
  ListTree,
  SaveStatus,
  Visibility,
} from "./selectors";

export { selectSelectedSet, selectSelectionSummary } from "./selection-summary";
export type { Mixed, SelectionSummary } from "./selection-summary";

export { changeSet, deepEqual, docFrom, sameFeature } from "./doc";
export type { ChangeSet, Doc, Patch, UiDir } from "./doc";

export { PRESET_KINDS, presetLookup, resolveStyle, swatchOf } from "./style";
export type { PresetLookup, ResolvedStyle, StyleClipboard, Swatch } from "./style";
export { STYLE_PROPERTIES, applyStylePatch, readStyle, stylePropertyLabel } from "./style-properties";
export type { StylePatch, StyleProperty, StyleValues } from "./style-properties";

export {
  DEFAULT_LABEL_STYLE,
  buildFeature,
  controllerDrawDefaults,
  defaultFeatureName,
  defaultStroke,
  initialDrawDefaults,
} from "./defaults";
export type { DrawDefaults, NewFeatureContext, NewGeometry } from "./defaults";

export { legendEntries, legendKey } from "./legend";
export type { LegendEntry } from "./legend";

export { MAX_KEY_LENGTH, allocateKeys, sortKeyed } from "./ordering";
export type { KeyAllocation, Keyed } from "./ordering";

export { eventTimes, isValidInWindow, timeExtent, timeHistogram, timeWindowFor, toIso } from "./time";
export type { TimeBucket, TimeExtent, TimeWindow } from "./time";

export { publishStateFromError, saveStateFromError, secondsUntil } from "./save";

export { connectController } from "./wiring";

export { MAX_LATITUDE, importGeoJson } from "./geojson-import";
export type { ImportOptions, ImportResult, ImportedItem, SkipReason, SkippedItem } from "./geojson-import";
export { PALETTE_HEX, exportGeoJson } from "./geojson-export";
export type { ExportCollection, ExportFeature, ExportGeometry, ExportOptions } from "./geojson-export";

export { formatCoordinates, parseCoordinates } from "./coordinates";

export { ASPECT_LABELS, diffVersions } from "./diff";
export type { ChangedFeature, DiffFeature, FeatureAspect, SettingArea, SettingChange, VersionDiff } from "./diff";

export {
  SHORTCUTS,
  SHORTCUT_SECTIONS,
  formatShortcut,
  matchShortcut,
  runCommand,
  shortcutFor,
  shortcutForTool,
} from "./shortcuts";
export type {
  CommandEnvironment,
  CommandId,
  KeyLike,
  ShortcutContext,
  ShortcutDef,
  ShortcutSection,
  ShortcutSituation,
} from "./shortcuts";

export { KIND_NAMES, bi, countFeatures, featuresNoun, newId, rich, verbFeatures } from "./text";
export type { Bilingual } from "./text";

export {
  EditorStoreProvider,
  shallowEqual,
  useConnectController,
  useEditorStore,
  useEditorStoreApi,
  useRetryCountdown,
  useTimelinePlayback,
} from "./react";
