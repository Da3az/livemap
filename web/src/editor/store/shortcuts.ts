import type { ApiClient } from "@/api/client";
import type { EditorController, ToolId } from "@/editor/controller";
import type { EditorStore } from "./store";
import { bi, type Bilingual } from "./text";

/** Every command the dock, the command palette and the shortcut sheet can run. */
export type CommandId =
  | "tool.select"
  | "tool.area"
  | "tool.line"
  | "tool.arrow"
  | "tool.frontline"
  | "tool.point"
  | "tool.annotation"
  | "tool.lock"
  | "tool.pen"
  | "edit.undo"
  | "edit.redo"
  | "edit.copy"
  | "edit.cut"
  | "edit.paste"
  | "edit.duplicate"
  | "edit.delete"
  | "edit.selectAll"
  | "edit.copyStyle"
  | "edit.pasteStyle"
  | "edit.reshape"
  | "edit.escape"
  | "arrange.group"
  | "arrange.ungroup"
  | "arrange.toggleHidden"
  | "arrange.toggleLocked"
  | "arrange.front"
  | "arrange.back"
  | "arrange.forward"
  | "arrange.backward"
  | "file.save"
  | "file.publish"
  | "view.toggleList"
  | "view.toggleInspector"
  | "view.commandPalette"
  | "view.shortcutSheet"
  | "view.zoomToFit"
  | "view.zoomToSelection"
  | "view.toggleSnapping"
  | "timeline.playPause"
  | "timeline.stepBack"
  | "timeline.stepForward";

/**
 * Where a shortcut applies.
 * - `always`: anywhere in the editor, even while typing in a field.
 * - `editor`: anywhere in the editor except while typing.
 * - `selection`: as `editor`, and something must be selected.
 * - `timeline`: as `editor`, and the map must have dated features to scrub.
 */
export type ShortcutContext = "always" | "editor" | "selection" | "timeline";

/** The heading a shortcut is listed under in the shortcut sheet and the palette. */
export type ShortcutSection = "tools" | "edit" | "arrange" | "file" | "view" | "timeline";

/** One row of the shortcut table. */
export interface ShortcutDef {
  id: CommandId;
  /**
   * The default key, as modifiers and a key on a US layout joined by "+":
   * "V", "Mod+Shift+Z", "Shift+]", "Delete", "Space". `Mod` is Command on
   * macOS and Control elsewhere. Keys are matched by physical position, so
   * they work on an Arabic layout.
   */
  keys: string;
  /** Other keys that run the same command; not shown in the dock. */
  alternates?: string[];
  label: Bilingual;
  section: ShortcutSection;
  context: ShortcutContext;
  /** Set for tool shortcuts: the tool the dock button selects. */
  tool?: ToolId;
}

/** What each section is called. */
export const SHORTCUT_SECTIONS: Record<ShortcutSection, Bilingual> = {
  tools: bi("Tools", "الأدوات"),
  edit: bi("Edit", "تحرير"),
  arrange: bi("Arrange", "ترتيب"),
  file: bi("Map", "الخريطة"),
  view: bi("View", "العرض"),
  timeline: bi("Timeline", "الخط الزمني"),
};

