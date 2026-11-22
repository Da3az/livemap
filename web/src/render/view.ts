import type { Map as MapLibreMap } from "maplibre-gl";
import { lngLatToMerc, mercToLngLat, type Pt } from "./geo";

/**
 * The mapping between Web Mercator world units and CSS pixels for one frame.
 * It is calibrated from the map's own `project`, so padding, bearing and any
 * camera constraint are whatever MapLibre says they are. With no pitch the
 * mapping is affine and each vertex costs two multiplications; with pitch it
 * falls back to asking the map for every vertex.
 */
export interface View {
  readonly width: number;
  readonly height: number;
  /** CSS pixels per mercator world unit. */
  readonly scale: number;
  /** Changes whenever the mapping does. */
  readonly key: string;
  /** Mercator x of the view centre, for choosing the nearest world copy. */
  readonly centreX: number;
  /** The view centre in mercator world units. */
  readonly origin: Pt;
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
  project(p: Pt, wrap?: number): Pt;
  unproject(p: Pt): Pt;
}

const CALIBRATION_SPAN = 256;

export function readView(map: MapLibreMap): View {
  const container = map.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight;
  const centre = map.getCenter();
  const zoom = map.getZoom();
  const bearing = map.getBearing();
  const pitch = map.getPitch();
  const key = `${width}x${height}|${centre.lng},${centre.lat}|${zoom}|${bearing}|${pitch}`;
  const origin = lngLatToMerc([centre.lng, centre.lat]);
  const scale = 512 * 2 ** zoom;

  if (pitch !== 0) {
    return {
      width,
      height,
      scale,
      key,
      centreX: origin.x,
      origin,
      zoom,
      bearing,
      pitch,
      project(p, wrap = 0) {
        const at = mercToLngLat({ x: p.x + wrap, y: p.y });
        const screen = map.project(at);
        return { x: screen.x, y: screen.y };
      },
      unproject(p) {
        const at = map.unproject([p.x, p.y]);
        return lngLatToMerc([at.lng, at.lat]);
      },
    };
  }

  const anchor = map.project(centre);
  const east = map.unproject([anchor.x + CALIBRATION_SPAN, anchor.y]);
  const south = map.unproject([anchor.x, anchor.y + CALIBRATION_SPAN]);
  const e = lngLatToMerc([east.lng, east.lat]);
  const s = lngLatToMerc([south.lng, south.lat]);
  /* Columns of the inverse: how far mercator moves for one calibration span on each screen axis. */
  const ux = e.x - origin.x;
  const uy = e.y - origin.y;
  const vx = s.x - origin.x;
  const vy = s.y - origin.y;
  const determinant = ux * vy - vx * uy;
  const a = (vy / determinant) * CALIBRATION_SPAN;
  const c = (-vx / determinant) * CALIBRATION_SPAN;
  const b = (-uy / determinant) * CALIBRATION_SPAN;
  const d = (ux / determinant) * CALIBRATION_SPAN;

  return {
    width,
    height,
    scale,
    key,
    centreX: origin.x,
    origin,
    zoom,
    bearing,
    pitch,
    project(p, wrap = 0) {
      const dx = p.x + wrap - origin.x;
      const dy = p.y - origin.y;
      return { x: anchor.x + a * dx + c * dy, y: anchor.y + b * dx + d * dy };
    },
    unproject(p) {
      const sx = (p.x - anchor.x) / CALIBRATION_SPAN;
      const sy = (p.y - anchor.y) / CALIBRATION_SPAN;
      return { x: origin.x + ux * sx + vx * sy, y: origin.y + uy * sx + vy * sy };
    },
  };
}
