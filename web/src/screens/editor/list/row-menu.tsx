import type { RefObject } from "react";
import { Menu, Popover } from "react-aria-components";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { formatShortcut, runCommand, shortcutFor, useEditorStore, useEditorStoreApi, type CommandId, type ListTree } from "@/editor/store";
import { useListStrings } from "@/i18n/editor-list";
import { useEditorRuntime } from "../runtime";
import { isMac } from "../shared/format";
import { groupIdOf, isGroupKey, stepGroup } from "./model";

/** What the menu was opened on: a group row, or the selected features. */
export interface MenuTarget {
  key: string;
}

function Keys({ command, keys }: { command?: CommandId; keys?: string }) {
  const combo = keys ?? (command ? shortcutFor(command)?.keys : undefined);
  if (combo === undefined) return null;
  return <DropdownMenuShortcut dir="ltr">{formatShortcut(combo, isMac())}</DropdownMenuShortcut>;
}

const POPOVER =
  "z-50 min-w-56 overflow-y-auto rounded-block border border-rule bg-panel p-1 text-ink shadow-overlay outline-none duration-100 data-entering:animate-in data-entering:fade-in-0 data-exiting:animate-out data-exiting:fade-out-0";

/**
 * The row menu: the same commands the keyboard has, with their keys beside
 * them. It opens at the pointer on a right-click, at the row for the menu
 * key, and at the "more" button on touch.
 */
export function RowMenu({
  target,
  anchorRef,
  tree,
  onClose,
  onRename,
}: {
  target: MenuTarget | null;
  anchorRef: RefObject<HTMLElement | null>;
  tree: ListTree;
  onClose: () => void;
  onRename: (key: string) => void;
}) {
  const t = useListStrings();
  const store = useEditorStoreApi();
  const { controller } = useEditorRuntime();
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const selection = useEditorStore((state) => state.selection);

  const groupRow = target && isGroupKey(target.key) ? tree.groups.find((group) => group.id === groupIdOf(target.key)) : undefined;
  const ids = selection.ids;
  const rows = [...tree.groups.flatMap((group) => group.features), ...tree.ungrouped].filter((row) => ids.includes(row.id));

  const groupItems = groupRow ? (
    <>
      <DropdownMenuItem isDisabled={readOnly} onAction={() => onRename(target?.key ?? "")}>
        {t.rename}
        <Keys keys="F2" />
      </DropdownMenuItem>
      <DropdownMenuItem
        onAction={() => controller?.fitFeatures(groupRow.features.map((row) => row.id))}
        isDisabled={groupRow.features.length === 0}
      >
        {t.zoomTo}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.setGroupHidden(groupRow.id, !groupRow.hidden)}>
        {groupRow.hidden ? t.show : t.hide}
        <Keys command="arrange.toggleHidden" />
      </DropdownMenuItem>
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.setGroupLocked(groupRow.id, !groupRow.locked)}>
        {groupRow.locked ? t.unlock : t.lock}
        <Keys command="arrange.toggleLocked" />
      </DropdownMenuItem>
      <DropdownMenuItem onAction={() => store.setGroupCollapsed(groupRow.id, !groupRow.collapsed)}>
        {groupRow.collapsed ? t.expand : t.collapse}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        isDisabled={readOnly || tree.groups[0]?.id === groupRow.id}
        onAction={() => void stepGroup(store, tree, groupRow.id, -1)}
      >
        {t.moveGroupUp}
        <Keys keys="Alt+↑" />
      </DropdownMenuItem>
      <DropdownMenuItem
        isDisabled={readOnly || tree.groups[tree.groups.length - 1]?.id === groupRow.id}
        onAction={() => void stepGroup(store, tree, groupRow.id, 1)}
      >
        {t.moveGroupDown}
        <Keys keys="Alt+↓" />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.ungroup(groupRow.id)}>
        {t.ungroup}
        <Keys command="arrange.ungroup" />
      </DropdownMenuItem>
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.deleteGroup(groupRow.id, { withFeatures: false })}>
        {t.deleteGroupKeep}
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" isDisabled={readOnly} onAction={() => store.deleteGroup(groupRow.id, { withFeatures: true })}>
        {t.deleteGroupAll}
      </DropdownMenuItem>
    </>
  ) : null;

  return (
    <Popover
      triggerRef={anchorRef}
      isOpen={target !== null && (groupRow !== undefined || rows.length > 0)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      placement="bottom start"
      offset={2}
      className={POPOVER}
    >
      <Menu aria-label={groupRow ? t.groupMenuLabel : t.menuLabel(rows.length)} onClose={onClose} className="outline-none">
        {groupItems}
        {groupRow ? null : <FeatureMenuItems tree={tree} onRename={onRename} />}
      </Menu>
    </Popover>
  );
}

