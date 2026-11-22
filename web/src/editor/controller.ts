import type {
  BasemapStyleId,
  FeatureKind,
  LabelLanguage,
  LngLat,
  MapFeature,
  MapSettings,
  RichText,
  Viewport,
} from "@/model/types";

/**
 * The seam between the editor's React interface and whatever draws and edits
 * the map. The interface speaks only in the domain model: no GeoJSON, no
 * drawing-library ids, no mode names. Two implementations can sit behind it:
 * the MapLibre one in `src/editor/engine`, or the existing livemap engine.
 *
 * Rules the interface relies on:
 * - The controller never owns the document. It is handed features and
 *   settings, and reports what the user did; the document store above it
 *   decides what to keep, and owns undo, saving and selection history.
 * - A gesture (dragging a vertex, an arrow's control point, a label) reports
 *   `gesture: "update"` continuously and `gesture: "commit"` once, so the
 *   store can record one undo step per gesture.
 */

export type ToolId = "select" | FeatureKind;

export type ThemeMode = "light" | "dark";

export interface ControllerOptions {
  container: HTMLElement;
  viewport: Viewport;
  settings: MapSettings;
  features: MapFeature[];
  /** The map's title, drawn in the title block of an exported image. */
  title?: RichText;
  theme: ThemeMode;
  /** Direction of on-map furniture the controller draws (handles, readouts). */
  dir: "ltr" | "rtl";
  /** false renders exactly like the editor but accepts no input (preview, embed, diff). */
  interactive: boolean;
}

export interface FeatureChange {
  /** Features created or replaced, whole. */
  put: MapFeature[];
  /** Ids removed. */
  delete: string[];
  gesture: "update" | "commit";
}

export interface DrawProgress {
  tool: ToolId;
  /** Points placed so far in the shape being drawn. */
  points: number;
  /** Length of the line so far, in metres, when the tool draws a path. */
  lengthMetres: number | null;
  /** Area so far, in square metres, when the tool draws a closed shape. */
  areaSquareMetres: number | null;
  /** Enough points are placed for `finish()` to produce a shape; drives a Finish control on touch. */
  canFinish: boolean;
}

export interface PointerInfo {
  at: LngLat | null;
  /** The feature under the pointer, topmost first. */
  hitIds: string[];
}

export interface ControllerEvents {
  /** The map and its first style are ready; calls made earlier were queued. */
  ready: () => void;
  /** The user created, reshaped, moved or deleted features on the map. */
  change: (change: FeatureChange) => void;
  /** The user clicked or box-selected on the map. */
  select: (ids: string[], mode: "replace" | "add" | "toggle") => void;
  /** The active tool changed from inside the controller (e.g. Escape while drawing). */
  tool: (tool: ToolId) => void;
  /**
   * The feature being reshaped changed from inside the controller: a
   * double-click on a feature starts reshaping it, Escape ends it.
   */
  reshape: (id: string | null) => void;
  draw: (progress: DrawProgress | null) => void;
  pointer: (info: PointerInfo) => void;
  viewport: (viewport: Viewport) => void;
  /** Something failed that the user should hear about (tiles, an unusable shape). */
  problem: (problem: { code: "tiles_failed" | "shape_rejected" | "context_lost"; detail: string }) => void;
}

export interface ExportImageOptions {
  /** Output size in CSS pixels. */
  width: number;
  height: number;
  /** 1 or 2 */
  pixelRatio: number;
  /** Composite the title block, legend, credit and basemap attribution. */
  furniture: boolean;
  /** Defaults to the controller's current theme. */
  theme?: ThemeMode;
}

/**
 * Map space covered by interface laid over or beside it, in CSS pixels:
 * panes, the tool dock, the timeline. `start` and `end` follow the editor's direction.
 */
/** A rectangle on screen, in CSS pixels from the map's top-left corner. */
export interface ScreenBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapInsets {
  top: number;
  bottom: number;
  start: number;
  end: number;
}

/** What an implementation can do, so the interface can hide what it cannot. */
export interface ControllerCapabilities {
  vertexEditing: boolean;
  snapping: boolean;
  fillPatterns: boolean;
  freeDrawOrder: boolean;
  timeFilter: boolean;
  imageExport: boolean;
  touch: boolean;
}

export interface EditorController {
  readonly capabilities: ControllerCapabilities;

  /** Resolves when the map can be drawn on. */
  whenReady(): Promise<void>;
  destroy(): void;

  on<K extends keyof ControllerEvents>(event: K, handler: ControllerEvents[K]): () => void;

  /* ---- document in ---- */
  /** Replace everything drawn. Called on load, undo, redo and remote reload. */
  setFeatures(features: MapFeature[]): void;
  /** Presets, groups (hidden and locked), basemap, legend and the rest. */
  setSettings(settings: MapSettings): void;
  setTheme(theme: ThemeMode): void;
  setDir(dir: "ltr" | "rtl"): void;
  /** Parts of the map document that are not settings but are drawn: the title on an exported image. */
  setDocument(document: { title: RichText }): void;

  /* ---- interaction ---- */
  setTool(tool: ToolId): void;
  getTool(): ToolId;
  /** Abandon the shape being drawn or the gesture in progress. */
  cancel(): void;
  /** Finish the shape being drawn, as Enter does. */
  finish(): void;
  /** Style applied to the next shape the active tool creates. */
  setDrawDefaults(defaults: Partial<MapFeature>): void;
  setSelection(ids: string[]): void;
  /** Show vertex handles for one feature so it can be reshaped. */
  setReshaping(id: string | null): void;
  setSnapping(enabled: boolean): void;

  /* ---- time ---- */
  /** Show only features valid in this window; null shows everything. */
  setTimeFilter(window: { from: string | null; to: string } | null): void;

  /* ---- view ---- */
  getViewport(): Viewport;
  setViewport(viewport: Partial<Viewport>, options?: { animate?: boolean }): void;
  /** Move the view by a share of the map's size: x east, y south. The no-drag way to pan. */
  panBy(x: number, y: number): void;
  fitFeatures(ids?: string[]): void;
  fitBounds(bounds: [LngLat, LngLat]): void;
  /**
   * What the editor's panes, dock and timeline cover. `fitFeatures` and
   * `fitBounds` frame their target inside what is left, so nothing lands
   * under a pane. Does not move the camera by itself. Defaults to none.
   */
  setInsets(insets: MapInsets): void;
  /**
   * false while something covers the whole map (a full-screen preview): the
   * map stops animating and the overlays stop painting, so a hidden map costs
   * nothing per frame. true resumes, re-measures the container and paints
   * once. Calls made while paused (features, selection, viewport) are kept and
   * shown on resume. Defaults to true.
   */
  setRendering(enabled: boolean): void;
  /**
   * What the map's furniture (title block, key, credits) covers on screen.
   * Labels move to another place, or are left out, rather than sit under it.
   * Defaults to nothing.
   */
  setLabelObstacles(boxes: readonly ScreenBox[]): void;
  setBasemap(basemap: { styleId: BasemapStyleId; labelLanguage: LabelLanguage }): void;
  /** Screen position of a coordinate, for anchoring interface to the map. */
  project(at: LngLat): { x: number; y: number };
  unproject(point: { x: number; y: number }): LngLat;
  /** Metres per CSS pixel at the centre, for the scale readout. */
  getResolution(): number;

  /* ---- output ---- */
  exportImage(options: ExportImageOptions): Promise<Blob>;
}

/** How the app obtains a controller; the mock and the real one both provide this. */
export type EditorControllerFactory = (options: ControllerOptions) => EditorController;
