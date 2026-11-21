import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { newId, selectCounts, selectListTree, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useLang } from "@/i18n";
import { useListStrings } from "@/i18n/editor-list";
import { PaneHeader } from "../pane";
import { formatInteger } from "../shared/format";
import { useEditorLayout } from "../shared/layout";
import { useEditorUi } from "../shared/ui";
import { EmptyList } from "./empty";
import { groupIdOf, groupKey, isGroupKey } from "./model";
import { RenameField, type RenameTarget } from "./rename";
import { RowMenu, type MenuTarget } from "./row-menu";
import { FeatureTree } from "./tree";

function ListCount() {
  const t = useListStrings();
  const lang = useLang();
  const counts = useEditorStore(selectCounts);
  const { status, used, max, remaining } = counts.limit;
  if (status === "ok") {
    return (
      <span title={t.count(used)} className="text-xs text-ink-3 tabular-nums">
        {formatInteger(used, lang)}
      </span>
    );
  }
  return (
    <span
      role="status"
      title={status === "near" ? t.limitNear(remaining) : t.limitReached(max)}
      className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${status === "near" ? "text-warning" : "text-danger"}`}
    >
      <Icon name="stateDraft" size={10} />
      <span dir="ltr">{t.countOfLimit(used, max)}</span>
    </span>
  );
}

/**
 * The feature list: every group and feature in draw order (the top row is
 * drawn on top), and the keyboard's way to everything on the map.
 */
export function FeatureList() {
  const t = useListStrings();
  const store = useEditorStoreApi();
  const { mode, touch } = useEditorLayout();
  const ui = useEditorUi();
  const tree = useEditorStore(selectListTree);
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const body = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [pendingRename, setPendingRename] = useState<string | null>(null);

  const startRename = useCallback(
    (key: string): boolean => {
      const container = body.current;
      const row = container?.querySelector(`[data-row-id="${CSS.escape(key)}"]`);
      const label = row?.querySelector("[data-row-name]");
      if (!container || !row || !label || readOnly) return false;
      const state = store.getState();
      const name = isGroupKey(key)
        ? state.doc.settings.groups.find((group) => group.id === groupIdOf(key))?.name
        : state.doc.features.get(key)?.name;
      if (!name) return false;
      const outer = container.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      const rtl = getComputedStyle(container).direction === "rtl";
      const start = rtl ? outer.right - labelBox.right : labelBox.left - outer.left;
      const rowEnd = rtl ? outer.right - rowBox.left : rowBox.right - outer.left;
      setRenaming({
        key,
        name,
        label: t.renameLabel(name.value),
        box: { top: rowBox.top - outer.top + 2, insetStart: Math.max(0, start - 7), width: rowEnd - start + 3, height: rowBox.height - 4 },
      });
      return true;
    },
    [readOnly, store, t],
  );

  /* A group made from the header is named straight away, once its row is on screen (it is the top row). */
  useEffect(() => {
    if (pendingRename === null) return undefined;
    let frame = 0;
    let tries = 0;
    const attempt = (): void => {
      const scroller = body.current?.querySelector("[role=treegrid]");
      if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;
      else if (startRename(pendingRename)) {
        setPendingRename(null);
        return;
      }
      tries += 1;
      if (tries < 20) frame = window.requestAnimationFrame(attempt);
      else setPendingRename(null);
    };
    frame = window.requestAnimationFrame(attempt);
    return () => window.cancelAnimationFrame(frame);
  }, [pendingRename, startRename]);

  const endRename = (value: string | null): void => {
    const target = renaming;
    setRenaming(null);
    if (!target) return;
    if (value !== null) {
      const name = { value, dir: target.name.dir };
      if (isGroupKey(target.key)) store.renameGroup(groupIdOf(target.key), name);
      else store.renameFeature(target.key, name);
      store.closeStep();
    }
    const row = body.current?.querySelector(`[data-row-id="${CSS.escape(target.key)}"]`)?.closest("[role=row]");
    if (row instanceof HTMLElement) row.focus();
  };

  const openMenu = useCallback((key: string, at: { x: number; y: number } | Element): void => {
    const element = anchor.current;
    if (!element) return;
    const rtl = getComputedStyle(element).direction === "rtl";
    let point: { x: number; y: number };
    if (at instanceof Element) {
      const box = at.getBoundingClientRect();
      point = { x: rtl ? box.right : box.left, y: box.bottom };
    } else {
      point = at;
    }
    element.style.top = `${point.y}px`;
    element.style.left = `${point.x}px`;
    setMenu({ key });
  }, []);

  const newGroup = (): void => {
    const id = newId();
    const result = store.createGroup({ id });
    if (result.ok && result.changed) setPendingRename(groupKey(id));
  };

  const close = (): void => {
    if (mode === "tablet") ui.setOverlayPane(null);
    else store.toggleList();
  };
  const empty = tree.total === 0 && tree.groups.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader title={t.title} closeLabel={t.collapsePane} onClose={close}>
        <ListCount />
        <Button variant="ghost" size={touch ? "touch" : "sm"} isDisabled={readOnly} onPress={newGroup} className={touch ? "px-2 text-sm" : undefined}>
          <Icon name="plus" size={12} />
          {t.newGroup}
        </Button>
      </PaneHeader>
      <div ref={body} className="relative flex min-h-0 flex-1 flex-col" onScrollCapture={() => renaming && setRenaming(null)}>
        {empty ? <EmptyList readOnly={readOnly} /> : <FeatureTree tree={tree} onRename={startRename} onMenu={openMenu} />}
        {renaming ? <RenameField key={renaming.key} target={renaming} onCommit={(value) => endRename(value)} onCancel={() => endRename(null)} /> : null}
      </div>
      <div ref={anchor} aria-hidden="true" className="pointer-events-none fixed size-0" />
      <RowMenu target={menu} anchorRef={anchor} tree={tree} onClose={() => setMenu(null)} onRename={startRename} />
    </div>
  );
}