/**
 * The commands for the selected features. The list's row menu and the map's
 * right-click menu both show them; only the list can rename in place.
 */
export function FeatureMenuItems({ tree, onRename }: { tree: ListTree; onRename?: (key: string) => void }) {
  const t = useListStrings();
  const store = useEditorStoreApi();
  const { controller } = useEditorRuntime();
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const ids = useEditorStore((state) => state.selection.ids);
  const canPasteStyle = useEditorStore((state) => state.clipboard.style !== null);
  const rows = [...tree.groups.flatMap((group) => group.features), ...tree.ungrouped].filter((row) => ids.includes(row.id));
  const allHidden = rows.length > 0 && rows.every((row) => row.hidden);
  const allLocked = rows.length > 0 && rows.every((row) => row.locked);
  const inGroup = rows.find((row) => row.groupId !== null)?.groupId ?? null;
  const single = rows.length === 1 ? rows[0] : undefined;

  return (
    <>
      {single && onRename ? (
        <DropdownMenuItem isDisabled={readOnly} onAction={() => onRename(single.id)}>
          {t.rename}
          <Keys keys="F2" />
        </DropdownMenuItem>
      ) : null}
      {single && single.kind !== "point" ? (
        <DropdownMenuItem isDisabled={readOnly || single.effectiveLocked} onAction={() => store.setReshaping(single.id)}>
          {t.editShape}
          <Keys command="edit.reshape" />
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onAction={() => controller?.fitFeatures([...ids])}>
        {t.zoomTo}
        <Keys command="view.zoomToSelection" />
      </DropdownMenuItem>
      <DropdownMenuItem
        isDisabled={readOnly || rows.every((row) => row.effectiveLocked)}
        onAction={() => runCommand("edit.move", { store, controller })}
      >
        {t.move}
        <Keys command="edit.move" />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.duplicate()}>
        {t.duplicate}
        <Keys command="edit.duplicate" />
      </DropdownMenuItem>
      <DropdownMenuItem onAction={() => store.copyStyle()}>
        {t.copyStyle}
        <Keys command="edit.copyStyle" />
      </DropdownMenuItem>
      <DropdownMenuItem isDisabled={readOnly || !canPasteStyle} onAction={() => store.pasteStyle()}>
        {t.pasteStyle}
        <Keys command="edit.pasteStyle" />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.setHidden(!allHidden)}>
        {allHidden ? t.show : t.hide}
        <Keys command="arrange.toggleHidden" />
      </DropdownMenuItem>
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.setLocked(!allLocked)}>
        {allLocked ? t.unlock : t.lock}
        <Keys command="arrange.toggleLocked" />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.bringToFront()}>
        {t.toFront}
        <Keys command="arrange.front" />
      </DropdownMenuItem>
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.stepForward()}>
        {t.forward}
        <Keys command="arrange.forward" />
      </DropdownMenuItem>
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.stepBackward()}>
        {t.backward}
        <Keys command="arrange.backward" />
      </DropdownMenuItem>
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.sendToBack()}>
        {t.toBack}
        <Keys command="arrange.back" />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem isDisabled={readOnly} onAction={() => store.createGroup()}>
        {t.group}
        <Keys command="arrange.group" />
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger isDisabled={readOnly || (tree.groups.length === 0 && inGroup === null)}>
          {t.moveToGroup}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-40">
          {tree.groups.map((group) => (
            <DropdownMenuItem key={group.id} textValue={group.name.value} onAction={() => store.moveToGroup(group.id)}>
              <span dir={group.name.dir}>{group.name.value}</span>
            </DropdownMenuItem>
          ))}
          {tree.groups.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem isDisabled={inGroup === null} onAction={() => store.moveToGroup(null)}>
            {t.noGroup}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {inGroup !== null ? (
        <DropdownMenuItem isDisabled={readOnly} onAction={() => store.ungroup(inGroup)}>
          {t.ungroup}
          <Keys command="arrange.ungroup" />
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" isDisabled={readOnly} onAction={() => store.deleteFeatures()}>
        {t.delete}
        <Keys command="edit.delete" />
      </DropdownMenuItem>
    </>
  );
}
