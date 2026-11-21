import type { MapMouseEvent, StyleSpecification } from "maplibre-gl";
import { allCoordinates } from "@/editor/engine/edit";
import { Emitter } from "@/editor/engine/emitter";
import type { BasemapStyleId, LabelLanguage, LngLat, MapFeature, MapSettings, Viewport } from "@/model/types";
import { basemapTheme, blankStyle, buildBasemapStyle, effectiveStyleId, loadBasemapStyle } from "@/render/basemap";
import { toCss } from "@/render/color";
import { FeatureRenderer } from "@/render/feature-renderer";
import { metresPerPixel, type Box, type Pt } from "@/render/geo";
import { createMap, type MapLibreMap } from "@/render/maplibre";
import { traceOutline } from "@/render/paint";
import { readPalette, type ThemeMode } from "@/render/palette";
import "./gesture-hint.css";

/**
 * How far a reader may move the map. `cooperative` zooms on scroll only with
 * a modifier key and pans on touch only with two fingers, so the article
 * around the map still scrolls. `none` is a picture.
 */
export type Navigation = "free" | "cooperative" | "none";

export interface ReaderMapOptions {
  container: HTMLElement;
  viewport: Viewport;
  settings: MapSettings;
  features: readonly MapFeature[];
  theme: ThemeMode;
  navigation: Navigation;
  /** MapLibre's own words: the gesture hint and the canvas label. */
  locale: Record<string, string>;
  canvasLabel: string;
}

export interface ReaderTap {
  /** Features under the tap, topmost first. */
  ids: string[];
  /** Where the tap landed, in CSS pixels from the map's top-left corner. */
  point: Pt;
}

interface ReaderEvents {
  /** The camera moved, by the reader or by a call. Delivered synchronously. */
  viewport: (viewport: Viewport) => void;
  tap: (tap: ReaderTap) => void;
  /** The basemap could not be loaded; the features are still drawn over a plain ground. */
  problem: (detail: string) => void;
}

const TAP_TOLERANCE = 6;
const FIT_PADDING = 64;
const FIT_MAX_ZOOM = 11;
const POINT_ZOOM = 8.5;

/**
 * The reader's map: the same `FeatureRenderer` the editor draws with, on a
 * MapLibre map that a reader may pan and zoom but never edit. It owns one
 * WebGL context and gives it back in `destroy()`.
 */
export class ReaderMap {
  private readonly map: MapLibreMap;
  private readonly renderer: FeatureRenderer;
  private readonly events = new Emitter<ReaderEvents>();
  private readonly ready: Promise<void>;
  private readonly disposers: (() => void)[] = [];
  private readonly overlay: HTMLCanvasElement;

  private basemap: { styleId: BasemapStyleId; labelLanguage: LabelLanguage };
  private theme: ThemeMode;
  private highlighted: readonly string[] = [];
  private basemapRequest = 0;
  private shownStyleId: BasemapStyleId | null = null;
  private problemReported = false;
  private overlayFrame = 0;
  private hoverFrame = 0;
  private destroyed = false;

