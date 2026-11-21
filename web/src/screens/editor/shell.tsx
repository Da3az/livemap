import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { UNSAFE_PortalProvider } from "react-aria";
import { DirectionProvider } from "@/components/ui/direction";
import { shallowEqual, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { LangProvider, LOCALE, type Lang } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";
import { CommandPalette, MapSettingsPanel, ShortcutSheet } from "@/screens/editor/extras";
import { Inspector } from "./inspector";
import { FeatureList } from "./list";
import { MapArea } from "./map/map-area";
import { StatusBar } from "./map/status-bar";
import { LeaveGuard } from "./messages/leave-guard";
import { ReadOnlyBar } from "./messages/read-only-bar";
import { Pane, PaneHeader } from "./pane";
import { PhoneEditor } from "./phone/phone-editor";
import { EditorRuntimeProvider, type EditorRuntime } from "./runtime";
import { EditorLayoutProvider, useDetectLayout, useEditorLayout } from "./shared/layout";
import { MapPaletteProvider } from "./shared/palette";
import { EditorUiProvider, FURNITURE_PUBLISHED, useEditorUi, type EditorUi, type FurnitureView } from "./shared/ui";
import { TopBar } from "./topbar/top-bar";
import { useMapController } from "./use-controller";
import { useEditorShortcuts } from "./use-shortcuts";

function SettingsPane({ onClose }: { onClose: () => void }) {
  const t = useEditorStrings();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader title={t.settings.title} closeLabel={t.settings.close} onClose={onClose} />
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Suspense fallback={null}>
          <MapSettingsPanel />
        </Suspense>
      </div>
    </div>
  );
}

function Workspace({ children }: { children: (mapRef: (element: HTMLElement | null) => void) => ReactNode }) {
  const store = useEditorStoreApi();
  const layout = useDetectLayout();
  const root = useRef<HTMLDivElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [mapElement, setMapElement] = useState<HTMLElement | null>(null);
  const [generation, setGeneration] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [furniture, setFurniture] = useState<FurnitureView>(FURNITURE_PUBLISHED);
  const [overlayPane, setOverlayPane] = useState<EditorUi["overlayPane"]>(null);

  const interactive = layout.mode !== "phone";
  const controller = useMapController(mapElement, { interactive, generation });
  useEditorShortcuts({ controller, mapElement, portal, phone: !interactive });
  /* The preview covers the editor's map; pausing it keeps its camera and leaves the preview's map the only one drawing. */
  useEffect(() => controller?.setRendering(!previewOpen), [controller, previewOpen]);

  /* Drawing needs a larger screen: a phone only ever has the select tool. */
  useEffect(() => {
    if (!interactive) store.setTool("select");
  }, [interactive, store]);

  const runtime = useMemo<EditorRuntime>(
    () => ({ controller, portalContainer: portal, openPreview: () => setPreviewOpen(true) }),
    [controller, portal],
  );
  const ui = useMemo<EditorUi>(
    () => ({
      settingsOpen,
      setSettingsOpen,
      overlayPane,
      setOverlayPane,
      furniture,
      setFurniture,
      previewOpen,
      closePreview: () => setPreviewOpen(false),
      reloadMap: () => setGeneration((value) => value + 1),
      mapElement,
    }),
    [settingsOpen, overlayPane, furniture, previewOpen, mapElement],
  );
  const getContainer = useCallback(() => portal, [portal]);
  const dir = useEditorStore((state) => state.doc.uiDir);

  return (
    <div
      ref={root}
      dir={dir}
      lang={dir === "rtl" ? "ar" : "en"}
      data-editor-root
      data-touch={layout.touch ? "" : undefined}
      className="relative isolate flex h-dvh flex-col overflow-clip bg-page font-ui text-sm text-ink"
    >
      <UNSAFE_PortalProvider getContainer={getContainer}>
        <EditorLayoutProvider value={layout}>
          <EditorRuntimeProvider value={runtime}>
            <EditorUiProvider value={ui}>
              <MapPaletteProvider rootRef={root}>{children(setMapElement)}</MapPaletteProvider>
            </EditorUiProvider>
          </EditorRuntimeProvider>
        </EditorLayoutProvider>
      </UNSAFE_PortalProvider>
      {/* Popovers, menus, tooltips and dialogs mount here, so they inherit the editor's direction and language. */}
      <div ref={setPortal} data-editor-portal dir={dir} className="font-ui text-sm text-ink" />
    </div>
  );
}

function DesktopBody({ mapRef }: { mapRef: (element: HTMLElement | null) => void }) {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const { mode } = useEditorLayout();
  const view = useEditorStore(
    (state) => ({
      listCollapsed: state.view.listCollapsed,
      inspectorCollapsed: state.view.inspectorCollapsed,
      hasSelection: state.selection.ids.length > 0 || state.selection.groupId !== null,
    }),
    shallowEqual,
  );
  const ui = useEditorUi();
  const tablet = mode === "tablet";

  const showList = tablet ? ui.overlayPane === "list" : !view.listCollapsed;
  const trailing: "inspector" | "settings" | null = tablet
    ? ui.overlayPane === "inspector"
      ? view.hasSelection
        ? "inspector"
        : "settings"
      : null
    : view.hasSelection
      ? view.inspectorCollapsed
        ? null
        : "inspector"
      : ui.settingsOpen
        ? "settings"
        : null;

  const closeTrailing = (): void => {
    if (tablet) ui.setOverlayPane(null);
    else if (trailing === "settings") ui.setSettingsOpen(false);
    else store.toggleInspector();
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-clip">
      {showList ? (
        <Pane side="start" overlay={tablet} label={t.list.paneLabel}>
          <FeatureList />
        </Pane>
      ) : null}
      <main className="relative min-w-0 flex-1">
        <MapArea mapRef={mapRef} />
      </main>
      {trailing ? (
        <Pane side="end" overlay={tablet} label={trailing === "inspector" ? t.inspector.paneLabel : t.settings.title}>
          {trailing === "inspector" ? <Inspector /> : <SettingsPane onClose={closeTrailing} />}
        </Pane>
      ) : null}
    </div>
  );
}

/** The editor for one open map: providers, direction, the map engine and the layout around it. */
export function EditorShell() {
  const dir = useEditorStore((state) => state.doc.uiDir);
  const lang: Lang = dir === "rtl" ? "ar" : "en";
  const layout = useDetectLayout();

  return (
    <LangProvider lang={lang}>
      <DirectionProvider locale={LOCALE[lang]}>
        <Workspace>
          {(mapRef) =>
            layout.mode === "phone" ? (
              <PhoneEditor mapRef={mapRef} />
            ) : (
              <>
                <TopBar />
                <ReadOnlyBar />
                <LeaveGuard />
                <DesktopBody mapRef={mapRef} />
                <ShortcutSheet />
                <StatusBar />
                <CommandPalette />
              </>
            )
          }
        </Workspace>
      </DirectionProvider>
    </LangProvider>
  );
}
