import { AttributionControl } from "maplibre-gl";
import type {
  ControllerEvents,
  ControllerOptions,
  EditorController,
  EditorControllerFactory,
  ExportImageOptions,
  MapInsets,
  ScreenBox,
  ThemeMode,
  ToolId,
} from "@/editor/controller";
import type { BasemapStyleId, LabelLanguage, LngLat, MapFeature, MapSettings, RichText, Viewport } from "@/model/types";
import { basemapTheme } from "@/render/basemap";
import { FeatureRenderer } from "@/render/feature-renderer";
import { lngLatToMerc, mercToLngLat, metresPerPixel } from "@/render/geo";
import type { MapLibreMap } from "@/render/maplibre";
import { BasemapSync } from "./basemap-sync";
import { CAPABILITIES, createEditorMap, holdMap, releaseMap } from "./editor-map";
import { boundsOf, fitInside, maxCanvasSide, moveTo, NO_INSETS, readViewport } from "./camera";
import { Chrome } from "./chrome";
import { wireInput, wireMapEvents } from "./controller-input";
import type { PenMode } from "./input";
import { DrawTool, type Finished } from "./draw-tool";
import { allCoordinates } from "./edit";
import { Emitter } from "./emitter";
import { renderImage } from "./export";
import type { PointerSample } from "./input";
import { SelectTool } from "./select-tool";
import { Overrides } from "./overrides";
import type { Tool, ToolHost } from "./tool";
import { createToolHost } from "./tool-host";


class MapLibreController implements EditorController {
  readonly capabilities = CAPABILITIES;

  private readonly map: MapLibreMap;
  private readonly renderer: FeatureRenderer;
  private readonly chrome: Chrome | null = null;
  private readonly events = new Emitter<ControllerEvents>();
  private readonly ready: Promise<void>;
  private readonly disposers: (() => void)[] = [];
  private readonly selectTool: SelectTool | null = null;
  private readonly host: ToolHost;
  private readonly interactive: boolean;
  private attribution = new AttributionControl({ compact: true });

  private features: readonly MapFeature[];
  private byId: Map<string, MapFeature>;
  private settings: MapSettings;
  private basemap: { styleId: BasemapStyleId; labelLanguage: LabelLanguage };
  private theme: ThemeMode;
  private dir: "ltr" | "rtl";
  private title: RichText;
  private timeWindow: { from: string | null; to: string } | null = null;
  private insets: MapInsets = NO_INSETS;
  private rendering = true;
  private readonly basemapSync: BasemapSync;

  private toolId: ToolId = "select";
  private tool: Tool | null = null;
  private selected = new Set<string>();
  private snapping = true;
  private drawDefaults: Partial<MapFeature> = {};
  private coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  private toolLocked = false;
  private penMode: PenMode = "auto";
  /** The shape finished last, until anything else happens on the map. */
  private lastFinished: Finished | null = null;
  private lastPointer: PointerSample | null = null;

  private readonly overrides: Overrides;

  private destroyed = false;

  constructor(options: ControllerOptions) {
    this.features = options.features;
    this.byId = new Map(options.features.map((feature) => [feature.id, feature]));
    this.settings = options.settings;
    this.basemap = options.settings.basemap;
    this.theme = options.theme;
    this.dir = options.dir;
    this.title = options.title ?? { value: "", dir: options.dir };
    this.interactive = options.interactive;

    this.map = createEditorMap(options, this.mapTheme());
    this.map.addControl(this.attribution, this.attributionCorner());

    this.renderer = new FeatureRenderer(this.map, {
      features: options.features,
      settings: options.settings,
      theme: this.mapTheme(),
      timeWindow: null,
      attach: true,
    });
    this.disposers.push(
      this.renderer.onPaletteChange((palette) => {
        this.chrome?.setPalette(palette);
        void this.applyBasemap();
      }),
    );

    this.ready = new Promise((resolve) => {
      const onLoad = () => {
        resolve();
        this.events.emit("ready");
      };
      if (this.map.loaded()) queueMicrotask(onLoad);
      else void this.map.once("load").then(onLoad);
    });

    this.overrides = new Overrides((features) => {
      this.renderer.setOverrides(features);
      this.chrome?.requestPaint();
    });
    this.basemapSync = new BasemapSync(this.map, this.ready, (detail) => this.events.emit("problem", { code: "tiles_failed", detail }), () => this.destroyed);
    this.host = this.createHost();
    this.disposers.push(wireMapEvents(this.map, this.events, this.basemapSync));
    if (options.interactive) {
      this.chrome = new Chrome(this.map, this.renderer.getPalette());
      this.selectTool = new SelectTool(this.host);
      this.tool = this.selectTool;
      this.chrome.setPainter((pen, view) => {
        for (const id of this.selected) {
          const shape = this.renderer.shape(id, view);
          if (shape) pen.outline(shape);
        }
        this.tool?.paint(pen, view);
      });
      this.attachInput();
    }
    void this.applyBasemap();
  }