  constructor(options: ReaderMapOptions) {
    this.basemap = options.settings.basemap;
    this.theme = options.theme;
    const moves = options.navigation !== "none";

    this.map = createMap({
      container: options.container,
      style: blankStyle(readPalette(options.container, this.mapTheme())),
      center: options.viewport.center,
      zoom: options.viewport.zoom,
      bearing: options.viewport.bearing,
      pitch: options.viewport.pitch,
      interactive: moves,
      cooperativeGestures: options.navigation === "cooperative",
      locale: options.locale,
      /* The page prints the attribution in the credit line, where it is always readable. */
      attributionControl: false,
      /* A reader moves and zooms; turning and tilting only lose them. */
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      boxZoom: false,
    });
    if (moves) {
      this.map.touchZoomRotate.disableRotation();
      this.map.keyboard.disableRotation();
    }
    this.map.getCanvas().setAttribute("aria-label", options.canvasLabel);
    this.map.getContainer().classList.add("reader-map");

    this.renderer = new FeatureRenderer(this.map, {
      features: options.features,
      settings: options.settings,
      theme: this.mapTheme(),
      timeWindow: null,
      attach: true,
      narrowAnnotations: true,
    });
    this.disposers.push(
      this.renderer.onPaletteChange(() => {
        void this.applyBasemap();
        this.requestOverlay();
      }),
    );

    this.overlay = document.createElement("canvas");
    this.overlay.setAttribute("aria-hidden", "true");
    Object.assign(this.overlay.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
    this.map.getCanvasContainer().appendChild(this.overlay);

    this.ready = new Promise((resolve) => {
      if (this.map.loaded()) queueMicrotask(resolve);
      else void this.map.once("load").then(() => resolve());
    });

    this.listen(moves);
    void this.applyBasemap();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  on<K extends keyof ReaderEvents>(event: K, handler: ReaderEvents[K]): () => void {
    return this.events.on(event, handler);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.overlayFrame);
    cancelAnimationFrame(this.hoverFrame);
    for (const dispose of this.disposers) dispose();
    this.renderer.destroy();
    this.overlay.remove();
    this.events.clear();
    /* Removing the map releases its WebGL context instead of leaving it for the collector. */
    this.map.remove();
  }

  /* ------------------------------------------------------------ document in */

  /** A new artifact in place: the camera and everything else the reader set stay as they are. */
  setContent(features: readonly MapFeature[], settings: MapSettings): void {
    this.renderer.setFeatures(features);
    this.renderer.setSettings(settings);
    const next = settings.basemap;
    if (next.styleId !== this.basemap.styleId || next.labelLanguage !== this.basemap.labelLanguage) {
      this.basemap = next;
      this.renderer.setTheme(this.mapTheme());
      void this.applyBasemap();
    }
    this.requestOverlay();
  }

  setTheme(theme: ThemeMode): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.renderer.setTheme(this.mapTheme());
    void this.applyBasemap();
    this.requestOverlay();
  }

  /** Read the colours in scope again, for a host that changed them without changing the theme's name. */
  refreshColours(): void {
    this.renderer.setTheme(this.mapTheme());
    this.requestOverlay();
  }

  setTimeWindow(window: { from: string | null; to: string } | null): void {
    this.renderer.setTimeWindow(window);
    this.requestOverlay();
  }

  /** Outline these features so the eye finds them. Ids the map does not hold are ignored. */
  /** True when a note is reduced to its anchor dot on a phone-sized map; tapping it shows its text. */
  isCollapsed(id: string): boolean {
    return this.renderer.isAnnotationCollapsed(id);
  }

  /** Screen rectangles the reader's furniture covers; labels keep clear of them. */
  setLabelObstacles(boxes: readonly Box[]): void {
    this.renderer.setLabelObstacles(boxes);
  }

  setHighlight(ids: readonly string[]): void {
    this.highlighted = ids;
    this.requestOverlay();
  }

  /* ------------------------------------------------------------------- view */

  getViewport(): Viewport {
    const centre = this.map.getCenter();
    return { center: [centre.lng, centre.lat], zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch() };
  }

  setViewport(viewport: Viewport, options: { animate?: boolean } = {}): void {
    if (options.animate) this.map.easeTo({ ...viewport, duration: 300 });
    else this.map.jumpTo(viewport);
  }

  zoomBy(steps: number): void {
    this.map.easeTo({ zoom: this.map.getZoom() + steps, duration: 200 });
  }

  /** Bring a feature into view, whether or not this map is the one that holds it. */
  fitFeature(feature: MapFeature): void {
    const coordinates = allCoordinates(feature);
    const first = coordinates[0];
    if (!first) return;
    let [west, south] = first;
    let [east, north] = first;
    for (const [lng, lat] of coordinates) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    if (west === east && south === north) {
      /* A single point has no extent to fit: centre it and keep enough ground around it to say where it is. */
      this.map.easeTo({ center: first, zoom: Math.max(this.map.getZoom(), POINT_ZOOM), duration: 450 });
      return;
    }
    const container = this.map.getContainer();
    const padding = Math.max(0, Math.min(FIT_PADDING, container.clientWidth / 4, container.clientHeight / 4));
    const bounds: [LngLat, LngLat] = [
      [west, south],
      [east, north],
    ];
    this.map.fitBounds(bounds, { padding, maxZoom: FIT_MAX_ZOOM, duration: 450 });
  }

