import { useEffect } from "react";
import { useApi } from "@/app/providers";
import type { EditorController } from "@/editor/controller";
import { matchShortcut, runCommand, selectTimelineUsable, useEditorStoreApi, type ShortcutDef } from "@/editor/store";
import { isMac } from "./shared/format";

const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
const CONTROL_SELECTOR = "button, a[href], summary, [role=button], [role=link], [role=menuitem], [role=option], [role=row], [role=treeitem], [role=gridcell], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=slider]";

/** True when a key press in `target` should type or step a value instead of running a command. */
function isTextEntry(target: Element): boolean {
  if (target instanceof HTMLInputElement) return !["checkbox", "radio", "range", "button", "color"].includes(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return TEXT_ROLES.has(target.getAttribute("role") ?? "");
}

/** Keys a list with type-ahead keeps for itself: bare letters and punctuation, Enter and Space. */
function isPlainKey(shortcut: ShortcutDef): boolean {
  return !shortcut.keys.includes("+") && !["Delete", "Escape"].includes(shortcut.keys);
}

/**
 * The editor's global keyboard shortcuts, from the store's one table.
 *
 * - Nothing runs while typing in a field, except the commands marked `always`
 *   (save, publish, the palette); Escape in a field belongs to the field.
 * - Inside a popover, menu or dialog only save and publish run.
 * - Enter and Space never override the control that has focus.
 * - While a shape is being drawn and focus is outside the map, Enter finishes
 *   it and Escape abandons it, as they do on the map itself.
 * - A region marked `data-typeahead` (the feature list) keeps bare keys.
 * - On a phone only save and publish run: there is no palette, sheet, drawing or list to act on.
 */
export function useEditorShortcuts(input: { controller: EditorController | null; mapElement: HTMLElement | null; portal: HTMLElement | null; phone: boolean }): void {
  const store = useEditorStoreApi();
  const api = useApi();
  const { controller, mapElement, portal, phone } = input;

  useEffect(() => {
    const mac = isMac();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : document.body;
      const typing = isTextEntry(target);
      const inOverlay = portal !== null && portal.contains(target);
      const inMap = mapElement !== null && mapElement.contains(target);
      const onControl = target.closest(CONTROL_SELECTOR) !== null;
      const state = store.getState();
      const take = (): void => {
        event.preventDefault();
        event.stopPropagation();
      };

      if (state.live.draw !== null && controller !== null && !typing && !inOverlay && !inMap) {
        if (event.key === "Escape") {
          controller.cancel();
          take();
          return;
        }
        if (event.key === "Enter" && !onControl) {
          controller.finish();
          take();
          return;
        }
      }

      const shortcut = matchShortcut(event, {
        mac,
        typing,
        hasSelection: state.selection.ids.length > 0 || state.selection.groupId !== null,
        timelineEnabled: selectTimelineUsable(state),
      });
      if (shortcut === null) return;
      if (phone && shortcut.id !== "file.save" && shortcut.id !== "file.publish") return;
      const always = shortcut.context === "always" && shortcut.id !== "edit.escape";
      if ((typing || inOverlay) && !always) return;
      /* The map handles its own Enter, Escape and Delete while it has focus. */
      if (inMap && ["edit.escape", "edit.reshape", "edit.delete"].includes(shortcut.id)) return;
      if ((shortcut.keys === "Enter" || shortcut.keys === "Space") && onControl) return;
      if (isPlainKey(shortcut) && target.closest("[data-typeahead]") !== null) return;
      if (runCommand(shortcut.id, { store, api, controller })) take();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [store, api, controller, mapElement, portal, phone]);
}