/** The one shortcut table. The dock, the command palette and the shortcut sheet all read it. */
export const SHORTCUTS: ShortcutDef[] = [
  { id: "tool.select", keys: "V", label: bi("Select", "تحديد"), section: "tools", context: "editor", tool: "select" },
  { id: "tool.area", keys: "A", label: bi("Area", "منطقة"), section: "tools", context: "editor", tool: "area" },
  { id: "tool.line", keys: "L", label: bi("Line", "خط"), section: "tools", context: "editor", tool: "line" },
  { id: "tool.arrow", keys: "W", label: bi("Arrow", "سهم"), section: "tools", context: "editor", tool: "arrow" },
  {
    id: "tool.frontline",
    keys: "F",
    label: bi("Front line", "خط جبهة"),
    section: "tools",
    context: "editor",
    tool: "frontline",
  },
  { id: "tool.point", keys: "I", label: bi("Icon", "رمز"), section: "tools", context: "editor", tool: "point" },
  { id: "tool.annotation", keys: "T", label: bi("Text", "نص"), section: "tools", context: "editor", tool: "annotation" },
  {
    id: "tool.lock",
    keys: "Q",
    label: bi("Keep the tool after each shape", "إبقاء الأداة بعد كل شكل"),
    section: "tools",
    context: "editor",
  },
  { id: "tool.pen", keys: "Shift+P", label: bi("Pen mode on or off", "تشغيل أو إيقاف وضع القلم"), section: "tools", context: "editor" },

  { id: "edit.undo", keys: "Mod+Z", label: bi("Undo", "تراجع"), section: "edit", context: "editor" },
  {
    id: "edit.redo",
    keys: "Mod+Shift+Z",
    alternates: ["Mod+Y"],
    label: bi("Redo", "إعادة"),
    section: "edit",
    context: "editor",
  },
  { id: "edit.copy", keys: "Mod+C", label: bi("Copy", "نسخ"), section: "edit", context: "selection" },
  { id: "edit.cut", keys: "Mod+X", label: bi("Cut", "قص"), section: "edit", context: "selection" },
  { id: "edit.paste", keys: "Mod+V", label: bi("Paste", "لصق"), section: "edit", context: "editor" },
  { id: "edit.duplicate", keys: "Mod+D", label: bi("Duplicate", "تكرار"), section: "edit", context: "selection" },
  {
    id: "edit.delete",
    keys: "Delete",
    alternates: ["Backspace"],
    label: bi("Delete", "حذف"),
    section: "edit",
    context: "selection",
  },
  { id: "edit.selectAll", keys: "Mod+A", label: bi("Select all", "تحديد الكل"), section: "edit", context: "editor" },
  { id: "edit.copyStyle", keys: "Mod+Alt+C", label: bi("Copy style", "نسخ النمط"), section: "edit", context: "selection" },
  { id: "edit.pasteStyle", keys: "Mod+Alt+V", label: bi("Paste style", "لصق النمط"), section: "edit", context: "selection" },
  { id: "edit.reshape", keys: "Enter", label: bi("Edit shape", "تعديل الشكل"), section: "edit", context: "selection" },
  { id: "edit.escape", keys: "Escape", label: bi("Cancel or deselect", "إلغاء أو إزالة التحديد"), section: "edit", context: "always" },

  { id: "arrange.group", keys: "Mod+G", label: bi("Group", "تجميع"), section: "arrange", context: "selection" },
  { id: "arrange.ungroup", keys: "Mod+Shift+G", label: bi("Ungroup", "فك التجميع"), section: "arrange", context: "selection" },
  { id: "arrange.toggleHidden", keys: "Shift+H", label: bi("Hide or show", "إخفاء أو إظهار"), section: "arrange", context: "selection" },
  { id: "arrange.toggleLocked", keys: "Shift+L", label: bi("Lock or unlock", "قفل أو فتح"), section: "arrange", context: "selection" },
  { id: "arrange.front", keys: "Shift+]", label: bi("Bring to front", "إحضار إلى الأمام"), section: "arrange", context: "selection" },
  { id: "arrange.back", keys: "Shift+[", label: bi("Send to back", "إرسال إلى الخلف"), section: "arrange", context: "selection" },
  { id: "arrange.forward", keys: "]", label: bi("Bring forward", "تقديم"), section: "arrange", context: "selection" },
  { id: "arrange.backward", keys: "[", label: bi("Send backward", "تأخير"), section: "arrange", context: "selection" },

  { id: "file.save", keys: "Mod+S", label: bi("Save", "حفظ"), section: "file", context: "always" },
  { id: "file.publish", keys: "Mod+Enter", label: bi("Publish", "نشر"), section: "file", context: "always" },

  { id: "view.toggleList", keys: "Alt+1", label: bi("Show or hide the list", "إظهار أو إخفاء القائمة"), section: "view", context: "editor" },
  {
    id: "view.toggleInspector",
    keys: "Alt+2",
    label: bi("Show or hide the inspector", "إظهار أو إخفاء لوحة الخصائص"),
    section: "view",
    context: "editor",
  },
  { id: "view.commandPalette", keys: "Mod+K", label: bi("Command palette", "لوحة الأوامر"), section: "view", context: "always" },
  { id: "view.shortcutSheet", keys: "Shift+/", label: bi("Keyboard shortcuts", "اختصارات لوحة المفاتيح"), section: "view", context: "editor" },
  { id: "view.zoomToFit", keys: "Shift+1", label: bi("Zoom to fit everything", "تكبير لإظهار الكل"), section: "view", context: "editor" },
  { id: "view.zoomToSelection", keys: "Shift+2", label: bi("Zoom to selection", "تكبير إلى التحديد"), section: "view", context: "selection" },
  { id: "view.toggleSnapping", keys: "Shift+S", label: bi("Snapping on or off", "تشغيل أو إيقاف الالتقاط"), section: "view", context: "editor" },

  { id: "timeline.playPause", keys: "Space", label: bi("Play or pause", "تشغيل أو إيقاف مؤقت"), section: "timeline", context: "timeline" },
  { id: "timeline.stepBack", keys: ",", label: bi("Previous change in time", "التغيّر السابق زمنيًا"), section: "timeline", context: "timeline" },
  { id: "timeline.stepForward", keys: ".", label: bi("Next change in time", "التغيّر التالي زمنيًا"), section: "timeline", context: "timeline" },
];