  /* -------------------------------------------------------------- lifecycle */

  whenReady(): Promise<void> {
    return this.ready;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.overrides.clear();
    for (const dispose of this.disposers) dispose();
    this.chrome?.destroy();
    this.renderer.destroy();
    this.events.clear();
    /* Removing the map releases its WebGL context instead of leaving it for the collector. */
    this.map.remove();
  }

  on<K extends keyof ControllerEvents>(event: K, handler: ControllerEvents[K]): () => void {
    return this.events.on(event, handler);
  }

  /* ------------------------------------------------------------ document in */

  setFeatures(features: MapFeature[]): void {
    this.features = features;
    this.byId = new Map(features.map((feature) => [feature.id, feature]));
    this.renderer.setFeatures(features);
    /* The store has answered a commit: its features are now what is shown, in the same frame. */
    this.overrides.echoed();
    this.chrome?.requestPaint();
  }

  setSettings(settings: MapSettings): void {
    this.settings = settings;
    this.renderer.setSettings(settings);
    this.setBasemap(settings.basemap);
    this.chrome?.requestPaint();
  }

  setTheme(theme: ThemeMode): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.renderer.setTheme(this.mapTheme());
    void this.applyBasemap();
  }

  setDir(dir: "ltr" | "rtl"): void {
    if (dir === this.dir) return;
    this.dir = dir;
    this.map.removeControl(this.attribution);
    this.attribution = new AttributionControl({ compact: true });
    this.map.addControl(this.attribution, this.attributionCorner());
  }

  setDocument(document: { title: RichText }): void {
    this.title = document.title;
  }

  /* ------------------------------------------------------------ interaction */

  setTool(tool: ToolId): void {
    if (!this.interactive || !this.selectTool || tool === this.toolId) return;
    this.tool?.dispose();
    this.toolId = tool;
    if (tool === "select") {
      this.tool = this.selectTool;
    } else {
      if (this.selectTool.getReshaping() !== null) this.host.reshape(null);
      this.tool = new DrawTool(this.host, tool);
    }
    this.refreshCursor();
    this.chrome?.requestPaint();
  }

  getTool(): ToolId {
    return this.toolId;
  }

  setToolLocked(locked: boolean): void {
    this.toolLocked = locked;
  }

  setPenMode(mode: PenMode): void {
    this.penMode = mode;
  }

  startMove(): boolean {
    if (!this.interactive || !this.selectTool || this.tool !== this.selectTool) return false;
    const started = this.selectTool.startMove();
    this.refreshCursor();
    return started;
  }

  addAt(kind: "point" | "annotation", at: LngLat): void {
    if (!this.interactive) return;
    if (this.toolId !== kind) {
      this.setTool(kind);
      this.events.emit("tool", kind);
    }
    if (this.tool instanceof DrawTool) this.tool.placeAtLngLat(at);
  }

  setCrosshair(on: boolean): void {
    if (this.tool instanceof DrawTool) this.tool.setKeyboard(on);
  }

  placeAtCrosshair(): void {
    if (this.tool instanceof DrawTool) this.tool.placeAtCrosshair();
  }

  undoPoint(): boolean {
    return this.tool instanceof DrawTool ? this.tool.undoPoint() : false;
  }

  redoPoint(): boolean {
    return this.tool instanceof DrawTool ? this.tool.redoPoint() : false;
  }

  reopenable(): string | null {
    return this.lastFinished?.featureId ?? null;
  }

  reopen(): void {
    const finished = this.lastFinished;
    this.lastFinished = null;
    if (!finished || !this.interactive || !this.selectTool) return;
    this.tool?.dispose();
    this.toolId = finished.kind;
    this.tool = new DrawTool(this.host, finished.kind, finished.points);
    this.events.emit("tool", finished.kind);
    this.refreshCursor();
    this.chrome?.requestPaint();
  }

  cancel(): void {
    this.tool?.cancel();
  }

  finish(): void {
    this.tool?.finish();
  }

  setDrawDefaults(defaults: Partial<MapFeature>): void {
    this.drawDefaults = defaults;
  }

  setSelection(ids: string[]): void {
    this.selected = new Set(ids);
    this.renderer.setLabelPriority(this.selected);
    this.chrome?.requestPaint();
  }

  setReshaping(id: string | null): void {
    if (!this.selectTool) return;
    if (id !== null && this.toolId !== "select") this.setTool("select");
    this.selectTool.setReshaping(id);
  }

  setSnapping(enabled: boolean): void {
    this.snapping = enabled;
  }

  /* ------------------------------------------------------------------- time */

  setTimeFilter(window: { from: string | null; to: string } | null): void {
    this.timeWindow = window;
    this.renderer.setTimeWindow(window);
  }

  /* ------------------------------------------------------------------- view */

  getViewport(): Viewport {
    return readViewport(this.map);
  }

  setViewport(viewport: Partial<Viewport>, options?: { animate?: boolean }): void {
    moveTo(this.map, viewport, options?.animate === true);
  }

  panBy(x: number, y: number): void {
    const container = this.map.getContainer();
    this.map.panBy([x * container.clientWidth, y * container.clientHeight], { duration: 200 });
  }

  fitFeatures(ids?: string[]): void {
    const wanted = ids ? new Set(ids) : null;
    const coordinates = this.renderer
      .visibleItems()
      .filter((item) => wanted === null || wanted.has(item.feature.id))
      .flatMap((item) => allCoordinates(item.feature));
    const bounds = boundsOf(coordinates);
    if (bounds) this.fitBounds(bounds);
  }

  fitBounds(bounds: [LngLat, LngLat]): void {
    fitInside(this.map, bounds, this.insets, this.dir);
  }

  setRendering(enabled: boolean): void {
    if (enabled === this.rendering) return;
    this.rendering = enabled;
    if (!enabled) holdMap(this.map);
    this.renderer.setPaused(!enabled);
    this.chrome?.setPaused(!enabled);
    if (enabled) releaseMap(this.map);
  }

  setLabelObstacles(boxes: readonly ScreenBox[]): void {
    this.renderer.setLabelObstacles(boxes);
  }

  setInsets(insets: MapInsets): void {
    this.insets = { top: Math.max(0, insets.top), bottom: Math.max(0, insets.bottom), start: Math.max(0, insets.start), end: Math.max(0, insets.end) };
  }

  setBasemap(basemap: { styleId: BasemapStyleId; labelLanguage: LabelLanguage }): void {
    if (basemap.styleId === this.basemap.styleId && basemap.labelLanguage === this.basemap.labelLanguage) return;
    this.basemap = basemap;
    this.renderer.setTheme(this.mapTheme());
    void this.applyBasemap();
  }

  project(at: LngLat): { x: number; y: number } {
    return this.renderer.view().project(lngLatToMerc(at));
  }

  unproject(point: { x: number; y: number }): LngLat {
    return mercToLngLat(this.renderer.view().unproject(point));
  }

  getResolution(): number {
    return metresPerPixel(this.map.getCenter().lat, this.map.getZoom());
  }

  /* ----------------------------------------------------------------- output */

  exportImage(options: ExportImageOptions): Promise<Blob> {
    const container = this.map.getContainer();
    return renderImage(
      {
        viewport: this.getViewport(),
        screen: { width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight) },
        features: this.features,
        settings: { ...this.settings, basemap: this.basemap },
        title: this.title,
        theme: this.theme,
        dir: this.dir,
        timeWindow: this.timeWindow,
        maxCanvasSide: maxCanvasSide(this.map),
        labelChoices: this.renderer.labelChoices(),
      },
      options,
    );
  }

  /* ---------------------------------------------------------------- private */

  /** What the tools may ask for. An object rather than `this` so a tool cannot reach the rest of the controller. */
  private createHost(): ToolHost {
    return createToolHost({
      renderer: this.renderer,
      events: this.events,
      overrides: this.overrides,
      documentFeature: (id) => this.byId.get(id),
      features: () => this.features,
      selection: () => this.selected,
      setSelection: (next) => {
        this.selected = new Set(next);
        this.renderer.setLabelPriority(this.selected);
        this.chrome?.requestPaint();
      },
      snapping: () => this.snapping,
      coarse: () => this.coarsePointer,
      drawDefaults: () => this.drawDefaults,
      dir: () => this.dir,
      reshape: (id) => this.selectTool?.setReshaping(id),
      leaveTool: () => this.setTool("select"),
      toolLocked: () => this.toolLocked,
      crosshairScreen: () => this.crosshairScreen(),
      finished: (finished) => {
        this.lastFinished = finished;
      },
      repaint: () => {
        this.chrome?.requestPaint();
        this.refreshCursor();
      },
    });
  }

  /** The palette set in use: the one stepped for the lightness of the basemap on screen. */
  private mapTheme(): ThemeMode {
    return basemapTheme(this.basemap.styleId, this.theme);
  }

  /** The centre of the part of the map that panes, the dock and the timeline leave visible. */
  private crosshairScreen(): { x: number; y: number } {
    const container = this.map.getContainer();
    const left = this.dir === "rtl" ? this.insets.end : this.insets.start;
    const right = this.dir === "rtl" ? this.insets.start : this.insets.end;
    return {
      x: left + Math.max(0, container.clientWidth - left - right) / 2,
      y: this.insets.top + Math.max(0, container.clientHeight - this.insets.top - this.insets.bottom) / 2,
    };
  }

  private attributionCorner(): "bottom-left" | "bottom-right" {
    return this.dir === "rtl" ? "bottom-left" : "bottom-right";
  }

  private attachInput(): void {
    this.disposers.push(
      wireInput({
        map: this.map,
        renderer: this.renderer,
        events: this.events,
        tool: () => this.tool,
        unproject: (point) => this.unproject(point),
        seen: (sample, coarse) => {
          if (coarse !== null) this.coarsePointer = coarse;
          this.lastPointer = sample;
        },
        lastPointer: () => this.lastPointer,
        interacted: () => {
          this.lastFinished = null;
        },
        refreshCursor: () => this.refreshCursor(),
        pen: { mode: () => this.penMode, detected: () => this.events.emit("pen") },
        contextMenu: (sample, client) => this.contextMenu(sample, client),
      }),
    );
  }

  /** A right-click: select what it hit, unless that is already selected, then report it for the menu. */
  private contextMenu(sample: PointerSample, client: { x: number; y: number }): void {
    if (!this.interactive) return;
    const tolerance = this.coarsePointer ? 12 : 4;
    const hitIds = this.renderer.hitTest(sample, tolerance).filter((id) => this.host.isSelectable(id));
    const top = hitIds[0];
    if (this.tool === this.selectTool && top !== undefined && !this.selected.has(top)) this.host.select([top], "replace");
    this.events.emit("contextmenu", { ...client, at: this.unproject(sample), hitIds });
  }

  private refreshCursor(): void {
    if (!this.tool) return;
    this.map.getCanvas().style.cursor = this.tool.cursor(this.lastPointer);
  }

  private applyBasemap(): Promise<void> {
    return this.basemapSync.apply(this.basemap, this.theme, this.renderer.getPalette());
  }
}

export const createMapLibreController: EditorControllerFactory = (options) => new MapLibreController(options);
