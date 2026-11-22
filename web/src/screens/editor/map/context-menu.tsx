import { useEffect, useRef, useState } from "react";
import { Menu, Popover } from "react-aria-components";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { allCoordinates } from "@/editor/engine/edit";
import { boundsOf } from "@/editor/engine/camera";
import { formatShortcut, selectListTree, shortcutFor, useEditorStore, useEditorStoreApi, type CommandId } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import type { LngLat } from "@/model/types";
import { FeatureMenuItems } from "../list/row-menu";
import { useEditorRuntime } from "../runtime";
import { formatLngLat, isMac } from "../shared/format";

const POPOVER =
  "z-50 min-w-56 overflow-y-auto rounded-block border border-rule bg-panel p-1 text-ink shadow-overlay outline-none duration-100 data-entering:animate-in data-entering:fade-in-0 data-exiting:animate-out data-exiting:fade-out-0";

interface Opened {
  at: LngLat;
  hitIds: string[];
}

function Keys({ command, keys }: { command?: CommandId; keys?: string }) {
  const combo = keys ?? (command ? shortcutFor(command)?.keys : undefined);
  if (combo === undefined) return null;
  return <DropdownMenuShortcut dir="ltr">{formatShortcut(combo, isMac())}</DropdownMenuShortcut>;
}

/**
 * The map's right-click menu. On a feature it selects it (the engine already
 * did) and offers what the list's row menu does, with a "Select" submenu when
 * several features lie under the pointer. On empty map it adds an icon or a
 * note there, copies the coordinates or pastes there. While a shape is being
 * drawn it finishes, takes back a point or cancels.
 */
export function MapContextMenu() {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const { controller } = useEditorRuntime();
  const anchor = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const tree = useEditorStore(selectListTree);
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const draw = useEditorStore((state) => state.live.draw);
  const clipboard = useEditorStore((state) => state.clipboard.features);
  const selected = useEditorStore((state) => state.selection.ids);

  useEffect(() => {
    if (controller === null) return undefined;
    return controller.on("contextmenu", ({ x, y, at, hitIds }) => {
      const element = anchor.current;
      if (!element) return;
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      setOpened({ at, hitIds });
    });
  }, [controller]);

  const close = () => setOpened(null);
  const drawing = draw !== null && draw.points > 0;
  const rows = [...tree.groups.flatMap((group) => group.features), ...tree.ungrouped];
  const named = (id: string) => rows.find((row) => row.id === id);

  const pasteHere = (at: LngLat) => {
    const bounds = boundsOf(clipboard.flatMap(allCoordinates));
    if (!bounds) return;
    const centre: LngLat = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    store.paste({ offset: [at[0] - centre[0], at[1] - centre[1]] });
  };

  let items: React.ReactNode = null;
  if (opened && drawing) {
    items = (
      <>
        <DropdownMenuItem isDisabled={!draw.canFinish} onAction={() => controller?.finish()}>
          {t.draw.finish}
          <Keys keys="Enter" />
        </DropdownMenuItem>
        <DropdownMenuItem onAction={() => controller?.undoPoint()}>
          {t.draw.undoPoint}
          <Keys keys="Backspace" />
        </DropdownMenuItem>
        <DropdownMenuItem onAction={() => controller?.cancel()}>
          {t.draw.cancel}
          <Keys keys="Escape" />
        </DropdownMenuItem>
      </>
    );
  } else if (opened && opened.hitIds.length > 0 && selected.length > 0) {
    items = (
      <>
        {opened.hitIds.length > 1 ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t.mapMenu.select}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-48">
                {opened.hitIds.map((id) => {
                  const row = named(id);
                  if (!row) return null;
                  return (
                    <DropdownMenuItem key={id} textValue={row.name.value} onAction={() => store.select([id])}>
                      <span dir={row.name.dir}>{row.name.value}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <FeatureMenuItems tree={tree} />
      </>
    );
  } else if (opened) {
    const at = opened.at;
    items = (
      <>
        <DropdownMenuItem isDisabled={readOnly} onAction={() => controller?.addAt("point", at)}>
          {t.mapMenu.addIcon}
        </DropdownMenuItem>
        <DropdownMenuItem isDisabled={readOnly} onAction={() => controller?.addAt("annotation", at)}>
          {t.mapMenu.addText}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          textValue={t.mapMenu.copyCoordinates}
          onAction={() => void navigator.clipboard.writeText(`${at[1].toFixed(5)}, ${at[0].toFixed(5)}`).catch(() => undefined)}
        >
          <span className="flex flex-col">
            {t.mapMenu.copyCoordinates}
            <span dir="ltr" className="text-xs text-ink-3 tabular-nums">
              {formatLngLat(at)}
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem isDisabled={readOnly || clipboard.length === 0} onAction={() => pasteHere(at)}>
          {t.mapMenu.pasteHere}
          <Keys command="edit.paste" />
        </DropdownMenuItem>
      </>
    );
  }

  return (
    <>
      <div ref={anchor} aria-hidden="true" className="pointer-events-none fixed size-0" />
      <Popover
        triggerRef={anchor}
        isOpen={opened !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        placement="bottom start"
        offset={2}
        className={POPOVER}
      >
        <Menu aria-label={t.mapMenu.label} onClose={close} className="outline-none">
          {items}
        </Menu>
      </Popover>
    </>
  );
}
