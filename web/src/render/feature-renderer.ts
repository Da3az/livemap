import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapFeature, MapSettings } from "@/model/types";
import { boxesOverlap, emptyBox, type Box, type Pt } from "./geo";
import { cameraFor, projectWith, unprojectWith, type GlCamera } from "./gl/camera";
import { FeatureLayerOwner } from "./gl/feature-layer";
import { GpuScene, type DrawList } from "./gl/gpu-scene";
import { DashRegistry, ImageRegistry, phaseOf } from "./gl/images";
import { PrimBuffer, PrimMode } from "./gl/prims";
import { emitStatic, emitView, emitWhole, isViewDependent, textImage, type EmitContext } from "./gl/tessellate";
import { hitsShape, shapeTouchesBox } from "./hit";
import { labelBucket, LabelPlacer, type LabelEntry } from "./labels";
import { NarrowAnnotations } from "./narrow";
import { readPalette, type Palette, type ThemeMode } from "./palette";
import { TILE } from "./patterns";
import { buildSceneItem, Scene, toTimeWindow, type SceneItem, type TimeWindow } from "./scene";
import { arrowParts, buildShape, worldWrap, type ScreenShape } from "./shapes";
import { fontEpoch, fontsReadyFor, onFontsLoaded } from "./text";
import { readView, type View } from "./view";

export interface FeatureRendererOptions {
  features: readonly MapFeature[];
  settings: MapSettings;
  theme: ThemeMode;
  timeWindow: { from: string | null; to: string } | null;
  /**
   * true: the renderer adds its layer to the map and keeps it there across
   * style changes and lost contexts. false: nothing is attached and the owner
   * calls `paintInto` (image export).
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

/** One scene item's primitives: what holds at every view, and what is rebuilt per zoom. */
interface ItemDraw {
  item: SceneItem;
  slot: number;
  fixed: PrimBuffer | null;
  moving: PrimBuffer | null;
  /** The reference frame `moving` was built for. */
  movingFrame: number;
  /** For a note: where its text, leader and dot were, and the sub-pixel phase, when `moving` was built. */
  noteKey: string;
}

/**
 * The view that view-dependent geometry and label places were computed for.
 * Without pitch, panning is a pure translation of it, so it is kept until the
 * zoom, turn or size changes or the map pans far enough to leave the margin
 * the front-line teeth were built for. With pitch it is rebuilt every frame.
 */
interface ReferenceFrame {
  id: number;
  linearKey: string;
  view: View;
  camera: GlCamera;
  /** Screen position of the view's centre when the frame was built. */
  anchor: Pt;
  shapes: Map<SceneItem, ScreenShape>;
  /** The mercator box view-dependent geometry is built for; null when pitched (the frame is rebuilt every frame). */
  reach: Box | null;
}

const NO_PRIORITY: ReadonlySet<string> = new Set();
const FONT_WAIT_MS = 3_000;
/** Re-encode positions once the camera is this many CSS pixels from their origin (float32 keeps ~0.02 px there). */
const REBASE_PX = 2 ** 18;
/** Fraction of the view the map may pan before view-dependent geometry is rebuilt; teeth are built one view beyond each edge. */
const PAN_MARGIN = 0.75;
const MAX_IMAGES = 8192;
/** How long the camera must be still before text is placed at its exact sub-pixel position. */
const REST_MS = 200;
/** Time each frame may spend rasterising text new to the atlas; the rest follows on the next frames. */
const IMAGE_BUDGET_MS = 6;

function key(p: Pt | null | undefined): string {
  return p ? `${p.x.toFixed(3)},${p.y.toFixed(3)}` : "-";
}

/**
 * Draws saved features over a MapLibre map. The editor, the preview, the
 * embed and image export all use this one class, so an author and a reader
 * see the same map.
 *
 * Technique: one WebGL custom layer draws every feature in `order`, every
 * kind and every label in one ordered pass (one instanced draw call, see
 * gl/prims.ts). Geometry that holds at every view is built once per change
 * and kept on the GPU, so panning only changes a few uniforms. Arrow heads,
 * tapers, teeth, dash phases, leaders and label places are rebuilt when the
 * zoom or turn changes, and every frame while the map is pitched. Text and
 * marker glyphs are rasterised by the browser into an atlas, so they are
 * shaped exactly as before. Hit-testing works on CPU screen shapes built on
 * demand, from the same code that builds the drawn geometry.
 */
export class FeatureRenderer {
  private readonly scene = new Scene();
  private readonly paletteListeners = new Set<(palette: Palette) => void>();
  private readonly disposers: (() => void)[] = [];
  private readonly owner: FeatureLayerOwner | null = null;

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
  private sceneEpoch = "";
  private destroyed = false;
  private paused = false;

