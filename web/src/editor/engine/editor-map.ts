import type { ControllerCapabilities, ControllerOptions, ThemeMode } from "@/editor/controller";
import { blankStyle } from "@/render/basemap";
import { createMap, type MapLibreMap } from "@/render/maplibre";
import { readPalette } from "@/render/palette";

/** What this engine can do, for the editor to read before offering a feature. */
export const CAPABILITIES: ControllerCapabilities = {
  vertexEditing: true,
  snapping: true,
  fillPatterns: true,
  freeDrawOrder: true,
  timeFilter: true,
  imageExport: true,
  touch: true,
};

/**
 * The editor's MapLibre map, on a plain ground until the basemap arrives.
 * Double-click finishes a shape and Shift-drag draws a selection box, so the
 * map gives both gestures up. Turning and tilting are off in every gesture:
 * a news map stays north-up, and bearing and pitch are set in Map settings.
 * MapLibre's own keys are off too; the controller routes the arrow keys
 * itself, so they can move a selection instead of the map.
 */
export function createEditorMap(options: ControllerOptions, theme: ThemeMode): MapLibreMap {
  const map = createMap({
    container: options.container,
    style: blankStyle(readPalette(options.container, theme)),
    center: options.viewport.center,
    zoom: options.viewport.zoom,
    bearing: options.viewport.bearing,
    pitch: options.viewport.pitch,
    interactive: options.interactive,
    attributionControl: false,
    doubleClickZoom: false,
    boxZoom: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    keyboard: false,
  });
  map.touchZoomRotate.disableRotation();
  return map;
}

/**
 * Stops the map drawing while something covers it. MapLibre has no pause of
 * its own; it redraws whenever its container changes size, so the container
 * is held at its current size and a window resize under the cover draws nothing.
 */
export function holdMap(map: MapLibreMap): void {
  map.stop();
  const container = map.getContainer();
  const { width, height } = container.getBoundingClientRect();
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
}

/** Lets the container follow its parent again and draws once at whatever size it now has. */
export function releaseMap(map: MapLibreMap): void {
  const container = map.getContainer();
  container.style.width = "";
  container.style.height = "";
  map.resize();
  map.triggerRepaint();
}
