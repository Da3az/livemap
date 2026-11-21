import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Collection, ListLayout, Tree, TreeItem, TreeItemContent, Virtualizer, type Key, type Selection } from "react-aria-components";
import { selectSelectedSet, useEditorStore, useEditorStoreApi, type ListTree } from "@/editor/store";
import { useListStrings } from "@/i18n/editor-list";
import { useEditorLayout } from "../shared/layout";
import { buildNodes, groupIdOf, groupKey, isGroupKey, stepGroup, visibleKeys, type ListNode } from "./model";
import { FeatureRowContent, GroupRowContent, type RowFlags } from "./rows";
import { useListDnd } from "./use-list-dnd";

const ROW_HEIGHT = 32;
const TOUCH_ROW_HEIGHT = 44;
const PADDING = 4;

function rowKeyAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest("[role=row]");
  return row?.querySelector("[data-row-id]")?.getAttribute("data-row-id") ?? null;
}

/**
 * The list itself: a one-level tree of groups and features in draw order,
 * virtualised, with selection kept in step with the store in both directions.
 */
export function FeatureTree({
  tree,
  onRename,
  onMenu,
}: {
  tree: ListTree;
  onRename: (key: string) => void;
  onMenu: (key: string, at: { x: number; y: number } | Element) => void;
}) {
  const t = useListStrings();
  const store = useEditorStoreApi();
  const { touch } = useEditorLayout();
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const selection = useEditorStore((state) => state.selection);
  const selectedSet = useEditorStore(selectSelectedSet);
  const scroller = useRef<HTMLDivElement>(null);
  /* True while a selection change is coming from the list, so the list does not scroll under the pointer. */
  const fromList = useRef(false);
  /* Read-only maps cannot save which groups are folded, so folding is kept here instead. */
  const [localCollapsed, setLocalCollapsed] = useState<ReadonlySet<string>>(() => new Set(tree.groups.filter((group) => group.collapsed).map((group) => group.id)));

  const shownTree = useMemo<ListTree>(
    () => (readOnly ? { ...tree, groups: tree.groups.map((group) => ({ ...group, collapsed: localCollapsed.has(group.id) })) } : tree),
    [tree, readOnly, localCollapsed],
  );
  const nodes = useMemo(() => buildNodes(shownTree), [shownTree]);
  const rowHeight = touch ? TOUCH_ROW_HEIGHT : ROW_HEIGHT;
  const dragAndDropHooks = useListDnd(tree, readOnly);

  /*
   * The tree's own selection object carries the anchor that Shift-click and
   * Shift-arrows extend from. While the store still holds what the tree last
   * reported, that object is handed back unchanged so the anchor survives.
   */
  const emitted = useRef<Set<Key> | null>(null);
  const selectedKeys = useMemo<Set<Key>>(() => {
    const wanted: Key[] = selection.groupId !== null ? [groupKey(selection.groupId)] : [...selection.ids];
    const last = emitted.current;
    if (last !== null && last.size === wanted.length && wanted.every((key) => last.has(key))) return last;
    emitted.current = null;
    return new Set(wanted);
  }, [selection]);
  const expandedKeys = useMemo<Set<Key>>(
    () => new Set(shownTree.groups.filter((group) => !group.collapsed).map((group) => groupKey(group.id))),
    [shownTree.groups],
  );

  const onSelectionChange = (keys: Selection): void => {
    fromList.current = true;
    if (keys === "all") {
      store.selectAll();
      return;
    }
    emitted.current = keys;
    const all = [...keys].map(String);
    const features = all.filter((key) => !isGroupKey(key));
    if (features.length > 0) {
      const kept = selection.ids.filter((id) => features.includes(id));
      store.select([...kept, ...features.filter((id) => !kept.includes(id))]);
      return;
    }
    const current = selection.groupId === null ? null : groupKey(selection.groupId);
    const group = all.find((key) => key !== current) ?? all[0];
    if (group === undefined) store.clearSelection();
    else store.selectGroup(groupIdOf(group));
  };

  const onExpandedChange = (keys: Set<Key>): void => {
    for (const group of shownTree.groups) {
      const collapsed = !keys.has(groupKey(group.id));
      if (collapsed === group.collapsed) continue;
      if (readOnly) {
        setLocalCollapsed((before) => {
          const next = new Set(before);
          if (collapsed) next.add(group.id);
          else next.delete(group.id);
          return next;
        });
      } else {
        store.setGroupCollapsed(group.id, collapsed);
      }
    }
  };

  /* A selection made on the map brings its row into view. */
  const primary = selection.groupId !== null ? groupKey(selection.groupId) : selection.ids[selection.ids.length - 1];
  useEffect(() => {
    if (fromList.current) {
      fromList.current = false;
      return;
    }
    const element = scroller.current;
    if (!element || primary === undefined) return;
    const index = visibleKeys(shownTree).indexOf(primary);
    if (index < 0) return;
    const top = PADDING + index * rowHeight;
    if (top < element.scrollTop) element.scrollTop = Math.max(0, top - rowHeight);
    else if (top + rowHeight > element.scrollTop + element.clientHeight) element.scrollTop = top + rowHeight * 2 - element.clientHeight;
    /* Only a change of selection scrolls; folding a group or resizing does not. */
  }, [primary]);

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    const key = rowKeyAt(event.target);
    const take = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "F2" && !event.altKey) {
      if (key !== null && !readOnly) onRename(key);
      take();
      return;
    }
    const up = (event.altKey && event.key === "ArrowUp") || (!event.altKey && event.code === "BracketRight");
    const down = (event.altKey && event.key === "ArrowDown") || (!event.altKey && event.code === "BracketLeft");
    if (!up && !down) return;
    take();
    if (selection.groupId !== null) stepGroup(store, tree, selection.groupId, up ? -1 : 1);
    else if (selection.ids.length > 0) {
      fromList.current = true;
      if (up) store.stepForward();
      else store.stepBackward();
    }
  };

  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    const key = rowKeyAt(event.target);
    if (key === null) return;
    event.preventDefault();
    fromList.current = true;
    if (isGroupKey(key)) store.selectGroup(groupIdOf(key));
    else if (!selectedSet.has(key) || selection.groupId !== null) store.select([key]);
    const row = event.target instanceof Element ? event.target.closest("[role=row]") : null;
    const byKeyboard = event.clientX === 0 && event.clientY === 0;
    onMenu(key, byKeyboard && row ? row : { x: event.clientX, y: event.clientY });
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (readOnly || (event.target instanceof Element && event.target.closest("button") !== null)) return;
    const key = rowKeyAt(event.target);
    if (key !== null) onRename(key);
  };

  const flagsOf = (item: { isSelected: boolean; isFocusVisible: boolean; isDropTarget?: boolean; isDragging?: boolean }): RowFlags => ({
    isSelected: item.isSelected,
    isFocusVisible: item.isFocusVisible,
    isDropTarget: item.isDropTarget ?? false,
    isDragging: item.isDragging ?? false,
    touch,
    readOnly,
  });
  /* Whether a row is selected reaches it through the tree's own state; only the selected group changes what rows draw. */
  const dependencies = [touch, readOnly, selection.groupId];

  const renderNode = (node: ListNode) =>
    node.type === "group" ? (
      <TreeItem id={node.id} textValue={node.group.name.value} hasChildItems className="h-full px-1 py-px outline-none">
        <TreeItemContent>
          {(item) => <GroupRowContent group={node.group} rowKey={node.id} isExpanded={item.isExpanded} flags={flagsOf(item)} onMore={onMenu} />}
        </TreeItemContent>
        <Collection items={node.children} dependencies={dependencies}>
          {renderNode}
        </Collection>
      </TreeItem>
    ) : (
      <TreeItem id={node.id} textValue={node.row.name.value} className="h-full px-1 py-px outline-none">
        <TreeItemContent>
          {(item) => (
            <FeatureRowContent
              row={node.row}
              flags={flagsOf(item)}
              inSelectedGroup={selection.groupId !== null && node.row.groupId === selection.groupId}
              onMore={onMenu}
            />
          )}
        </TreeItemContent>
      </TreeItem>
    );

  return (
    <div data-typeahead className="min-h-0 flex-1" onKeyDownCapture={onKeyDownCapture} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick}>
      <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight, padding: PADDING }}>
        <Tree
          ref={scroller}
          aria-label={t.treeLabel}
          items={nodes}
          dependencies={dependencies}
          selectionMode="multiple"
          selectionBehavior="replace"
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          expandedKeys={expandedKeys}
          onExpandedChange={onExpandedChange}
          dragAndDropHooks={readOnly ? undefined : dragAndDropHooks}
          className="size-full overflow-y-auto outline-none"
        >
          {renderNode}
        </Tree>
      </Virtualizer>
    </div>
  );
}