  /* The GPU side. */
  private gpu: GpuScene | null = null;
  private gpuContext: WebGL2RenderingContext | null = null;
  private failed = false;
  private images = new ImageRegistry(1);
  private readonly dashes = new DashRegistry();
  private draws = new Map<SceneItem, ItemDraw>();
  private sequence: ItemDraw[] = [];
  private sequenceSceneItems: readonly SceneItem[] = [];
  private buffers: PrimBuffer[] = [];
  private structure = 0;
  private visible = new Uint8Array(1);
  private visibleVersion = 0;
  /** Per slot: an arrow shaft's trim for the current zoom (see `emitFlat`). */
  private trims = new Float32Array(8);
  private trimsVersion = 0;
  /** The reference frame arrow values were last computed for. */
  private arrowsFrame = -1;
  /** Cumulative mercator length along each arrow's curve. */
  private readonly curveLengths = new WeakMap<SceneItem, Float64Array>();
  private base: Pt | null = null;
  private frame: ReferenceFrame | null = null;
  private frameCounter = 0;
  private readonly labelBuffer = new PrimBuffer(64);
  private labelKey = "";
  private readonly draftBuffer = new PrimBuffer(64);
  private draftKey = "";
  private draftVersion = 0;
  /** Bumped when the camera comes to rest: text is rasterised again at its exact sub-pixel place. */
  private restEpoch = 0;
  /**
   * False while the camera moves: text then uses one rasterisation per label,
   * snapped to whole pixels, instead of a new one for every sub-pixel place.
   */
  private atRest = true;
  /** The sub-pixel phase each feature's text was last rasterised at. */
  private readonly phases = new Map<string, Pt>();
  /** What the last label placement was computed from, when it cannot depend on the pan. */
  private placedInputs = "";
  /** Where the map's top-left corner is in the reference frame's coordinates, this frame. */
  private shift: Pt = { x: 0, y: 0 };

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

    this.owner = new FeatureLayerOwner(map, {
      attach: (gl) => this.attachContext(gl),
      detach: () => undefined,
      draw: (gl) => this.drawLayer(gl),
      contextLost: () => {
        this.gpu = null;
        this.gpuContext = null;
      },
    });

    /*
     * While the camera moves text is snapped to whole pixels; once it has
     * been still for a moment it is rasterised again at its exact place.
     * `moveend` alone is not rest: every `jumpTo` ends a move.
     */
    let restTimer = 0;
    const onMove = () => {
      this.atRest = false;
      window.clearTimeout(restTimer);
    };
    const onMoveEnd = () => {
      window.clearTimeout(restTimer);
      restTimer = window.setTimeout(() => {
        if (this.destroyed || map.isMoving()) return;
        this.atRest = true;
        this.restEpoch++;
        this.requestPaint();
      }, REST_MS);
    };
    map.on("move", onMove);
    map.on("moveend", onMoveEnd);
    this.disposers.push(() => {
      window.clearTimeout(restTimer);
      map.off("move", onMove);
      map.off("moveend", onMoveEnd);
    });

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
    this.draftVersion++;
    this.requestPaint();
  }

  setSettings(settings: MapSettings): void {
    if (settings === this.settings) return;
    this.settings = settings;
    this.settingsVersion++;
    this.sceneDirty = true;
    this.draft = null;
    this.draftVersion++;
    this.requestPaint();
  }

  setTheme(theme: ThemeMode): void {
    this.theme = theme;
    this.refreshPalette();
  }

