import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { UNSAFE_PortalProvider } from "react-aria";
import { Link, useSearchParams } from "react-router";
import { useMap, useSession, type MapDetail } from "@/api/hooks";
import { useTheme } from "@/app/providers";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { DirectionProvider } from "@/components/ui/direction";
import {
  createEditorStore,
  EditorStoreProvider,
  selectDrawOrder,
  selectListTree,
  selectSelectedSet,
  shallowEqual,
  useEditorStore,
  useEditorStoreApi,
} from "@/editor/store";
import { LangProvider, LOCALE, type Lang } from "@/i18n";
import type { Session } from "@/model/types";
import { MapLegend } from "@/render/MapLegend";
import { MapCredits, MapTitleBlock } from "@/render/MapTitleBlock";
import { EditorRuntimeProvider, type EditorRuntime } from "../runtime";
import { EditorLayoutProvider, useDetectLayout } from "../shared/layout";
import { MapPaletteProvider, useMapTheme } from "../shared/palette";
import { useMapController } from "../use-controller";
import { useEditorShortcuts } from "../use-shortcuts";
import { CommandPalette, MapSettingsPanel, PreviewPanel, ShortcutSheet, Timeline, TransferMenu } from "./index";

/**
 * The secondary panels on their own: a seeded map from the mock, the real
 * store and the real map controller, laid out roughly as the editor lays them
 * out. A developer page, and what the panels are checked against by
 * screenshot.
 *
 *   /dev/extras?persona=owner&fast=1&map=m_shaheen     Arabic, right to left
 *   /dev/extras?persona=owner&fast=1&map=m_wildfire    English, six dated perimeters
 *   &open=preview | palette | sheet                    start with that panel open
 *   &pane=none                                         without the settings pane
 *   &tl=wide                                           the timeline in a wider slot than the dock gives it
 */
const MAPS = [
  { id: "m_shaheen", label: "Shaheen · RTL" },
  { id: "m_wildfire", label: "Evia · LTR" },
  { id: "m_election", label: "Election" },
];

