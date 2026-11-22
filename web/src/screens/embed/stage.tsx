import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { TimeWindow } from "@/editor/store/time";
import { LOCALE, useLang } from "@/i18n";
import { useEmbedStrings } from "@/i18n/embed";
import type { MapFeature, MapVersion, Viewport } from "@/model/types";
import { legendEntries } from "@/render/furniture";
import { watchObstacles } from "@/render/obstacles";
import { ScaleBar } from "@/render/ScaleBar";
import { resolveDir } from "@/render/text";
import { FeatureCard, readerText, type CardTarget } from "./feature-card";
import { MapKey } from "./map-key";
import { type Navigation, ReaderMap } from "./reader-map";
import type { ThemeScope } from "./theme-scope";

/** What a host can ask of the map it is showing: enough to link two of them and to point at a feature. */
export interface MapViewerHandle {
  getViewport(): Viewport;
  setViewport(viewport: Viewport, options?: { animate?: boolean }): void;
  fitFeature(feature: MapFeature): void;
}

type Corner = MapVersion["settings"]["legend"]["position"];

/* The zoom buttons and the scale bar take whichever corners the key leaves free. */
const ZOOM_CORNER: Record<Corner, string> = {
  "top-start": "top-2 end-2",
  "top-end": "bottom-2 end-2",
  "bottom-start": "top-2 end-2",
  "bottom-end": "top-2 end-2",
};
const SCALE_CORNER: Record<Corner, string> = {
  "top-start": "bottom-2 start-2",
  "top-end": "bottom-2 start-2",
  "bottom-start": "bottom-2 end-2",
  "bottom-end": "bottom-2 start-2",
};

const SR_LIST_LIMIT = 80;
/** A pan button moves the view by this share of the map's width or height. */
const PAN_SHARE = 1 / 3;
const CONTROL = "grid size-dock place-items-center -outline-offset-2 hover:bg-well active:bg-rule";
const PAD = "grid size-7 place-items-center -outline-offset-2 hover:bg-well active:bg-rule";