  /** Metres per CSS pixel at the centre, for the scale bar. */
  getResolution(): number {
    return metresPerPixel(this.map.getCenter().lat, this.map.getZoom());
  }

  /** True when the feature is drawn: not filtered out by the time window. */
  isDrawn(id: string): boolean {
    return this.renderer.shape(id) !== null;
  }

  /* ---------------------------------------------------------------- private */

  private mapTheme(): ThemeMode {
    return basemapTheme(this.basemap.styleId, this.theme);
  }

  private listen(moves: boolean): void {
    const { map } = this;
    const onMove = () => this.events.emit("viewport", this.getViewport());
    const onRender = () => this.paintOverlay();
    const onError = (event: { error?: { message?: string } }) => {
      /* One report per basemap: a failing tile server fails hundreds of requests. */
      if (this.problemReported) return;
      this.problemReported = true;
      this.events.emit("problem", event.error?.message ?? "The basemap could not be loaded.");
    };
    map.on("move", onMove);
    map.on("render", onRender);
    map.on("error", onError);
    this.disposers.push(() => {
      map.off("move", onMove);
      map.off("render", onRender);
      map.off("error", onError);
    });
    if (!moves) return;

    const onClick = (event: MapMouseEvent) => {
      this.events.emit("tap", { ids: this.renderer.hitTest(event.point, TAP_TOLERANCE), point: { x: event.point.x, y: event.point.y } });
    };
    const onHover = (event: MapMouseEvent) => {
      const point = { x: event.point.x, y: event.point.y };
      if (this.hoverFrame !== 0) return;
      this.hoverFrame = requestAnimationFrame(() => {
        this.hoverFrame = 0;
        map.getCanvas().style.cursor = this.renderer.hitTest(point, TAP_TOLERANCE).length > 0 ? "pointer" : "";
      });
    };
    map.on("click", onClick);
    map.on("mousemove", onHover);
    this.disposers.push(() => {
      map.off("click", onClick);
      map.off("mousemove", onHover);
    });
  }

  private requestOverlay(): void {
    if (this.overlayFrame !== 0 || this.destroyed) return;
    this.overlayFrame = requestAnimationFrame(() => {
      this.overlayFrame = 0;
      this.paintOverlay();
    });
  }

  private paintOverlay(): void {
    const context = this.overlay.getContext("2d");
    if (!context || this.destroyed) return;
    const view = this.renderer.view();
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.round(view.width * pixelRatio);
    const height = Math.round(view.height * pixelRatio);
    if (this.overlay.width !== width || this.overlay.height !== height) {
      this.overlay.width = width;
      this.overlay.height = height;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    if (this.highlighted.length === 0) return;
    const palette = this.renderer.getPalette();
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const id of this.highlighted) {
      const shape = this.renderer.shape(id, view);
      if (!shape) continue;
      traceOutline(context, shape);
      context.strokeStyle = toCss(palette.halo, 0.9);
      context.lineWidth = 7;
      context.stroke();
      context.strokeStyle = toCss(palette.selection, 1);
      context.lineWidth = 2.5;
      context.stroke();
    }
  }

  /** The same fetch, mute and set as the editor's controller; the latest request wins. */
  private async applyBasemap(): Promise<void> {
    const request = ++this.basemapRequest;
    const id = effectiveStyleId(this.basemap.styleId, this.theme);
    const { labelLanguage } = this.basemap;
    let style: StyleSpecification;
    let failure: string | null = null;
    try {
      const raw = await loadBasemapStyle(id);
      style = buildBasemapStyle(raw, id, { language: labelLanguage, palette: this.renderer.getPalette() });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      style = blankStyle(this.renderer.getPalette());
    }
    await this.ready;
    if (this.destroyed || request !== this.basemapRequest) return;
    this.problemReported = failure !== null;
    if (failure !== null) this.events.emit("problem", failure);
    const sameBasemap = failure === null && this.shownStyleId === id && this.map.isStyleLoaded() === true;
    this.shownStyleId = failure === null ? id : null;
    this.map.setStyle(style, { diff: sameBasemap });
  }
}