/** A stand-in for the feature list: enough to select things for the palette and the exports. */
function MiniList() {
  const store = useEditorStoreApi();
  const tree = useEditorStore(selectListTree);
  const selected = useEditorStore(selectSelectedSet);
  const rows = [...tree.groups.flatMap((group) => group.features), ...tree.ungrouped];
  return (
    <ul aria-label="Features" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            aria-pressed={selected.has(row.id)}
            onClick={(event) => store.select([row.id], event.shiftKey ? "toggle" : "replace")}
            className="flex h-row w-full items-center rounded-block border border-transparent px-2 text-start text-sm aria-pressed:border-survey aria-pressed:bg-survey/10"
          >
            <span dir={row.name.dir} className="min-w-0 flex-1 truncate">
              {row.name.value}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The published map's furniture over the harness map, so a change in the settings pane is seen where it lands. */
function Furniture() {
  const { title, settings, dir } = useEditorStore(
    (state) => ({ title: state.doc.title, settings: state.doc.settings, dir: state.doc.uiDir }),
    shallowEqual,
  );
  const features = useEditorStore(selectDrawOrder);
  const theme = useMapTheme();
  const corner = settings.legend.position;
  const legend = <MapLegend settings={settings} features={features} theme={theme} dir={dir} />;
  const column = "pointer-events-none absolute z-10 flex max-w-xs flex-col gap-2";
  return (
    <>
      <div className={`${column} start-3 top-14 items-start`}>
        <MapTitleBlock title={title} settings={settings} dir={dir} />
        {corner === "top-start" ? legend : null}
      </div>
      {corner === "top-end" ? <div className={`${column} end-3 top-14 items-end`}>{legend}</div> : null}
      <div className={`${column} start-3 bottom-20 items-start`}>
        {corner === "bottom-start" ? legend : null}
        <MapCredits settings={settings} dir={dir} />
      </div>
      {corner === "bottom-end" ? <div className={`${column} end-3 bottom-20 items-end`}>{legend}</div> : null}
    </>
  );
}

function Workspace({ mapId }: { mapId: string }) {
  const store = useEditorStoreApi();
  const [params] = useSearchParams();
  const layout = useDetectLayout();
  const { mode, setChoice } = useTheme();
  const root = useRef<HTMLDivElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [mapElement, setMapElement] = useState<HTMLElement | null>(null);
  const [previewOpen, setPreviewOpen] = useState(params.get("open") === "preview");
  const dir = useEditorStore((state) => state.doc.uiDir);
  const title = useEditorStore((state) => state.doc.title);
  const controller = useMapController(mapElement, { interactive: true, generation: 0 });
  useEditorShortcuts({ controller, mapElement, portal, phone: false });

  const [opened] = useState(() => {
    const open = params.get("open");
    if (open === "palette") store.setPaletteOpen(true);
    if (open === "sheet") store.setShortcutSheetOpen(true);
    return open;
  });
  const showPane = params.get("pane") !== "none" && opened !== "preview";
  const showList = layout.mode === "desktop";

  const runtime = useMemo<EditorRuntime>(
    () => ({ controller, portalContainer: portal, openPreview: () => setPreviewOpen(true) }),
    [controller, portal],
  );
  const getContainer = useCallback(() => portal, [portal]);

  return (
    <div
      ref={root}
      dir={dir}
      lang={dir === "rtl" ? "ar" : "en"}
      data-editor-root
      className="relative isolate flex h-dvh flex-col overflow-hidden bg-page font-ui text-sm text-ink"
    >
      <UNSAFE_PortalProvider getContainer={getContainer}>
        <EditorLayoutProvider value={layout}>
          <EditorRuntimeProvider value={runtime}>
            <MapPaletteProvider rootRef={root}>
              <header className="flex h-topbar shrink-0 items-center gap-2 border-b border-rule bg-panel px-3">
                <h1 dir={title.dir} className="min-w-0 flex-1 truncate font-title text-lg font-semibold">
                  {title.value}
                </h1>
                <nav dir="ltr" aria-label="Harness" className="flex shrink-0 items-center gap-1.5 text-xs max-md:hidden">
                  {MAPS.map((map) => (
                    <Link
                      key={map.id}
                      to={`/dev/extras?persona=owner&fast=1&map=${map.id}`}
                      reloadDocument
                      aria-current={map.id === mapId ? "page" : undefined}
                      className="rounded-key px-1.5 py-0.5 text-bathy underline aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:no-underline"
                    >
                      {map.label}
                    </Link>
                  ))}
                  <Button variant="ghost" size="sm" onPress={() => setChoice(mode === "dark" ? "light" : "dark")}>
                    {mode === "dark" ? "Light" : "Dark"}
                  </Button>
                  <Button variant="ghost" size="sm" onPress={() => store.setUiDir(dir === "rtl" ? "ltr" : "rtl")}>
                    {dir === "rtl" ? "LTR" : "RTL"}
                  </Button>
                </nav>
                <Button variant="outline" onPress={() => store.setPaletteOpen(true)} data-open-palette>
                  ⌘K
                </Button>
                <Button variant="outline" aria-pressed={previewOpen} onPress={() => setPreviewOpen(!previewOpen)} data-open-preview>
                  Preview
                </Button>
                <TransferMenu />
              </header>
              <div className="relative flex min-h-0 flex-1">
                {showList ? (
                  <aside aria-label="Features" className="flex w-52 shrink-0 flex-col border-e border-rule bg-panel">
                    <MiniList />
                  </aside>
                ) : null}
                <main className="relative min-w-0 flex-1">
                  <div className="absolute inset-0 overflow-hidden bg-well">
                    {/* MapLibre makes its container `position: relative`, so the positioning lives on this wrapper. */}
                    <div className="absolute inset-0">
                      <div ref={setMapElement} data-editor-map className="size-full" />
                    </div>
                    <Furniture />
                    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
                      <div className={`pointer-events-auto flex w-full justify-center ${params.get("tl") === "wide" ? "max-w-5xl" : "max-w-3xl"}`}>
                        <Timeline />
                      </div>
                    </div>
                    {previewOpen ? (
                      <div className="absolute inset-0 z-40 bg-page">
                        <Suspense fallback={null}>
                          <PreviewPanel onClose={() => setPreviewOpen(false)} />
                        </Suspense>
                      </div>
                    ) : null}
                  </div>
                </main>
                {showPane ? (
                  <aside aria-label="Map settings" className="flex min-h-0 w-inspector max-w-full shrink-0 flex-col border-s border-rule bg-panel max-lg:absolute max-lg:inset-y-0 max-lg:end-0 max-lg:z-30 max-lg:border-rule-strong max-lg:shadow-overlay">
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <Suspense fallback={null}>
                        <MapSettingsPanel />
                      </Suspense>
                    </div>
                  </aside>
                ) : null}
              </div>
              <ShortcutSheet />
              <CommandPalette />
            </MapPaletteProvider>
          </EditorRuntimeProvider>
        </EditorLayoutProvider>
      </UNSAFE_PortalProvider>
      <div ref={setPortal} data-editor-portal dir={dir} className="font-ui text-sm text-ink" />
    </div>
  );
}

/** The editor's language and direction follow the map. */
function Localised({ mapId }: { mapId: string }) {
  const dir = useEditorStore((state) => state.doc.uiDir);
  const lang: Lang = dir === "rtl" ? "ar" : "en";
  return (
    <LangProvider lang={lang}>
      <DirectionProvider locale={LOCALE[lang]}>
        <Workspace mapId={mapId} />
      </DirectionProvider>
    </LangProvider>
  );
}

function Loaded({ session, detail }: { session: Session; detail: MapDetail }) {
  const [store] = useState(() => createEditorStore({ map: detail.map, features: detail.features, session }));
  return (
    <EditorStoreProvider store={store}>
      <Localised mapId={detail.map.id} />
    </EditorStoreProvider>
  );
}

export default function ExtrasHarness() {
  const [params] = useSearchParams();
  const mapId = params.get("map") ?? "m_shaheen";
  const session = useSession();
  const map = useMap(mapId);
  if (session.isPending || map.isPending) return <p className="p-4 text-sm text-ink-3">Loading {mapId}…</p>;
  if (session.error !== null || map.error !== null) {
    return (
      <div className="p-4">
        <Notice tone="danger" title={`The harness could not load ${mapId}`}>
          {(session.error ?? map.error)?.code}. Open it with ?persona=owner&fast=1.
        </Notice>
      </div>
    );
  }
  return <Loaded key={mapId} session={session.data} detail={map.data} />;
}