/** The shortcut row for a command. */
export function shortcutFor(id: CommandId): ShortcutDef | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.id === id);
}

/** The shortcut row for a tool, for the dock. */
export function shortcutForTool(tool: ToolId): ShortcutDef | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.tool === tool);
}

/** The parts of a keyboard event the matcher reads. A DOM `KeyboardEvent` fits. */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** What the matcher needs to know about the moment the key was pressed. */
export interface ShortcutSituation {
  /** True on macOS, where `Mod` is Command. */
  mac: boolean;
  /** True when focus is in a text field, so single keys must type. */
  typing: boolean;
  hasSelection: boolean;
  /** The author can scrub: the map has dated features. Not the reader-facing `settings.timeline.enabled`. */
  timelineEnabled: boolean;
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Slash: "/",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Escape: "Escape",
  Delete: "Delete",
  Backspace: "Backspace",
};

/** The US-layout key a physical key stands for: "KeyV" is "V" whatever the layout types. */
function logicalKey(event: KeyLike): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  return CODE_KEYS[event.code] ?? (event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key);
}

function matches(keys: string, event: KeyLike, mac: boolean): boolean {
  const parts = keys.split("+");
  const key = parts[parts.length - 1] ?? "";
  const mod = parts.includes("Mod");
  const pressedMod = mac ? event.metaKey : event.ctrlKey;
  const otherMod = mac ? event.ctrlKey : event.metaKey;
  return (
    logicalKey(event) === key &&
    pressedMod === mod &&
    !otherMod &&
    event.shiftKey === parts.includes("Shift") &&
    event.altKey === parts.includes("Alt")
  );
}

/** The shortcut a key press means in this situation, or null. Call `preventDefault` when it is not null. */
export function matchShortcut(event: KeyLike, situation: ShortcutSituation): ShortcutDef | null {
  for (const shortcut of SHORTCUTS) {
    if (shortcut.context !== "always" && situation.typing) continue;
    if (shortcut.context === "selection" && !situation.hasSelection) continue;
    if (shortcut.context === "timeline" && !situation.timelineEnabled) continue;
    const all = [shortcut.keys, ...(shortcut.alternates ?? [])];
    if (all.some((keys) => matches(keys, event, situation.mac))) return shortcut;
  }
  return null;
}

/** A shortcut as shown to the user: "⌘⇧Z" on macOS, "Ctrl+Shift+Z" elsewhere. "Shift+/" reads "?". */
export function formatShortcut(keys: string, mac: boolean): string {
  if (keys === "Shift+/") return "?";
  const parts = keys.split("+").map((part) => {
    if (part === "Mod") return mac ? "⌘" : "Ctrl";
    if (part === "Shift") return mac ? "⇧" : "Shift";
    if (part === "Alt") return mac ? "⌥" : "Alt";
    if (part === "Delete") return mac ? "⌫" : "Del";
    if (part === "Escape") return "Esc";
    if (part === "Enter") return mac ? "↩" : "Enter";
    return part;
  });
  return parts.join(mac ? "" : "+");
}

/** What a command may need besides the store. Commands that lack what they need do nothing. */
export interface CommandEnvironment {
  store: EditorStore;
  /** For save and publish. */
  api?: ApiClient | null;
  /** For zoom commands and for cancelling a shape in progress. */
  controller?: EditorController | null;
}

/**
 * Run a command by id. Returns false when it could not run here (no API
 * client for save, no controller for zoom). Refusals from the store are in
 * `state.refusal`, as for any command.
 */
