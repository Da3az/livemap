import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapFeature, MapSettings } from "@/model/types";
import type { Box, Pt } from "./geo";
import { hitsShape, shapeTouchesBox } from "./hit";
import { labelBucket, LabelPlacer, type LabelEntry } from "./labels";
import { NarrowAnnotations } from "./narrow";
import { paintDrawn, paintLabel, paintShape, type PaintEnv } from "./paint";
import { attachOverlayCanvas, clearOverlay } from "./overlay";
import { readPalette, type Palette, type ThemeMode } from "./palette";
import { PatternCache } from "./patterns";
import { buildSceneItem, Scene, toTimeWindow, type SceneItem, type TimeWindow } from "./scene";
import { buildShape, type ScreenShape } from "./shapes";
import { fontEpoch, fontsReadyFor, onFontsLoaded } from "./text";
import { readView, type View } from "./view";

export interface FeatureRendererOptions {
  features: readonly MapFeature[];
  settings: MapSettings;
  theme: ThemeMode;
  timeWindow: { from: string | null; to: string } | null;
  /**
   * true: the renderer owns a canvas over the map and keeps it in step with
   * the camera. false: nothing is attached and the owner calls `paintInto`
   * (image export).
   */
  attach: boolean;
  /**
   * Where another renderer put each label (see `labelChoices`). An exported
   * image passes the screen's answer so its labels sit where the author saw them.
   */
  labelHints?: ReadonlyMap<string, number>;
  /** Use `labelHints` as they are, without re-deciding: the image is at the screen's own scale. */
  pinLabels?: boolean;
  /** The reader's map: on a phone-sized map, author-placed notes are fitted to the frame (see `NarrowAnnotations`). */
  narrowAnnotations?: boolean;
}

interface Drawn {
  item: SceneItem;
  shape: ScreenShape;
}

const NO_PRIORITY: ReadonlySet<string> = new Set();

const FONT_WAIT_MS = 3_000;

/**
 * Draws saved features over a MapLibre map. The editor, the preview, the
 * embed and image export all use this one class, so an author and a reader
 * see the same map.
 *
 * Technique: every feature is painted, in `order`, onto a single 2D canvas
 * laid over the map and redrawn in the same frame as the map whenever the
 * camera moves. One ordered pass over one surface is what makes draw order
 * free across kinds: a line under an area is just an earlier iteration.
 */
export class FeatureRenderer {
  private readonly scene = new Scene();
  private readonly patterns = new PatternCache();
  private readonly canvas: HTMLCanvasElement | null = null;
  private readonly context: CanvasRenderingContext2D | null = null;
  private readonly paletteListeners = new Set<(palette: Palette) => void>();
  private readonly disposers: (() => void)[] = [];

  private features: readonly MapFeature[];
  private overrides: readonly MapFeature[] = [];
  private draftFeature: MapFeature | null = null;
  private draft: SceneItem | null = null;
  private settings: MapSettings;
  private settingsVersion = 0;
  private theme: ThemeMode;
  private palette: Palette;
  private window: TimeWindow | null;

  private readonly labels: LabelPlacer;
  private readonly narrow: NarrowAnnotations | null;
  private obstacles: readonly Box[] = [];
  private priority: ReadonlySet<string> = NO_PRIORITY;
  /** Bumped by anything that can change which labels compete, other than the camera. */
  private labelEpoch = 0;
  private laidOut: Drawn[] = [];
  private laidOutKey = "";

  private sceneDirty = true;
  private frame = 0;
  private paintedViewKey = "";
  private destroyed = false;
  private paused = false;

  constructor(
    private readonly map: MapLibreMap,
    options: FeatureRendererOptions,
  ) {
    this.features = options.features;
    this.settings = options.settings;
    this.theme = options.theme;
    this.window = toTimeWindow(options.timeWindow);
    this.palette = readPalette(map.getContainer(), options.theme);
    this.labels = new LabelPlacer(options.labelHints ?? null, { pinned: options.pinLabels === true });
    this.narrow = options.narrowAnnotations === true ? new NarrowAnnotations() : null;

    this.disposers.push(
      onFontsLoaded(() => {
        this.sceneDirty = true;
        this.requestPaint();
      }),
    );

    if (!options.attach) return;

    const canvas = attachOverlayCanvas(map);
    this.canvas = canvas;
    this.context = canvas.getContext("2d");

    const onRender = () => {
      if (readView(map).key !== this.paintedViewKey) this.paintNow();
    };
    map.on("render", onRender);
    this.disposers.push(() => map.off("render", onRender));

    /* The host may switch the document's theme class after telling us the theme; follow it. */
    const observer = new MutationObserver(() => this.refreshPalette());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    this.disposers.push(() => observer.disconnect());

    this.requestPaint();
  }

