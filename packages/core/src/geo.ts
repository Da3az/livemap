/** Degrees at the API boundary, radians internally. Bearings are compass: 0 = north, clockwise. */

import type { LngLat, BBox } from "./types.js";

export const EARTH_RADIUS_M = 6_378_137;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const toRad = (deg: number): number => deg * D2R;
export const toDeg = (rad: number): number => rad * R2D;

/** Wrap into [0, 360). */
export function normaliseBearing(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/** Signed smallest difference b - a, in (-180, 180]. */
export function bearingDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Great-circle distance in metres. */
export function distance(a: LngLat, b: LngLat): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial great-circle bearing from `a` to `b`. */
export function bearing(a: LngLat, b: LngLat): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return normaliseBearing(toDeg(Math.atan2(y, x)));
}

/** Point `distM` metres from `origin` along compass `bearingDeg`. */
export function destination(
  origin: LngLat,
  distM: number,
  bearingDeg: number,
): LngLat {
  const [lon, lat] = origin;
  const d = distM / EARTH_RADIUS_M;
  const b = toRad(bearingDeg);
  const p1 = toRad(lat);
  const l1 = toRad(lon);

  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );

  let lonOut = toDeg(l2);
  lonOut = ((lonOut + 540) % 360) - 180;
  return [lonOut, toDeg(p2)];
}

export interface WorldXY {
  readonly x: number;
  readonly y: number;
}

/**
 * Screen-space annotation layout needs a planar space: a 20px offset is not a
 * constant number of degrees, so working in lng/lat makes leader lines and
 * label collision behave differently at different latitudes.
 */
export function lngLatToWorld([lng, lat]: LngLat): WorldXY {
  const clampedLat = Math.max(-85.051129, Math.min(85.051129, lat));
  const x = (lng + 180) / 360;
  const s = Math.sin(toRad(clampedLat));
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return { x, y };
}

export function worldToLngLat({ x, y }: WorldXY): LngLat {
  const lng = x * 360 - 180;
  const n = Math.PI * (1 - 2 * y);
  const lat = toDeg(Math.atan(Math.sinh(n)));
  return [lng, lat];
}

export const worldPx = (zoom: number, tileSize = 512): number =>
  tileSize * Math.pow(2, zoom);

export function lngLatToPx(p: LngLat, zoom: number, tileSize = 512): WorldXY {
  const w = lngLatToWorld(p);
  const scale = worldPx(zoom, tileSize);
  return { x: w.x * scale, y: w.y * scale };
}

export function pxToLngLat(p: WorldXY, zoom: number, tileSize = 512): LngLat {
  const scale = worldPx(zoom, tileSize);
  return worldToLngLat({ x: p.x / scale, y: p.y / scale });
}

/** Metres per CSS pixel. Converts authored metre sizes into stable screen sizes. */
export function metresPerPixel(
  lat: number,
  zoom: number,
  tileSize = 512,
): number {
  return (
    (Math.cos(toRad(lat)) * 2 * Math.PI * EARTH_RADIUS_M) /
    worldPx(zoom, tileSize)
  );
}

export function zoomForScale(
  lat: number,
  metres: number,
  px: number,
  tileSize = 512,
): number {
  const target = metres / px;
  const circumference = Math.cos(toRad(lat)) * 2 * Math.PI * EARTH_RADIUS_M;
  return Math.log2(circumference / (target * tileSize));
}

/** Cumulative along-path distances in metres; length === path.length. */
export function cumulativeDistances(path: readonly LngLat[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    out.push(out[i - 1]! + distance(path[i - 1]!, path[i]!));
  }
  return out;
}

export function pathLength(path: readonly LngLat[]): number {
  if (path.length < 2) return 0;
  const c = cumulativeDistances(path);
  return c[c.length - 1]!;
}

export interface PointOnPath {
  readonly position: LngLat;
  readonly bearing: number;
  readonly along: number;
}

/**
 * The bearing comes from the smoothed segment the point lands on, not from the
 * control points — taking it from the controls is what sits an arrowhead
 * visibly off-tangent on a curve.
 */
export function pointAlong(
  path: readonly LngLat[],
  targetM: number,
): PointOnPath | null {
  if (path.length === 0) return null;
  if (path.length === 1) {
    return { position: path[0]!, bearing: 0, along: 0 };
  }

  const cum = cumulativeDistances(path);
  const total = cum[cum.length - 1]!;
  const t = Math.max(0, Math.min(total, targetM));

  for (let i = 1; i < path.length; i++) {
    const d0 = cum[i - 1]!;
    const d1 = cum[i]!;
    if (t <= d1 || i === path.length - 1) {
      const seg = d1 - d0;
      const f = seg === 0 ? 0 : (t - d0) / seg;
      const a = path[i - 1]!;
      const b = path[i]!;
      const br = bearing(a, b);

      // Return vertices directly at segment ends. `destination` is accurate but
      // not bit-exact, so round-tripping drifts by a few ulps — which compounds
      // when the result is fed back in, e.g. re-splining an edited arrow.
      let position: LngLat;
      if (seg === 0 || f <= 0) position = a;
      else if (f >= 1) position = b;
      else position = destination(a, seg * f, br);

      return { position, bearing: br, along: t };
    }
  }
  const last = path[path.length - 1]!;
  return {
    position: last,
    bearing: bearing(path[path.length - 2]!, last),
    along: total,
  };
}

/** Even spacing regardless of how the spline distributed its samples. */
export function resampleEvenly(
  path: readonly LngLat[],
  spacingM: number,
): PointOnPath[] {
  const total = pathLength(path);
  if (total === 0 || spacingM <= 0) return [];
  const out: PointOnPath[] = [];
  for (let d = 0; d <= total + 1e-6; d += spacingM) {
    const p = pointAlong(path, d);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Positive offset is to the LEFT of travel. Per-vertex normal offset only — it
 * does not resolve self-intersection on tight concave bends, which is
 * acceptable for human-authored front lines.
 */
export function offsetPath(path: readonly LngLat[], offsetM: number): LngLat[] {
  if (path.length < 2 || offsetM === 0) return [...path];
  const out: LngLat[] = [];
  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(0, i - 1)]!;
    const next = path[Math.min(path.length - 1, i + 1)]!;
    const dir = bearing(prev, next);
    out.push(
      destination(path[i]!, Math.abs(offsetM), dir + (offsetM > 0 ? -90 : 90)),
    );
  }
  return out;
}

export function bboxOf(points: readonly LngLat[]): BBox | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

export function expandBBox(b: BBox, other: BBox): BBox {
  return {
    west: Math.min(b.west, other.west),
    south: Math.min(b.south, other.south),
    east: Math.max(b.east, other.east),
    north: Math.max(b.north, other.north),
  };
}
