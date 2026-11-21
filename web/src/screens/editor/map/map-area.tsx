import { cn } from "cn";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatShortcut, selectCounts, shallowEqual, shortcutFor, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import { watchObstacles } from "@/render/obstacles";
import { PlaceSearch, PreviewPanel } from "@/screens/editor/extras";
import { ToolDock } from "../dock/tool-dock";
import { MessageRail } from "../messages/message-rail";
import { useEditorRuntime } from "../runtime";
import { isMac } from "../shared/format";
import { useEditorLayout } from "../shared/layout";
import { Tip } from "../shared/tip";
import { useEditorUi } from "../shared/ui";
import { Furniture } from "./furniture";
import { ZoomControls } from "./zoom-controls";

/** Tabs at the map's top corners that bring back a pane that is put away. */
function PaneTabs({ side }: { side: "start" | "end" }) {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const ui = useEditorUi();
  const { mode, touch } = useEditorLayout();
  const view = useEditorStore(
    (state) => ({
      listCollapsed: state.view.listCollapsed,
      inspectorCollapsed: state.view.inspectorCollapsed,
      selected: state.selection.ids.length,
    }),
    shallowEqual,
  );
  const counts = useEditorStore(selectCounts);
  const tablet = mode === "tablet";
  const listHidden = tablet ? ui.overlayPane !== "list" : view.listCollapsed;
  const inspectorHidden = view.selected > 0 && (tablet ? ui.overlayPane !== "inspector" : view.inspectorCollapsed);
  const tab = cn("pointer-events-auto rounded-key border-rule-strong shadow-dock", touch ? "h-11 px-3.5 text-sm" : "h-field");
  const mac = isMac();

  if (side === "start") {
    return listHidden ? (
      <Tip label={t.list.show} keys={formatShortcut(shortcutFor("view.toggleList")?.keys ?? "", mac)}>
        <Button variant="outline" className={tab} onPress={() => (tablet ? ui.setOverlayPane("list") : store.toggleList())}>
          {t.list.paneLabel}
          <span className="text-ink-3 tabular-nums">{counts.features}</span>
        </Button>
      </Tip>
    ) : null;
  }
  if (view.selected === 0) {
    const open = tablet ? ui.overlayPane === "inspector" : ui.settingsOpen;
    return open ? null : (
      <Tip label={t.settings.show}>
        <Button variant="outline" className={tab} onPress={() => (tablet ? ui.setOverlayPane("inspector") : ui.setSettingsOpen(true))}>
          {t.settings.title}
        </Button>
      </Tip>
    );
  }
  return inspectorHidden ? (
    <Tip label={t.inspector.show} keys={formatShortcut(shortcutFor("view.toggleInspector")?.keys ?? "", mac)}>
      <Button variant="outline" className={tab} onPress={() => (tablet ? ui.setOverlayPane("inspector") : store.toggleInspector())}>
        {t.inspector.paneLabel}
        <span className="text-ink-3 tabular-nums">{view.selected}</span>
      </Button>
    </Tip>
  ) : null;
}

/**
 * The working area: the map, and over it the place search, the published
 * map's own furniture, the messages, the zoom controls and the tool dock.
 * The preview covers all of it while open.
 */
export function MapArea({ mapRef }: { mapRef: (element: HTMLElement | null) => void }) {
  const t = useEditorStrings();
  const ui = useEditorUi();
  const ready = useEditorStore((state) => state.live.ready);
  const [dockHeight, setDockHeight] = useState(46);
  const { controller } = useEditorRuntime();
  const root = useRef<HTMLDivElement>(null);
  const mapElement = ui.mapElement;

  /* Labels keep out from under the title block, key and credits. */
  useEffect(() => {
    const scope = root.current;
    if (scope === null || mapElement === null || controller === null) return undefined;
    return watchObstacles(scope, mapElement, (boxes) => controller.setLabelObstacles(boxes));
  }, [controller, mapElement]);
  /* 36px keeps clear of the basemap attribution; the rest is the dock and the timeline. */
  const bottom = 36 + dockHeight + 10;

  return (
    <div ref={root} className="@container/map absolute inset-0 overflow-hidden bg-well">
      {/*
        MapLibre makes its container `position: relative`, so the positioning lives on this wrapper.
        While the preview is open this map stays where it is but stops drawing (see the shell),
        so the preview's map is the only one animating.
      */}
      <div className="absolute inset-0" inert={ui.previewOpen}>
        <div ref={mapRef} data-editor-map className="size-full" />
      </div>
      {ready ? null : (
        <p role="status" className="absolute inset-x-0 top-1/2 text-center text-sm text-ink-3">
          {t.map.loading}
        </p>
      )}
      <Furniture bottom={bottom} />
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start gap-3">
        <PaneTabs side="start" />
        <div className="pointer-events-auto mx-auto w-full max-w-md">
          <PlaceSearch />
        </div>
        <PaneTabs side="end" />
      </div>
      <MessageRail />
      <ZoomControls bottom={bottom} />
      <ToolDock onHeight={setDockHeight} />
      {ui.previewOpen ? (
        <div className="absolute inset-0 z-40 bg-page">
          <Suspense fallback={null}>
            <PreviewPanel onClose={ui.closePreview} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