  /* ------------------------------------------------------------------ input */

  setFeatures(features: readonly MapFeature[]): void {
    this.features = features;
    this.sceneDirty = true;
    this.requestPaint();
  }

  /**
   * Features shown in place of (or in addition to) the ones handed in, while
   * a gesture is in flight. They are a view of work in progress, not state:
   * the owner clears them once the document reflects the gesture.
   */
  setOverrides(features: readonly MapFeature[]): void {
    if (features.length === 0 && this.overrides.length === 0) return;
    this.overrides = features;
    this.sceneDirty = true;
    this.requestPaint();
  }

  /** A shape being drawn. Painted above everything, with the real styling. */
  setDraft(feature: MapFeature | null): void {
    if (feature === this.draftFeature) return;
    this.draftFeature = feature;
    this.draft = null;
    this.requestPaint();
  }

  setSettings(settings: MapSettings): void {
    if (settings === this.settings) return;
    this.settings = settings;
    this.settingsVersion++;
    this.sceneDirty = true;
    this.draft = null;
    this.requestPaint();
  }

  setTheme(theme: ThemeMode): void {
    this.theme = theme;
    this.refreshPalette();
  }

  /**
   * Cheap enough to call every animation frame: one numeric comparison per
   * feature, and a repaint only when some feature's visibility flips.
   */
  setTimeWindow(window: { from: string | null; to: string } | null): void {
    this.window = toTimeWindow(window);
    if (this.sceneDirty) {
      this.requestPaint();
      return;
    }
    if (this.scene.applyWindow(this.window)) {
      this.labelEpoch++;
      this.requestPaint();
    }
  }

  /**
   * Features whose labels are placed before any other and are never dropped:
   * the editor's selection. Everything else keeps its place unless that place is now taken.
   */
  setLabelPriority(ids: Iterable<string>): void {
    const next = new Set(ids);
    if (next.size === this.priority.size && [...next].every((id) => this.priority.has(id))) return;
    this.priority = next;
    this.labelEpoch++;
    this.requestPaint();
  }