/** Whether this document is shown full screen, following changes made by the browser too (Esc). */
function useFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== "undefined" && document.fullscreenElement !== null);
  useEffect(() => {
    const update = (): void => setOn(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  return on;
}
/** An opening view is a centre and a zoom chosen on a desk monitor; below this width the zoom steps back so a phone sees the same ground. */
const OPENING_VIEW_WIDTH = 640;
const MAX_ZOOM_BACK = 1.5;
/** The key folds to its heading when the map is narrower than this, or when it would cover more than this share of the map's height. */
const KEY_MIN_WIDTH = 448;
const KEY_MAX_SHARE = 0.66;
const KEY_HEADING_HEIGHT = 44;
const KEY_ROW_HEIGHT = 26;

function openingViewFor(viewport: Viewport, width: number): Viewport {
  if (width <= 0 || width >= OPENING_VIEW_WIDTH) return viewport;
  return { ...viewport, zoom: viewport.zoom - Math.min(MAX_ZOOM_BACK, Math.log2(OPENING_VIEW_WIDTH / width)) };
}

export interface MapStageProps {
  version: MapVersion;
  scope: ThemeScope;
  navigation: Navigation;
  showKey: boolean;
  showZoom: boolean;
  /** Buttons that move the map without dragging, and one back to the starting view. */
  showPan: boolean;
  /** A full-screen button, where the browser allows it (the embed page; not the editor's preview). */
  showFullscreen?: boolean;
  showScale: boolean;
  timeWindow: TimeWindow | null;
  highlightIds: readonly string[];
  /** Where the map opens, when that is not the artifact's own opening view. */
  initialViewport?: Viewport;
  handleRef?: Ref<MapViewerHandle>;
  onViewport?: (viewport: Viewport) => void;
}

/** The map itself and what sits on it: the key, the zoom buttons, the scale bar and the card for a tapped feature. */
export function MapStage({
  version,
  scope,
  navigation,
  showKey,
  showZoom,
  showPan,
  showFullscreen = false,
  showScale,
  timeWindow,
  highlightIds,
  initialViewport,
  handleRef,
  onViewport,
}: MapStageProps) {
  const t = useEmbedStrings();
  const lang = useLang();
  const dir = version.uiDir;
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<ReaderMap | null>(null);
  const [resolution, setResolution] = useState(0);
  const [card, setCard] = useState<CardTarget | null>(null);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });

  /* Read when the map is created; none of these may recreate it. */
  const latest = useRef({ version, mode: scope.mode, onViewport, initialViewport, lastViewport: null as Viewport | null, title: t.mapLabel(version.title.value) });
  latest.current = { ...latest.current, version, mode: scope.mode, onViewport, title: t.mapLabel(version.title.value) };

  const locale = useMemo(
    () => ({
      "CooperativeGesturesHandler.WindowsHelpText": t.gestureWindows,
      "CooperativeGesturesHandler.MacHelpText": t.gestureMac,
      "CooperativeGesturesHandler.MobileHelpText": t.gestureMobile,
    }),
    [t],
  );

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const initial = latest.current;
    /* A picture always shows the opening view; a live map keeps where the reader had got to. */
    const opening = openingViewFor(initial.initialViewport ?? initial.version.settings.openingView, element.clientWidth);
    const viewport = navigation === "none" ? opening : (initial.lastViewport ?? opening);
    const created = new ReaderMap({
      container: element,
      viewport,
      settings: initial.version.settings,
      features: initial.version.features,
      theme: initial.mode,
      navigation,
      locale,
      canvasLabel: initial.title,
    });
    let frame = 0;
    const measure = () => {
      frame = 0;
      setResolution(Number(created.getResolution().toPrecision(3)));
    };
    const off = [
      created.on("viewport", (next) => {
        latest.current.lastViewport = next;
        latest.current.onViewport?.(next);
        if (frame === 0) frame = requestAnimationFrame(measure);
        setCard(null);
      }),
      created.on("tap", (tap) => {
        const features = latest.current.version.features;
        /* A note reduced to its dot on a phone shows its text on tap; a note shown whole needs no card. */
        const hit = tap.ids
          .map((id) => features.find((feature) => feature.id === id))
          .find((feature) => feature !== undefined && (feature.kind !== "annotation" || created.isCollapsed(feature.id)) && readerText(feature) !== null);
        setCard(hit ? { feature: hit, point: tap.point } : null);
      }),
      created.on("problem", () => setBasemapFailed(true)),
    ];
    measure();
    setBasemapFailed(false);
    setMap(created);
    return () => {
      cancelAnimationFrame(frame);
      for (const unsubscribe of off) unsubscribe();
      created.destroy();
      setMap(null);
      setCard(null);
    };
  }, [version.mapId, navigation, locale]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setBox({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => map?.setContent(version.features, version.settings), [map, version.features, version.settings]);
  useEffect(() => {
    map?.setTheme(scope.mode);
    map?.refreshColours();
  }, [map, scope.mode, scope.key]);
  useEffect(() => map?.setTimeWindow(timeWindow), [map, timeWindow]);
  useEffect(() => map?.setHighlight(highlightIds), [map, highlightIds]);
  /* Labels keep out from under the key, the zoom buttons and the scale bar. */
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scope = stage.current;
    const element = container.current;
    if (map === null || scope === null || element === null) return undefined;
    return watchObstacles(scope, element, (boxes) => map.setLabelObstacles(boxes));
  }, [map]);

  useImperativeHandle(
    handleRef,
    () => ({
      getViewport: () => map?.getViewport() ?? latest.current.version.settings.openingView,
      setViewport: (viewport, options) => map?.setViewport(viewport, options),
      fitFeature: (feature) => map?.fitFeature(feature),
    }),
    [map],
  );

  /* A card for something the timeline has since removed from the map would point at nothing. */
  const cardShown = card !== null && map !== null && map.isDrawn(card.feature.id) ? card : null;

  const { settings, features } = version;
  const corner = settings.legend.position;
  const keyRows = useMemo(() => legendEntries(settings, features).length, [settings, features]);
  const hasKey = showKey && settings.legend.show && keyRows > 0;
  const keyFolds = box.width < KEY_MIN_WIDTH || KEY_HEADING_HEIGHT + keyRows * KEY_ROW_HEIGHT > box.height * KEY_MAX_SHARE;
  const listed = useMemo(
    () => features.flatMap((feature) => {
      const text = readerText(feature);
      return text ? [{ id: feature.id, text }] : [];
    }).slice(0, SR_LIST_LIMIT),
    [features],
  );
  const moves = navigation !== "none";

  const resetView = (): void => {
    const element = container.current;
    const opening = initialViewport ?? settings.openingView;
    map?.setViewport(openingViewFor(opening, element?.clientWidth ?? 0), { animate: true });
  };

  const fullscreen = useFullscreen();
  const fullscreenAvailable = typeof document !== "undefined" && document.fullscreenEnabled;
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };

  return (
    <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden bg-well">
      {/* MapLibre makes its container `position: relative`, so the positioning lives on a wrapper. */}
      <div className="absolute inset-0">
        <div ref={container} className="size-full" />
      </div>

      <ul aria-label={t.featureList} className="sr-only">
        {listed.map(({ id, text }) => (
          <li key={id} dir={resolveDir(text)}>
            {text.value}
          </li>
        ))}
      </ul>

      {hasKey ? <MapKey version={version} scope={scope} folds={keyFolds} /> : null}

      {moves && (showZoom || showPan || showFullscreen) ? (
        <div data-label-obstacle className={`absolute flex flex-col items-end gap-1.5 ${ZOOM_CORNER[corner]}`}>
          {showZoom ? (
            <div role="group" aria-label={t.zoomGroup} className="flex flex-col overflow-hidden rounded-key border border-rule-strong bg-panel text-ink">
              <button type="button" aria-label={t.zoomIn} onClick={() => map?.zoomBy(1)} className={CONTROL}>
                <Icon name="plus" />
              </button>
              <span aria-hidden="true" className="h-px bg-rule-strong" />
              <button type="button" aria-label={t.zoomOut} onClick={() => map?.zoomBy(-1)} className={CONTROL}>
                <Icon name="minus" />
              </button>
            </div>
          ) : null}
          {showPan ? (
            /* Compass directions, so never mirrored: west stays on the left in a right-to-left page. */
            <div role="group" aria-label={t.panGroup} dir="ltr" className="grid grid-cols-3 overflow-hidden rounded-key border border-rule-strong bg-panel text-ink">
              <span aria-hidden="true" />
              <button type="button" aria-label={t.panNorth} onClick={() => map?.panBy(0, -PAN_SHARE)} className={PAD}>
                <Icon name="panUp" size={14} />
              </button>
              <span aria-hidden="true" />
              <button type="button" aria-label={t.panWest} onClick={() => map?.panBy(-PAN_SHARE, 0)} className={PAD}>
                <Icon name="panLeft" size={14} />
              </button>
              <button type="button" aria-label={t.resetView} title={t.resetView} onClick={resetView} className={PAD}>
                <Icon name="recentre" size={14} />
              </button>
              <button type="button" aria-label={t.panEast} onClick={() => map?.panBy(PAN_SHARE, 0)} className={PAD}>
                <Icon name="panRight" size={14} />
              </button>
              <span aria-hidden="true" />
              <button type="button" aria-label={t.panSouth} onClick={() => map?.panBy(0, PAN_SHARE)} className={PAD}>
                <Icon name="panDown" size={14} />
              </button>
              <span aria-hidden="true" />
            </div>
          ) : null}
          {showFullscreen && fullscreenAvailable ? (
            <button
              type="button"
              aria-label={fullscreen ? t.exitFullscreen : t.fullscreen}
              title={fullscreen ? t.exitFullscreen : t.fullscreen}
              onClick={toggleFullscreen}
              className={`${CONTROL} overflow-hidden rounded-key border border-rule-strong bg-panel text-ink`}
            >
              <Icon name={fullscreen ? "exitFullscreen" : "fullscreen"} />
            </button>
          ) : null}
        </div>
      ) : null}

      {showScale && resolution > 0 ? (
        <div data-label-obstacle className={`pointer-events-none absolute ${SCALE_CORNER[corner]}`}>
          <ScaleBar metresPerPixel={resolution} dir={dir} />
        </div>
      ) : null}

      {basemapFailed ? (
        <p role="status" className="absolute inset-x-2 top-2 mx-auto w-fit max-w-full rounded-key border border-rule-strong bg-panel px-2 py-1 text-center font-ui text-2xs text-ink-2">
          {t.basemapFailed}
        </p>
      ) : null}

      {cardShown ? <FeatureCard target={cardShown} settings={settings} locale={LOCALE[lang]} onClose={() => setCard(null)} /> : null}
    </div>
  );
}
