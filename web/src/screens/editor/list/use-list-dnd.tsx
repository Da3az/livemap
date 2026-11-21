import { useEffect, useRef } from "react";
import { DropIndicator, useDragAndDrop, type DragAndDropHooks } from "react-aria-components";
import { useEditorStoreApi, type ListTree } from "@/editor/store";
import { useListStrings } from "@/i18n/editor-list";
import { cn } from "cn";
import { applyDrop, canDrop, gapAfterGroup, groupIdOf, isGroupKey, normaliseDrag, type ListNode } from "./model";

const ROW_TYPE = "application/x-livemap-row";

/**
 * Drag and drop for the list: reorder features, move them into and out of
 * groups, and reorder groups. react-aria supplies the pointer, touch and
 * keyboard interaction; this decides which drops make sense and turns the
 * accepted one into a single store command.
 */
export function useListDnd(tree: ListTree, disabled: boolean): DragAndDropHooks<ListNode> {
  const t = useListStrings();
  const store = useEditorStoreApi();
  const dragging = useRef<ReturnType<typeof normaliseDrag> | null>(null);
  const latest = useRef(tree);
  latest.current = tree;

  /* Escape ends a drag and nothing else: the editor's own Escape (deselect) must not also run. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (dragging.current !== null && event.key === "Escape") event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const { dragAndDropHooks } = useDragAndDrop<ListNode>({
    isDisabled: disabled,
    getItems: (keys) =>
      [...keys].map((key) => {
        const id = String(key);
        const name = isGroupKey(id)
          ? latest.current.groups.find((group) => group.id === groupIdOf(id))?.name.value
          : store.getState().doc.features.get(id)?.name.value;
        return { [ROW_TYPE]: id, "text/plain": name ?? id };
      }),
    acceptedDragTypes: [ROW_TYPE],
    getAllowedDropOperations: () => ["move"],
    onDragStart: (event) => {
      dragging.current = normaliseDrag([...event.keys].map(String));
    },
    onDragEnd: () => {
      dragging.current = null;
    },
    getDropOperation: (target) => {
      const drag = dragging.current;
      if (drag === null || target.type !== "item") return "cancel";
      return canDrop(latest.current, drag, { key: String(target.key), position: target.dropPosition }) ? "move" : "cancel";
    },
    onMove: (event) => {
      const drag = normaliseDrag([...event.keys].map(String));
      applyDrop(store, latest.current, drag, { key: String(event.target.key), position: event.target.dropPosition });
    },
    /* Zero height, so showing the line never moves the rows under the pointer. Indented when the rows would join a group; full width in the gap between groups. */
    renderDropIndicator: (target) => {
      const gap = target.type === "item" && gapAfterGroup(latest.current, { key: String(target.key), position: target.dropPosition }) !== null;
      return (
        <DropIndicator
          target={target}
          className={cn(
            "pointer-events-none relative h-0 outline-none after:absolute after:inset-x-0 after:-top-px after:h-0.5 after:rounded-pill data-drop-target:after:bg-plum",
            !gap && "aria-[level=2]:ms-7",
          )}
        />
      );
    },
    renderDragPreview: (items) => {
      const drag = dragging.current;
      const label = drag !== null && "features" in drag && drag.features.length > 1 ? t.dragCount(drag.features.length) : (items[0]?.["text/plain"] ?? "");
      return (
        <div dir="auto" className="max-w-60 truncate rounded-field border border-plum bg-panel px-2 py-1 font-ui text-sm font-medium text-ink shadow-overlay">
          {label}
        </div>
      );
    },
  });
  return dragAndDropHooks;
}
