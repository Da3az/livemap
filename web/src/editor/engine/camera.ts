import type { MapInsets } from "@/editor/controller";
import type { LngLat, Viewport } from "@/model/types";
import type { MapLibreMap } from "@/render/maplibre";

const FIT_PADDING = 56;
const FIT_MAX_ZOOM = 14;
/** Never let insets leave less than this much map to fit into. */
const MIN_FIT_SPAN = 120;
const MAX_EXPORT_CANVAS_SIDE = 8192;

export const NO_INSETS: MapInsets = { top: 0, bottom: 0, start: 0, end: 0 };

export function readViewport(map: MapLibreMap): Viewport {
  const centre = map.getCenter();
  return { center: [centre.lng, centre.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

export function moveTo(map: MapLibreMap, viewport: Partial<Viewport>, animate: boolean): void {
  /* Only the fields given: MapLibre treats a key that is present but undefined as a value. */
  const camera = Object.fromEntries(Object.entries(viewport).filter(([, value]) => value !== undefined));
  if (animate) map.easeTo(camera);
  else map.jumpTo(camera);
}

/** The smallest longitude/latitude box around some coordinates, or null for none. */
export function boundsOf(coordinates: readonly LngLat[]): [LngLat, LngLat] | null {
  const first = coordinates[0];
  if (!first) return null;
  let [west, south] = first;
  let [east, north] = first;
  for (const [lng, lat] of coordinates) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * Frames a box inside the part of the map the editor's panes leave free. The
 * insets are mapped from start/end to physical sides by direction. Under a
 * turned or tilted camera MapLibre fits the box's turned outline, so the
 * bearing and pitch are kept.
 */
export function fitInside(map: MapLibreMap, bounds: [LngLat, LngLat], insets: MapInsets, dir: "ltr" | "rtl"): void {
  const container = map.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight;
  const left = dir === "rtl" ? insets.end : insets.start;
  const right = dir === "rtl" ? insets.start : insets.end;
  /* Give up insets before the space to fit into collapses: a phone-sized map with a pane open still frames something. */
  const squeezeX = Math.min(1, Math.max(0, width - MIN_FIT_SPAN) / Math.max(1, left + right));
  const squeezeY = Math.min(1, Math.max(0, height - MIN_FIT_SPAN) / Math.max(1, insets.top + insets.bottom));
  const freeWidth = width - (left + right) * squeezeX;
  const freeHeight = height - (insets.top + insets.bottom) * squeezeY;
  const pad = Math.max(0, Math.min(FIT_PADDING, freeWidth / 4, freeHeight / 4));
  map.fitBounds(bounds, {
    padding: {
      top: insets.top * squeezeY + pad,
      bottom: insets.bottom * squeezeY + pad,
      left: left * squeezeX + pad,
      right: right * squeezeX + pad,
    },
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    maxZoom: FIT_MAX_ZOOM,
    duration: 250,
  });
}

/** The largest WebGL canvas side an exported image may use on this device. */
export function maxCanvasSide(map: MapLibreMap): number {
  const gl = map.getCanvas().getContext("webgl2");
  if (!gl) return 4096;
  return Math.min(MAX_EXPORT_CANVAS_SIDE, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
}

/**
 * Keeps what is on the map where it is on the page when the map's box
 * changes because a pane opened or closed beside it. MapLibre keeps the
 * centre on a resize, so a pane opening at one side used to slide every
 * feature by half the pane's width. A resize of the window itself keeps
 * MapLibre's own behaviour. Returns the disposer.
 */
export function holdContentOnResize(map: MapLibreMap): () => void {
  const container = map.getContainer();
  let box = container.getBoundingClientRect();
  let windowSize = { width: window.innerWidth, height: window.innerHeight };
  const onResize = () => {
    const next = container.getBoundingClientRect();
    const nextWindow = { width: window.innerWidth, height: window.innerHeight };
    const sameWindow = nextWindow.width === windowSize.width && nextWindow.height === windowSize.height;
    /* Where the kept centre went on the page; moving the camera by as much puts everything back. */
    const dx = next.left + next.width / 2 - (box.left + box.width / 2);
    const dy = next.top + next.height / 2 - (box.top + box.height / 2);
    box = next;
    windowSize = nextWindow;
    if (sameWindow && box.width > 0 && box.height > 0 && (dx !== 0 || dy !== 0)) map.panBy([dx, dy], { animate: false });
  };
  map.on("resize", onResize);
  return () => map.off("resize", onResize);
}