export function runCommand(id: CommandId, environment: CommandEnvironment): boolean {
  const { store } = environment;
  const state = store.getState();
  const api = environment.api ?? null;
  const controller = environment.controller ?? null;
  switch (id) {
    case "tool.select":
      store.setTool("select");
      return true;
    case "tool.area":
      store.setTool("area");
      return true;
    case "tool.line":
      store.setTool("line");
      return true;
    case "tool.arrow":
      store.setTool("arrow");
      return true;
    case "tool.frontline":
      store.setTool("frontline");
      return true;
    case "tool.point":
      store.setTool("point");
      return true;
    case "tool.annotation":
      store.setTool("annotation");
      return true;
    case "tool.lock":
      store.setToolLocked(!state.view.toolLocked);
      return true;
    case "tool.pen":
      store.setPenMode(state.view.penMode === "off" ? "on" : "off");
      return true;
    case "edit.undo": {
      /* While drawing, undo takes back a point; right after a shape is finished, it reopens it. */
      if (controller?.undoPoint()) return true;
      const reopen = controller?.reopenable() ?? null;
      store.undo();
      if (reopen !== null && !store.getState().doc.features.has(reopen)) controller?.reopen();
      return true;
    }
    case "edit.redo":
      if (controller?.redoPoint()) return true;
      store.redo();
      return true;
    case "edit.copy":
      store.copy();
      return true;
    case "edit.cut":
      store.cut();
      return true;
    case "edit.paste":
      store.paste();
      return true;
    case "edit.duplicate":
      store.duplicate();
      return true;
    case "edit.delete":
      store.deleteFeatures();
      return true;
    case "edit.selectAll":
      store.selectAll();
      return true;
    case "edit.copyStyle":
      store.copyStyle();
      return true;
    case "edit.pasteStyle":
      store.pasteStyle();
      return true;
    case "edit.reshape": {
      const primary = state.selection.ids[state.selection.ids.length - 1];
      if (primary === undefined) return false;
      store.setReshaping(primary);
      return true;
    }
    case "edit.escape":
      if (state.live.draw !== null && controller !== null) {
        controller.cancel();
        return true;
      }
      return store.escape();
    case "arrange.group":
      store.createGroup();
      return true;
    case "arrange.ungroup": {
      const groupId =
        state.selection.groupId ??
        state.selection.ids.map((featureId) => state.doc.features.get(featureId)?.groupId ?? null).find((found) => found !== null);
      if (groupId === undefined || groupId === null) return false;
      store.ungroup(groupId);
      return true;
    }
    case "arrange.toggleHidden":
      if (state.selection.groupId !== null) {
        const group = state.doc.settings.groups.find((candidate) => candidate.id === state.selection.groupId);
        if (group !== undefined) store.setGroupHidden(group.id, !group.hidden);
      } else {
        store.toggleHidden();
      }
      return true;
    case "arrange.toggleLocked":
      if (state.selection.groupId !== null) {
        const group = state.doc.settings.groups.find((candidate) => candidate.id === state.selection.groupId);
        if (group !== undefined) store.setGroupLocked(group.id, !group.locked);
      } else {
        store.toggleLocked();
      }
      return true;
    case "arrange.front":
      store.bringToFront();
      return true;
    case "arrange.back":
      store.sendToBack();
      return true;
    case "arrange.forward":
      store.stepForward();
      return true;
    case "arrange.backward":
      store.stepBackward();
      return true;
    case "file.save":
      if (api === null) return false;
      void store.save(api);
      return true;
    case "file.publish":
      if (api === null) return false;
      void store.publish(api);
      return true;
    case "view.toggleList":
      store.toggleList();
      return true;
    case "view.toggleInspector":
      store.toggleInspector();
      return true;
    case "view.commandPalette":
      store.setPaletteOpen(!state.view.paletteOpen);
      return true;
    case "view.shortcutSheet":
      store.setShortcutSheetOpen(!state.view.shortcutSheetOpen);
      return true;
    case "view.zoomToFit":
      if (controller === null) return false;
      controller.fitFeatures();
      return true;
    case "view.zoomToSelection":
      if (controller === null || state.selection.ids.length === 0) return false;
      controller.fitFeatures([...state.selection.ids]);
      return true;
    case "view.toggleSnapping":
      store.setSnapping(!state.view.snapping);
      return true;
    case "timeline.playPause":
      store.togglePlay();
      return true;
    case "timeline.stepBack":
      store.stepPlayhead(-1);
      return true;
    case "timeline.stepForward":
      store.stepPlayhead(1);
      return true;
  }
}
