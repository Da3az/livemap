import type { ApiClient } from "@/api/client";
import type { ThemeChoice } from "@/app/providers";
import type { EditorController } from "@/editor/controller";
import {
  KIND_NAMES,
  SHORTCUTS,
  formatShortcut,
  runCommand,
  selectDrawOrder,
  selectTimelineUsable,
  type CommandId,
  type EditorState,
  type EditorStore,
  type ShortcutDef,
  type ShortcutSection,
} from "@/editor/store";
import type { Lang } from "@/i18n";
import type { ExtrasStrings } from "@/i18n/editor-extras";
import type { BasemapStyleId, LabelLanguage } from "@/model/types";
import { requestTransfer } from "../shared/bus";
import { downloadGeoJson } from "../transfer/geojson-export";
import { fold, matchScore } from "./fuzzy";

export type PaletteGroupId = "recent" | "places" | "features" | ShortcutSection | "styles" | "basemap" | "labels" | "direction" | "theme" | "transfer";

export interface PaletteEntry {
  /** Stable across sessions, so it can be remembered as recent. */
  id: string;
  group: Exclude<PaletteGroupId, "recent">;
  label: string;
  /** Secondary text at the end: a feature's kind, a place's country. */
  detail?: string;
  /** The shortcut, already formatted for the platform. */
  keys?: string;
  /** Set when the command cannot run now; shown instead of hiding the command. */
  disabledReason?: string;
  /** The current value of a setting. */
  checked?: boolean;
  /** For one value of a setting: the setting's current value, in words. */
  current?: string;
  /** Folded text the query is matched against. */
  haystack: string;
  /** False for results that only make sense for one query (a place, a feature). */
  memorable: boolean;
  run: () => void;
}

export interface PaletteContext {
  state: EditorState;
  store: EditorStore;
  api: ApiClient;
  controller: EditorController | null;
  lang: Lang;
  mac: boolean;
  t: ExtrasStrings["palette"];
  names: ExtrasStrings["names"];
  theme: ThemeChoice;
  setTheme: (choice: ThemeChoice) => void;
  openPreview: () => void;
  openVersions: () => void;
}

/** Commands that change the document, and so are refused on a read-only map. */
const EDITING = new Set<CommandId>([
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.paste",
  "edit.duplicate",
  "edit.delete",
  "edit.pasteStyle",
  "edit.reshape",
  "arrange.group",
  "arrange.ungroup",
  "arrange.toggleHidden",
  "arrange.toggleLocked",
  "arrange.front",
  "arrange.back",
  "arrange.forward",
  "arrange.backward",
  "file.save",
  "file.publish",
]);

function reasonFor(shortcut: ShortcutDef, context: PaletteContext): string | undefined {
  const { state, t } = context;
  const readOnly = state.access.readOnly !== null;
  const edits = shortcut.tool !== undefined ? shortcut.tool !== "select" : EDITING.has(shortcut.id);
  if (readOnly && edits) return t.readOnly;
  if (shortcut.context === "selection" && state.selection.ids.length === 0) return t.nothingSelected;
  if (shortcut.context === "timeline" && !selectTimelineUsable(state)) return t.timelineOff;
  switch (shortcut.id) {
    case "edit.undo":
      return state.history.undo.length === 0 ? t.nothingToUndo : undefined;
    case "edit.redo":
      return state.history.redo.length === 0 ? t.nothingToRedo : undefined;
    case "edit.paste":
      return state.clipboard.features.length === 0 ? t.clipboardEmpty : undefined;
    case "edit.pasteStyle":
      return state.clipboard.style === null ? t.noStyleCopied : undefined;
    case "file.publish":
      return state.access.canPublish ? undefined : t.cannotPublish;
    case "view.zoomToFit":
    case "view.zoomToSelection":
      return context.controller === null ? t.mapLoading : undefined;
    default:
      return undefined;
  }
}

function haystack(...parts: string[]): string {
  return fold(parts.join(" "));
}

const BASEMAPS: BasemapStyleId[] = ["positron", "bright", "liberty", "dark", "fiord"];
const LABEL_LANGUAGES: LabelLanguage[] = ["ar", "en", "local"];
const THEMES: ThemeChoice[] = ["light", "dark", "system"];