  /**
   * Stops painting the on-screen canvas while something covers the map (a
   * full-screen preview), and paints once on resume. Queries, hit-testing and
   * `paintInto` keep working.
   */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.requestPaint();
  }

  /**
   * Screen rectangles the map's furniture covers, in CSS pixels from the
   * map's top-left corner. Labels move out from under them.
   */
  setLabelObstacles(obstacles: readonly Box[]): void {
    this.obstacles = obstacles;
    this.labels.setObstacles(obstacles);
    this.labelEpoch++;
    this.requestPaint();
  }

  /** The place each label currently takes, to hand to another renderer as `labelHints`. */
  labelChoices(): ReadonlyMap<string, number> {
    this.layout(this.view());
    return new Map(this.labels.snapshot());
  }

  /* ---------------------------------------------------------------- queries */

  getPalette(): Palette {
    return this.palette;
  }

  onPaletteChange(listener: (palette: Palette) => void): () => void {
    this.paletteListeners.add(listener);
    return () => this.paletteListeners.delete(listener);
  }

  view(): View {
    return readView(this.map);
  }

  /** Items that are drawn: not hidden and inside the time window. Ascending draw order. */
  visibleItems(): SceneItem[] {
    this.ensureScene();
    return this.scene.items.filter((item) => !item.hidden && item.inWindow);
  }

  item(id: string): SceneItem | undefined {
    this.ensureScene();
    return this.scene.get(id);
  }

  /** The on-screen shape of a drawn feature, or null when it is hidden or filtered out. */
  shape(id: string, view: View = this.view()): ScreenShape | null {
    const item = this.item(id);
    if (!item || item.hidden || !item.inWindow) return null;
    this.layout(view);
    return this.shapeFor(item, view);
  }

  /** Ids of the drawn features under a point, topmost first. */
  /** True when a note is shown as its anchor dot only, on a phone-sized reader map. */
  isAnnotationCollapsed(id: string): boolean {
    this.layout(this.view());
    return this.narrow?.isCollapsed(id) ?? false;
  }

  hitTest(p: Pt, tolerance: number): string[] {
    const drawn = this.layout(this.view());
    const hits: string[] = [];
    for (let index = drawn.length - 1; index >= 0; index--) {
      const entry = drawn[index];
      if (entry && hitsShape(entry.item, entry.shape, p, tolerance)) hits.push(entry.item.feature.id);
    }
    return hits;
  }

  /** Ids of the drawn features touching a rectangle, in draw order. */
  queryBox(box: Box): string[] {
    return this.layout(this.view())
      .filter((entry) => shapeTouchesBox(entry.shape, box))
      .map((entry) => entry.item.feature.id);
  }

  /* --------------------------------------------------------------- painting */

  /** Resolves once the typefaces the visible text needs are loaded, or after a short wait. */
  async whenFontsReady(): Promise<void> {
    const blocks = this.visibleItems().flatMap((item) => (item.text ? [item.text] : []));
    if (await fontsReadyFor(blocks, FONT_WAIT_MS)) this.sceneDirty = true;
  }

  /**
   * Paints every drawn feature into a context whose unit is one CSS pixel of
   * `view`. The on-screen canvas and an exported image both come through here.
   */
  paintInto(context: CanvasRenderingContext2D, view: View, pixelRatio: number): void {
    const drawn = this.layout(view);
    const env: PaintEnv = {
      palette: this.palette,
      patterns: this.patterns,
      pixelRatio,
      patternOrigin: view.project({ x: 0.5, y: 0.5 }),
    };
    paintDrawn(context, drawn, view, env);

    if (this.draftFeature) {
      this.draft ??= buildSceneItem(this.draftFeature, this.settings, this.palette);
      const shape = buildShape(this.draft, view);
      paintShape(context, this.draft, shape, env);
      paintLabel(context, shape, env);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    for (const dispose of this.disposers) dispose();
    this.canvas?.remove();
    this.patterns.clear();
    this.paletteListeners.clear();
  }

  /* ---------------------------------------------------------------- private */

  private refreshPalette(): void {
    if (this.destroyed) return;
    const next = readPalette(this.map.getContainer(), this.theme);
    if (next.key === this.palette.key) return;
    this.palette = next;
    this.patterns.clear();
    this.sceneDirty = true;
    this.draft = null;
    this.requestPaint();
    for (const listener of this.paletteListeners) listener(next);
  }

  private ensureScene(): void {
    if (!this.sceneDirty) return;
    this.sceneDirty = false;
    let features = this.features;
    if (this.overrides.length > 0) {
      const replaced = new Map(this.overrides.map((feature) => [feature.id, feature]));
      const merged = this.features.map((feature) => {
        const override = replaced.get(feature.id);
        if (override) replaced.delete(feature.id);
        return override ?? feature;
      });
      features = [...merged, ...replaced.values()];
    }
    const epoch = `${this.settingsVersion}|${this.palette.key}|${fontEpoch()}`;
    this.scene.rebuild(features, this.settings, this.palette, this.window, epoch);
    this.scene.applyWindow(this.window);
    this.labelEpoch++;
  }

  /**
   * Everything drawn in this view, in draw order, with each label in the
   * place de-confliction gave it. Painting, hit-testing and outlining all read
   * shapes through here, so a click lands on a label where it is drawn and
   * never on one that was dropped.
   */
  private layout(view: View): Drawn[] {
    this.ensureScene();
    const key = `${view.key}|${this.labelEpoch}`;
    if (key === this.laidOutKey) return this.laidOut;
    const drawn: Drawn[] = [];
    const entries: LabelEntry[] = [];
    for (const item of this.scene.items) {
      if (item.hidden || !item.inWindow) continue;
      const shape = this.shapeFor(item, view);
      drawn.push({ item, shape });
      entries.push({ id: item.feature.id, shape, block: item.text, strokeWidth: item.style.stroke?.width ?? 0 });
    }
    this.narrow?.apply(drawn, view, this.obstacles);
    this.labels.apply(entries, `${labelBucket(view.zoom, view.bearing, view.pitch)}|${this.labelEpoch}|${view.width}x${view.height}`, this.priority);
    this.laidOut = drawn;
    this.laidOutKey = key;
    return drawn;
  }

  private shapeFor(item: SceneItem, view: View): ScreenShape {
    if (item.shape === null || item.shapeKey !== view.key) {
      item.shape = buildShape(item, view);
      item.shapeKey = view.key;
    }
    return item.shape;
  }

  private requestPaint(): void {
    if (!this.context || this.frame !== 0 || this.destroyed || this.paused) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paintNow();
    });
  }

  private paintNow(): void {
    const { canvas, context } = this;
    if (!canvas || !context || this.destroyed || this.paused) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const view = this.view();
    const pixelRatio = clearOverlay(canvas, context, view);
    this.paintInto(context, view, pixelRatio);
    this.paintedViewKey = view.key;
  }
}
