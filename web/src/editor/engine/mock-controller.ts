import type {
  ControllerCapabilities,
  ControllerEvents,
  ControllerOptions,
  EditorController,
  ExportImageOptions,
  ToolId,
} from "@/editor/controller";
import type { LngLat, Viewport } from "@/model/types";
import { lngLatToMerc, mercToLngLat, metresPerPixel } from "@/render/geo";
import { Emitter } from "./emitter";

/**
 * A controller with no map and no WebGL context. It records every call,
 * emits events when told to, and shows a static placeholder, so screens that
 * only need "a map is here" (the state gallery, with dozens on one page) do
 * not run into the browser's limit on live WebGL contexts.
 */
export interface MockController extends EditorController {
  /** Every call made on the controller, oldest first. */
  readonly calls: readonly { method: string; args: readonly unknown[] }[];
  /** Fire an event as if the user had acted on the map. */
  emit<K extends keyof ControllerEvents>(event: K, ...args: Parameters<ControllerEvents[K]>): void;
}

const CAPABILITIES: ControllerCapabilities = {
  vertexEditing: true,
  snapping: true,
  fillPatterns: true,
  freeDrawOrder: true,
  timeFilter: true,
  imageExport: true,
  touch: true,
};

export function createMockController(options: ControllerOptions): MockController {
  const events = new Emitter<ControllerEvents>();
  const calls: { method: string; args: readonly unknown[] }[] = [];
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
  };

  let viewport: Viewport = options.viewport;
  let tool: ToolId = "select";
  let featureCount = options.features.length;

  const placeholder = document.createElement("div");
  placeholder.className = "absolute inset-0 grid place-items-center bg-well font-ui text-sm text-ink-3";
  const caption = document.createElement("span");
  placeholder.appendChild(caption);
  const describe = () => {
    caption.textContent = `Map placeholder · ${featureCount} features · zoom ${viewport.zoom.toFixed(1)}`;
  };
  describe();
  options.container.appendChild(placeholder);

  const scale = () => 512 * 2 ** viewport.zoom;
  const size = () => ({ width: options.container.clientWidth, height: options.container.clientHeight });

  const ready = Promise.resolve().then(() => events.emit("ready"));

  return {
    capabilities: CAPABILITIES,
    calls,
    emit: (event, ...args) => events.emit(event, ...args),
    whenReady: () => ready,
    destroy() {
      record("destroy");
      placeholder.remove();
      events.clear();
    },
    on: (event, handler) => events.on(event, handler),
    setFeatures(features) {
      record("setFeatures", features);
      featureCount = features.length;
      describe();
    },
    setSettings: (settings) => record("setSettings", settings),
    setTheme: (theme) => record("setTheme", theme),
    setDir: (dir) => record("setDir", dir),
    setDocument: (document) => record("setDocument", document),
    setTool(next) {
      record("setTool", next);
      tool = next;
    },
    getTool: () => tool,
    cancel: () => record("cancel"),
    finish: () => record("finish"),
    setDrawDefaults: (defaults) => record("setDrawDefaults", defaults),
    setSelection: (ids) => record("setSelection", ids),
    setReshaping: (id) => record("setReshaping", id),
    setSnapping: (enabled) => record("setSnapping", enabled),
    setTimeFilter: (window) => record("setTimeFilter", window),
    getViewport: () => viewport,
    panBy: (x, y) => record("panBy", x, y),
    setToolLocked: (locked) => record("setToolLocked", locked),
    setPenMode: (mode) => record("setPenMode", mode),
    startMove: () => {
      record("startMove");
      return false;
    },
    addAt: (kind, at) => record("addAt", kind, at),
    setCrosshair: (on) => record("setCrosshair", on),
    placeAtCrosshair: () => record("placeAtCrosshair"),
    undoPoint: () => false,
    redoPoint: () => false,
    reopenable: () => null,
    reopen: () => record("reopen"),
    setViewport(next, viewOptions) {
      record("setViewport", next, viewOptions);
      viewport = { ...viewport, ...next };
      describe();
      events.emit("viewport", viewport);
    },
    fitFeatures: (ids) => record("fitFeatures", ids),
    fitBounds: (bounds) => record("fitBounds", bounds),
    setInsets: (insets) => record("setInsets", insets),
    setRendering: (enabled) => record("setRendering", enabled),
    setLabelObstacles: (boxes) => record("setLabelObstacles", boxes),
    setBasemap: (basemap) => record("setBasemap", basemap),
    project(at: LngLat) {
      const centre = lngLatToMerc(viewport.center);
      const point = lngLatToMerc(at);
      const { width, height } = size();
      return { x: width / 2 + (point.x - centre.x) * scale(), y: height / 2 + (point.y - centre.y) * scale() };
    },
    unproject(point) {
      const centre = lngLatToMerc(viewport.center);
      const { width, height } = size();
      return mercToLngLat({ x: centre.x + (point.x - width / 2) / scale(), y: centre.y + (point.y - height / 2) / scale() });
    },
    getResolution: () => metresPerPixel(viewport.center[1], viewport.zoom),
    exportImage(exportOptions: ExportImageOptions) {
      record("exportImage", exportOptions);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(exportOptions.width * exportOptions.pixelRatio));
      canvas.height = Math.max(1, Math.round(exportOptions.height * exportOptions.pixelRatio));
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The placeholder image could not be encoded."))), "image/png");
      });
    },
  };
}