/** Every command that does not depend on what was typed. */
export function buildEntries(context: PaletteContext): PaletteEntry[] {
  const { state, store, api, controller, lang, mac, t, names } = context;
  const readOnly = state.access.readOnly !== null ? t.readOnly : undefined;
  const noSelection = state.selection.ids.length === 0 ? t.nothingSelected : undefined;
  const entries: PaletteEntry[] = [];

  for (const shortcut of SHORTCUTS) {
    const keys = formatShortcut(shortcut.keys, mac);
    entries.push({
      id: shortcut.id,
      group: shortcut.section,
      label: shortcut.label[lang],
      keys,
      disabledReason: reasonFor(shortcut, context),
      haystack: haystack(shortcut.label.en, shortcut.label.ar),
      memorable: true,
      run: () => void runCommand(shortcut.id, { store, api, controller }),
    });
  }

  entries.push(
    {
      id: "nav.preview",
      group: "file",
      label: t.openPreview,
      haystack: haystack(t.openPreview, "preview reader معاينة"),
      memorable: true,
      run: context.openPreview,
    },
    {
      id: "nav.versions",
      group: "file",
      label: t.openVersions,
      haystack: haystack(t.openVersions, "versions history rollback الإصدارات"),
      memorable: true,
      run: context.openVersions,
    },
  );

  for (const preset of state.doc.settings.presets) {
    entries.push({
      id: `style:${preset.id}`,
      group: "styles",
      label: t.applyStyle(preset.name.value),
      disabledReason: readOnly ?? noSelection,
      haystack: haystack(preset.name.value, "style preset نمط"),
      memorable: true,
      run: () => void store.applyPreset(preset.id),
    });
  }

  for (const styleId of BASEMAPS) {
    entries.push({
      id: `basemap:${styleId}`,
      group: "basemap",
      label: t.basemap(names.basemap[styleId]),
      checked: state.doc.settings.basemap.styleId === styleId,
      current: names.basemap[state.doc.settings.basemap.styleId],
      disabledReason: readOnly,
      haystack: haystack(names.basemap[styleId], styleId, "basemap خريطة الأساس"),
      memorable: true,
      run: () => void store.setBasemap({ styleId }),
    });
  }
  for (const labelLanguage of LABEL_LANGUAGES) {
    entries.push({
      id: `labels:${labelLanguage}`,
      group: "labels",
      label: t.labels(names.labelLanguage[labelLanguage]),
      checked: state.doc.settings.basemap.labelLanguage === labelLanguage,
      current: names.labelLanguage[state.doc.settings.basemap.labelLanguage],
      disabledReason: readOnly,
      haystack: haystack(names.labelLanguage[labelLanguage], "labels language لغة التسميات"),
      memorable: true,
      run: () => void store.setBasemap({ labelLanguage }),
    });
  }
  for (const uiDir of ["ltr", "rtl"] as const) {
    entries.push({
      id: `direction:${uiDir}`,
      group: "direction",
      label: t.direction(names.direction[uiDir]),
      checked: state.doc.uiDir === uiDir,
      current: names.direction[state.doc.uiDir],
      disabledReason: readOnly,
      haystack: haystack(names.direction[uiDir], uiDir, "direction اتجاه"),
      memorable: true,
      run: () => void store.setUiDir(uiDir),
    });
  }
  for (const theme of THEMES) {
    entries.push({
      id: `theme:${theme}`,
      group: "theme",
      label: t.theme(names.theme[theme]),
      checked: context.theme === theme,
      current: names.theme[context.theme],
      haystack: haystack(names.theme[theme], theme, "theme appearance المظهر"),
      memorable: true,
      run: () => context.setTheme(theme),
    });
  }

  entries.push(
    {
      id: "transfer.import",
      group: "transfer",
      label: t.importGeoJson,
      disabledReason: readOnly,
      haystack: haystack(t.importGeoJson, "import geojson file استيراد"),
      memorable: true,
      run: () => requestTransfer("import"),
    },
    {
      id: "transfer.geojson",
      group: "transfer",
      label: t.exportGeoJson,
      haystack: haystack(t.exportGeoJson, "export geojson download تصدير"),
      memorable: true,
      run: () => void downloadGeoJson(store.getState(), "all", false),
    },
    {
      id: "transfer.geojsonSelection",
      group: "transfer",
      label: t.exportSelection,
      disabledReason: noSelection,
      haystack: haystack(t.exportSelection, "export geojson selection تصدير التحديد"),
      memorable: true,
      run: () => void downloadGeoJson(store.getState(), "selection", true),
    },
    {
      id: "transfer.image",
      group: "transfer",
      label: t.exportImage,
      haystack: haystack(t.exportImage, "export image png picture صورة تصدير"),
      memorable: true,
      run: () => requestTransfer("image"),
    },
  );
  return entries;
}

const FEATURE_LIMIT = 8;

/** Features whose name answers the query, best first. Selecting one selects it on the map. */
export function featureEntries(context: PaletteContext, query: string): PaletteEntry[] {
  if (query.length < 2) return [];
  const { state, store, lang, t } = context;
  const scored: { entry: PaletteEntry; score: number }[] = [];
  for (const feature of selectDrawOrder(state)) {
    const text = fold(feature.name.value);
    const score = matchScore(query, text);
    if (score === null) continue;
    scored.push({
      score: score + text.length / 1000,
      entry: {
        id: `feature:${feature.id}`,
        group: "features",
        label: t.selectFeature(feature.name.value),
        detail: KIND_NAMES[feature.kind][lang],
        haystack: text,
        memorable: false,
        run: () => store.select([feature.id]),
      },
    });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, FEATURE_LIMIT).map((item) => item.entry);
}