  /**
   * Cheap enough to call every animation frame: one numeric comparison per
   * feature, and a repaint only when some feature's visibility flips. A flip
   * costs one small texture upload; geometry is untouched.
   */
  setTimeWindow(window: { from: string | null; to: string } | null): void {
    this.window = toTimeWindow(window);
    if (this.sceneDirty) {
      this.requestPaint();
      return;
    }
    if (this.scene.applyWindow(this.window)) {
      this.labelEpoch++;
      this.refreshVisibility();
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
   * Stops drawing while something covers the map (a full-screen preview):
   * the layer does no GPU work at all. Draws once on resume. Queries,
   * hit-testing and `paintInto` keep working.
   */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!paused) this.requestPaint();
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

  /** True when a note is shown as its anchor dot only, on a phone-sized reader map. */
  isAnnotationCollapsed(id: string): boolean {
    this.layout(this.view());
    return this.narrow?.isCollapsed(id) ?? false;
  }

  /** Ids of the drawn features under a point, topmost first. */
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
   * Draws every feature into a 2D context whose unit is one CSS pixel of
   * `view`, at `pixelRatio` device pixels per CSS pixel: an exported image.
   * The features are rendered by the same GPU program as the screen, in a
   * context of their own at the full ratio (in tiles when the image is larger
   * than the device allows), and composited onto `context`.
   */
  paintInto(context: CanvasRenderingContext2D, view: View, pixelRatio: number): void {
    const list = this.prepare(view, pixelRatio);
    const width = Math.max(1, Math.round(view.width * pixelRatio));
    const height = Math.max(1, Math.round(view.height * pixelRatio));
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("This browser cannot create a WebGL2 context for the image.");
    const limit = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array), 4096);
    canvas.width = Math.min(width, limit);
    canvas.height = Math.min(height, limit);
    /* A browser may give a smaller drawing buffer than asked for; tile by what it gave. */
    const tileWidth = gl.drawingBufferWidth;
    const tileHeight = gl.drawingBufferHeight;
    const gpu = new GpuScene(gl);
    try {
      const camera = cameraFor(view);
      const origin = view.project({ x: 0.5, y: 0.5 });
      const patternOrigin = { x: ((origin.x % TILE) + TILE) % TILE, y: ((origin.y % TILE) + TILE) % TILE };
      for (let y = 0; y < height; y += tileHeight) {
        for (let x = 0; x < width; x += tileWidth) {
          const w = Math.min(tileWidth, width - x);
          const h = Math.min(tileHeight, height - y);
          gl.viewport(0, 0, w, h);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gpu.draw(list, { camera, base: this.base ?? camera.origin, pixelRatio, viewport: { width: w, height: h }, tile: { x, y }, patternOrigin }, "none");
          /* The GL image's bottom-left is the tile's top-left row once flipped by the canvas. */
          context.drawImage(canvas, 0, tileHeight - h, w, h, x / pixelRatio, y / pixelRatio, w / pixelRatio, h / pixelRatio);
        }
      }
    } finally {
      gpu.dispose();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const dispose of this.disposers) dispose();
    this.owner?.destroy();
    this.gpu?.dispose();
    this.gpu = null;
    this.paletteListeners.clear();
  }

  /* ----------------------------------------------------------- layer hooks */

  private attachContext(gl: WebGL2RenderingContext): void {
    if (this.gpu && this.gpuContext === gl && !gl.isContextLost()) return;
    this.gpu = null;
    this.gpuContext = gl;
    if (this.failed) return;
    try {
      this.gpu = new GpuScene(gl);
    } catch (error) {
      this.failed = true;
      console.error("The feature layer could not be created; features are not drawn.", error);
    }
  }

  private drawLayer(gl: WebGL2RenderingContext): void {
    if (this.destroyed || this.paused) return;
    if (!this.gpu || this.gpuContext !== gl) this.attachContext(gl);
    const gpu = this.gpu;
    if (!gpu) return;
    const view = this.view();
    if (view.width <= 0 || view.height <= 0) return;
    const pixelRatio = this.map.getPixelRatio();
    const list = this.prepare(view, pixelRatio);
    const origin = view.project({ x: 0.5, y: 0.5 });
    gpu.draw(list, {
      camera: cameraFor(view),
      base: this.base ?? view.origin,
      pixelRatio: gl.drawingBufferWidth / view.width,
      viewport: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      tile: { x: 0, y: 0 },
      patternOrigin: { x: ((origin.x % TILE) + TILE) % TILE, y: ((origin.y % TILE) + TILE) % TILE },
    }, "untracked", IMAGE_BUDGET_MS);
    /* Text left for later frames: draw again until it is all there. */
    if (gpu.pending) this.requestPaint();
  }

  /* ---------------------------------------------------------------- private */

  private requestPaint(): void {
    if (this.owner && !this.destroyed && !this.paused) this.map.triggerRepaint();
  }

  private refreshPalette(): void {
    if (this.destroyed) return;
    const next = readPalette(this.map.getContainer(), this.theme);
    if (next.key === this.palette.key) return;
    this.palette = next;
    this.sceneDirty = true;
    this.draft = null;
    this.draftVersion++;
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
    if (epoch !== this.sceneEpoch) {
      /* Colours or typefaces changed: every rasterised image and every primitive is stale. */
      this.sceneEpoch = epoch;
      this.images = new ImageRegistry(this.images.pixelRatio);
      this.phases.clear();
      this.draws.clear();
      this.frame = null;
      this.labelKey = "";
      this.placedInputs = "";
      this.draftKey = "";
    }
  }

  /**
   * Everything drawn in this view, in draw order, with each label in the
   * place de-confliction gave it. Hit-testing and outlining read shapes
   * through here, so a click lands on a label where it is drawn and never on
   * one that was dropped. Built on demand, not every frame.
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
    this.labels.apply(entries, this.labelKeyFor(view), this.priority);
    this.laidOut = drawn;
    this.laidOutKey = key;
    return drawn;
  }

  private labelKeyFor(view: View): string {
    return `${labelBucket(view.zoom, view.bearing, view.pitch)}|${this.labelEpoch}|${view.width}x${view.height}`;
  }

  private shapeFor(item: SceneItem, view: View): ScreenShape {
    if (item.shape === null || item.shapeKey !== view.key) {
      item.shape = buildShape(item, view);
      item.shapeKey = view.key;
    }
    return item.shape;
  }

  /* ------------------------------------------------------------- GPU lists */

  /** `shift` is where the map's top-left corner is in the coordinates of the shapes being emitted. */
  private emitContext(project: (p: Pt) => Pt | null, shift: Pt = { x: 0, y: 0 }): EmitContext {
    const pr = this.images.pixelRatio;
    return {
      palette: this.palette,
      images: this.images,
      dashes: this.dashes,
      project,
      textPhase: (screen, id) => {
        /* Moving, a label keeps the rasterisation it has; at rest it gets one for its exact place. */
        const kept = this.atRest ? undefined : this.phases.get(id);
        if (kept) return kept;
        const phase = this.atRest ? phaseOf({ x: (screen.x - shift.x) * pr, y: (screen.y - shift.y) * pr }) : { x: 0, y: 0 };
        this.phases.set(id, phase);
        return phase;
      },
    };
  }

  /** Everything the GPU needs for one view: buffers in draw order, built or rebuilt where stale. */
  private prepare(view: View, pixelRatio: number): DrawList {
    this.ensureScene();
    /* Every rest re-rasterises text at new phases; past this many images, start the registry again. */
    if (this.images.pixelRatio !== pixelRatio || this.images.entries.length > MAX_IMAGES) {
      this.images = new ImageRegistry(pixelRatio);
      this.phases.clear();
      this.draws.clear();
      this.frame = null;
      this.labelKey = "";
      this.placedInputs = "";
      this.draftKey = "";
    }
    const camera = cameraFor(view);
    if (!this.base || Math.hypot(camera.origin.x - this.base.x, camera.origin.y - this.base.y) * view.scale > REBASE_PX) {
      this.base = { ...camera.origin };
      for (const buffer of this.buffers) buffer.rebase(this.base);
      for (const draw of this.draws.values()) {
        draw.fixed?.rebase(this.base);
        draw.moving?.rebase(this.base);
      }
    }
    this.syncSequence();
    this.syncFrame(view, camera);
    this.syncDraft(view, camera);
    return {
      structure: this.structure,
      buffers: this.buffers,
      images: this.images,
      dashes: this.dashes,
      visible: this.visible,
      visibleVersion: this.visibleVersion,
      features: this.trims,
      featuresVersion: this.trimsVersion,
    };
  }

  /** Builds the fixed primitives of new items and lays the buffers out in draw order. */
  private syncSequence(): void {
    const base = this.base ?? { x: 0, y: 0 };
    const items = this.scene.items;
    if (items === this.sequenceSceneItems && this.sequence.every((draw) => this.draws.get(draw.item) === draw)) return;
    this.sequenceSceneItems = items;
    const next = new Map<SceneItem, ItemDraw>();
    const sequence: ItemDraw[] = [];
    for (const item of items) {
      if (item.hidden) continue;
      let draw = this.draws.get(item);
      if (!draw) {
        draw = { item, slot: sequence.length, fixed: null, moving: null, movingFrame: -1, noteKey: "" };
        const fixed = new PrimBuffer();
        fixed.reset(base);
        fixed.slot = draw.slot;
        fixed.wrapRef = (item.box.minX + item.box.maxX) / 2;
        emitStatic(fixed, item, this.emitContext(() => null));
        if (fixed.count > 0) draw.fixed = fixed;
        if (isViewDependent(item)) {
          draw.moving = new PrimBuffer();
          draw.moving.reset(base);
        }
      }
      const slot = sequence.length;
      if (draw.slot !== slot) {
        draw.slot = slot;
        draw.fixed?.setSlot(slot);
        draw.moving?.setSlot(slot);
        /* Its per-slot values live at the old slot; compute them again. */
        draw.movingFrame = -1;
        this.arrowsFrame = -1;
      }
      next.set(item, draw);
      sequence.push(draw);
    }
    this.draws = next;
    this.sequence = sequence;
    /* New items (a drag replaces one per pointer move) need their arrow values; all are cheap to recompute. */
    this.arrowsFrame = -1;
    /* Room for every label, so labels a zoom reveals never force the instance buffer to be laid out again. */
    this.labelBuffer.reserve = sequence.reduce((count, draw) => count + (draw.item.text && draw.item.feature.kind !== "annotation" ? 1 : 0), 0);
    if (this.frame) for (const item of this.frame.shapes.keys()) if (!next.has(item)) this.frame.shapes.delete(item);
    this.labelKey = "";
    this.placedInputs = "";
    const buffers: PrimBuffer[] = [];
    for (const draw of sequence) {
      if (draw.fixed) buffers.push(draw.fixed);
      if (draw.moving) buffers.push(draw.moving);
    }
    buffers.push(this.labelBuffer, this.draftBuffer);
    if (buffers.length !== this.buffers.length || buffers.some((buffer, index) => buffer !== this.buffers[index])) {
      this.buffers = buffers;
      this.structure++;
    }
    this.labelBuffer.setSlot(sequence.length);
    this.draftBuffer.setSlot(sequence.length);
    this.refreshVisibility();
  }

  private refreshVisibility(): void {
    const length = this.sequence.length + 1;
    if (this.visible.length !== length) this.visible = new Uint8Array(length);
    if (this.trims.length !== length * 8) {
      this.trims = new Float32Array(length * 8);
      this.trimsVersion++;
      for (const draw of this.sequence) draw.movingFrame = -1;
      this.arrowsFrame = -1;
    }
    this.sequence.forEach((draw, index) => (this.visible[index] = draw.item.inWindow ? 255 : 0));
    this.visible[this.sequence.length] = 255;
    this.visibleVersion++;
  }

  /**
   * Whether the frame needs this item's screen shape: everything that takes
   * part in label placement, wherever it is (as the 2D renderer placed labels
   * over the whole map), and, while pitched, arrows and front lines, whose
   * geometry is then built from it.
   */
  private needsShape(item: SceneItem, window: Box | null): boolean {
    const kind = item.feature.kind;
    if (kind === "annotation" || kind === "point" || item.text !== null) return true;
    /* Without pitch their geometry is built without a screen shape (see `buildMoving`). */
    return (kind === "arrow" || kind === "frontline") && window === null;
  }

  /**
   * Keeps the reference frame current, rebuilds view-dependent primitives for
   * it, and places labels for this exact view (furniture and the reader's
   * frame are fixed to the screen, so that part runs every frame, cheaply).
   */
  private syncFrame(view: View, camera: GlCamera): void {
    const pitched = view.pitch !== 0;
    const linearKey = pitched ? view.key : `${view.width}x${view.height}|${view.zoom}|${view.bearing}`;
    let frame = this.frame;
    let shift: Pt = { x: 0, y: 0 };
    if (frame && frame.linearKey === linearKey && !pitched) {
      const now = view.project(frame.view.origin);
      const dx = now.x - frame.anchor.x;
      const dy = now.y - frame.anchor.y;
      if (Math.abs(dx) > view.width * PAN_MARGIN || Math.abs(dy) > view.height * PAN_MARGIN) frame = null;
      else shift = { x: -dx, y: -dy };
    } else frame = null;

    if (!frame) {
      const window: Box | undefined = pitched ? undefined : { minX: -view.width, minY: -view.height, maxX: view.width * 2, maxY: view.height * 2 };
      const shapes = new Map<SceneItem, ScreenShape>();
      frame = { id: ++this.frameCounter, linearKey, view, camera, anchor: view.project(view.origin), shapes, reach: null };
      frame.reach = pitched ? null : this.frameWindow(frame);
      for (const draw of this.sequence) if (this.needsShape(draw.item, frame.reach)) shapes.set(draw.item, buildShape(draw.item, view, window));
      this.frame = frame;
      this.labelKey = "";
      this.placedInputs = "";
    } else {
      /* Items that arrived since the frame was built (a drag replaces one per pointer move). */
      const window: Box | undefined = pitched ? undefined : { minX: -view.width, minY: -view.height, maxX: view.width * 2, maxY: view.height * 2 };
      for (const draw of this.sequence) {
        if (!frame.shapes.has(draw.item) && this.needsShape(draw.item, frame.reach)) frame.shapes.set(draw.item, buildShape(draw.item, frame.view, window));
      }
    }

    this.shift = shift;
    /*
     * Only what lies within the frame's window is rebuilt: anything further
     * away is not on screen, and gets rebuilt by the frame that brings it near.
     */
    const current = frame;
    const reach = current.reach;
    if (reach && this.arrowsFrame !== current.id) {
      this.arrowsFrame = current.id;
      const h = current.camera.h;
      const scale = Math.hypot(h[0]!, h[3]!);
      for (const draw of this.sequence) if (draw.item.feature.kind === "arrow") this.arrowValues(draw, scale);
      this.trimsVersion++;
    }
    for (const draw of this.sequence) {
      if (!draw.moving || draw.movingFrame === current.id) continue;
      /* Without pitch only arrow heads and notes depend on the view; the rest is drawn by the static part. */
      const { feature } = draw.item;
      if (reach && !(feature.kind === "arrow" && feature.tapered) && feature.kind !== "annotation") continue;
      if (reach && !boxesOverlap(reach, draw.item.box) && !this.nearAcrossWorlds(reach, draw.item.box)) continue;
      this.buildMoving(draw, current);
    }
    this.placeText(current, shift);
  }

  /** The mercator box the frame's view-dependent geometry must be right in: the view and one view beyond each edge. */
  private frameWindow(frame: ReferenceFrame): Box {
    const { view } = frame;
    const corners = [
      { x: -view.width, y: -view.height },
      { x: view.width * 2, y: -view.height },
      { x: view.width * 2, y: view.height * 2 },
      { x: -view.width, y: view.height * 2 },
    ].map((p) => view.unproject(p));
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of corners) {
      box.minX = Math.min(box.minX, p.x);
      box.minY = Math.min(box.minY, p.y);
      box.maxX = Math.max(box.maxX, p.x);
      box.maxY = Math.max(box.maxY, p.y);
    }
    return box;
  }

  /** The window can straddle the antimeridian; compare against the neighbouring world copies too. */
  private nearAcrossWorlds(window: Box, box: Box): boolean {
    const shifted = (by: number) => ({ minX: box.minX + by, minY: box.minY, maxX: box.maxX + by, maxY: box.maxY });
    return boxesOverlap(window, shifted(1)) || boxesOverlap(window, shifted(-1));
  }

  private toMerc(frame: ReferenceFrame): (p: Pt) => Pt {
    return (p) => unprojectWith(frame.camera, p) ?? { x: NaN, y: NaN };
  }

  private buildMoving(draw: ItemDraw, frame: ReferenceFrame): void {
    const buffer = draw.moving;
    if (!buffer) return;
    const { item } = draw;
    buffer.reset(this.base ?? frame.camera.origin);
    buffer.slot = draw.slot;
    const wrap = worldWrap(item, frame.view);
    const centre = (item.box.minX + item.box.maxX) / 2;
    const geometric = item.geometry.kind === "area" || item.geometry.kind === "line";
    /* Mercator geometry draws at its nearest copy by itself; geometry carried back from the screen is already there. */
    buffer.wrapRef = geometric ? centre : centre + wrap;
    const project = geometric ? (p: Pt) => projectWith(frame.camera, { x: p.x + wrap, y: p.y }) : (p: Pt) => projectWith(frame.camera, p);
    if (frame.reach === null) {
      /* Pitched: everything view-dependent from screen shapes, as the 2D renderer built it (R.1). */
      buffer.mode = PrimMode.Pitched;
      emitView(buffer, item, frame.shapes.get(item) ?? null, this.toMerc(frame), this.emitContext(project, this.shift));
    } else if (item.geometry.kind === "arrow") {
      this.emitFlat(buffer, draw, frame, wrap);
    } else if (item.geometry.kind === "annotation") {
      emitView(buffer, item, frame.shapes.get(item) ?? null, this.toMerc(frame), this.emitContext(project, this.shift), true);
    }
    const shape = frame.shapes.get(item) ?? null;
    draw.movingFrame = frame.id;
    draw.noteKey = shape?.kind === "annotation" ? this.noteKey(shape) : "";
  }

  /**
   * Arrows and front lines without pitch. The map is then a similarity of
   * mercator (a scale and a turn), and heads, tapers, dash phases and teeth
   * are defined in screen pixels in ways a turn does not change, so they are
   * built by the same functions in mercator scaled to this zoom's pixels and
   * left unturned: the same shapes, without projecting every point to the
   * screen and back.
   */
  private emitFlat(buffer: PrimBuffer, draw: ItemDraw, frame: ReferenceFrame, wrap: number): void {
    const { item } = draw;
    const { feature, geometry, style } = item;
    if (geometry.kind !== "arrow" || feature.kind !== "arrow") return;
    const h = frame.camera.h;
    const scale = Math.hypot(h[0]!, h[3]!);
    const origin = frame.view.origin;
    const toPx = (p: Pt): Pt => ({ x: (p.x + wrap - origin.x) * scale, y: (p.y - origin.y) * scale });
    const fromPx = (p: Pt): Pt => ({ x: p.x / scale + origin.x, y: p.y / scale + origin.y });
    const context = this.emitContext((p) => ({ x: (p.x - origin.x) * scale, y: (p.y - origin.y) * scale }), this.shift);
    const curve = geometry.curve.map(toPx);
    const parts = arrowParts(curve, style.stroke?.width ?? 0, feature.head, feature.tapered, style.stroke?.dash ?? []);
    emitView(buffer, item, { kind: "arrow", ...parts, text: null, box: emptyBox() }, fromPx, context, true);
  }

  /**
   * An untapered arrow's values for this zoom, for the GPU: where the shaft
   * starts and stops along the curve, the head length, and the direction of
   * travel into each head, by the rules of `arrowParts` in shapes.ts. Done
   * from the curve's cumulative lengths (kept per item), so it costs a binary
   * search per arrow rather than a walk of the curve.
   */
  private arrowValues(draw: ItemDraw, scale: number): void {
    const { feature, geometry, style } = draw.item;
    if (feature.kind !== "arrow" || geometry.kind !== "arrow") return;
    const o = draw.slot * 8;
    if (o + 8 > this.trims.length) return;
    const curve = geometry.curve;
    let cumulative = this.curveLengths.get(draw.item);
    if (!cumulative) {
      cumulative = new Float64Array(curve.length);
      for (let index = 1; index < curve.length; index++) {
        const a = curve[index - 1]!;
        const b = curve[index]!;
        cumulative[index] = cumulative[index - 1]! + Math.hypot(b.x - a.x, b.y - a.y);
      }
      this.curveLengths.set(draw.item, cumulative);
    }
    const lengths = cumulative;
    const total = (lengths[curve.length - 1] ?? 0) * scale;
    const heads = feature.head === "double" ? 2 : feature.head === "single" ? 1 : 0;
    const width = style.stroke?.width ?? 0;
    const length = heads > 0 ? Math.min(Math.max(10, Math.min(44, width * 3.2 + 4)), total / (heads + 0.6)) : 0;
    const cut = Math.max(0, length - 1);
    /* The direction from the point `along` pixels into the curve to `towards`, a tip. */
    const directionTo = (along: number, towards: Pt, backwards: boolean): Pt => {
      const target = along / scale;
      let low = 0;
      let high = curve.length - 1;
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (lengths[middle]! <= target) low = middle;
        else high = middle;
      }
      const a = curve[low]!;
      const b = curve[high] ?? a;
      const span = lengths[high]! - lengths[low]!;
      const t = span > 0 ? Math.min(1, Math.max(0, (target - lengths[low]!) / span)) : 0;
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const dx = towards.x - at.x;
      const dy = towards.y - at.y;
      const d = Math.hypot(dx, dy);
      if (d > 0) return { x: dx / d, y: dy / d };
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const s = Math.hypot(sx, sy) || 1;
      return backwards ? { x: -sx / s, y: -sy / s } : { x: sx / s, y: sy / s };
    };
    const tip = curve[curve.length - 1] ?? { x: 0, y: 0 };
    const tail = curve[0] ?? tip;
    const end = heads >= 1 ? total - cut : total;
    const start = heads === 2 ? cut : 0;
    const intoEnd = directionTo(end, tip, false);
    const intoTail = directionTo(start, tail, true);
    this.trims.set([start, end, length, 0, intoEnd.x, intoEnd.y, intoTail.x, intoTail.y], o);
  }

  private noteKey(shape: Extract<ScreenShape, { kind: "annotation" }>): string {
    return `${this.restEpoch}|${key(shape.text?.centre)}|${shape.leader?.map(key).join(";") ?? ""}|${shape.dot}`;
  }

  /** Runs the reader's note rules and label placement for this view, and rebuilds what moved. */
  private placeText(frame: ReferenceFrame, shift: Pt): void {
    const { view } = frame;
    /* Without furniture or the reader's frame rules nothing here depends on the pan, only on what the key names. */
    const fixedToScreen = this.obstacles.length > 0 || this.narrow !== null;
    const inputs = `${frame.id}|${this.labelKeyFor(view)}|${this.restEpoch}|${this.structure}|${this.visibleVersion}|${this.images.pixelRatio}`;
    if (!fixedToScreen && inputs === this.placedInputs) return;
    this.placedInputs = inputs;
    const drawn: Drawn[] = [];
    const entries: LabelEntry[] = [];
    for (const draw of this.sequence) {
      const { item } = draw;
      if (!item.inWindow) continue;
      const shape = frame.shapes.get(item);
      if (!shape) continue;
      drawn.push({ item, shape });
      entries.push({ id: item.feature.id, shape, block: item.text, strokeWidth: item.style.stroke?.width ?? 0 });
    }
    for (const entry of drawn) {
      if (entry.shape.kind !== "annotation" || this.narrow) continue;
      const draw = this.draws.get(entry.item);
      if (draw && draw.noteKey !== this.noteKey(entry.shape)) this.buildMoving(draw, frame);
    }
    if (this.narrow) {
      const obstacles = this.obstacles.map((box) => ({ minX: box.minX + shift.x, minY: box.minY + shift.y, maxX: box.maxX + shift.x, maxY: box.maxY + shift.y }));
      this.narrow.apply(drawn, view, obstacles, { minX: shift.x, minY: shift.y, maxX: shift.x + view.width, maxY: shift.y + view.height });
      for (const entry of drawn) {
        if (entry.shape.kind !== "annotation") continue;
        const draw = this.draws.get(entry.item);
        if (draw && draw.noteKey !== this.noteKey(entry.shape)) this.buildMoving(draw, frame);
      }
    }
    this.labels.apply(entries, this.labelKeyFor(view), this.priority, shift);

    const placed: { draw: ItemDraw; shape: ScreenShape }[] = [];
    let signature = `${frame.id}|${this.images.pixelRatio}|${this.restEpoch}`;
    for (const entry of entries) {
      const { shape } = entry;
      if (shape.kind === "annotation" || !entry.block || shape.labelHidden || !shape.text) continue;
      const itemDraw = this.drawFor(entry.id);
      if (!itemDraw) continue;
      placed.push({ draw: itemDraw, shape });
      signature += `|${entry.id}:${key(shape.text.centre)}`;
    }
    if (signature === this.labelKey) return;
    this.labelKey = signature;
    const buffer = this.labelBuffer;
    buffer.reset(this.base ?? frame.camera.origin);
    const toMerc = this.toMerc(frame);
    const context = this.emitContext(() => null, shift);
    for (const { draw, shape } of placed) {
      if (!shape.text) continue;
      buffer.slot = draw.slot;
      buffer.wrapRef = (draw.item.box.minX + draw.item.box.maxX) / 2 + worldWrap(draw.item, view);
      buffer.image(toMerc(shape.text.centre), textImage(shape.text.block, shape.text.centre, draw.item.feature.id, context));
    }
  }

  private drawFor(id: string): ItemDraw | undefined {
    const item = this.scene.get(id);
    return item ? this.draws.get(item) : undefined;
  }

  /** The shape being drawn, rebuilt whenever it or the view changes. */
  private syncDraft(view: View, camera: GlCamera): void {
    const draftKey = this.draftFeature ? `${this.draftVersion}|${view.key}|${this.sceneEpoch}` : "";
    if (draftKey === this.draftKey) return;
    this.draftKey = draftKey;
    const buffer = this.draftBuffer;
    buffer.reset(this.base ?? camera.origin);
    buffer.slot = this.sequence.length;
    if (!this.draftFeature) return;
    this.draft ??= buildSceneItem(this.draftFeature, this.settings, this.palette);
    const shape = buildShape(this.draft, view);
    buffer.wrapRef = (this.draft.box.minX + this.draft.box.maxX) / 2 + worldWrap(this.draft, view);
    emitWhole(buffer, this.draft, shape, (p) => unprojectWith(camera, p) ?? { x: NaN, y: NaN }, this.emitContext((p) => projectWith(camera, p)));
  }
}
