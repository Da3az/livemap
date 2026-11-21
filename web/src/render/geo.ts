import type { LngLat } from "@/model/types";

/** A position in a flat plane: Web Mercator world units (0..1) or CSS pixels. */
export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EARTH_RADIUS = 6_371_008.8;
const EARTH_CIRCUMFERENCE = 40_075_016.686;
const RAD = Math.PI / 180;
const MAX_LAT = 85.051129;

export function lngLatToMerc(at: LngLat): Pt {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, at[1]));
  return {
    x: (at[0] + 180) / 360,
    y: (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))) / 360,
  };
}

export function mercToLngLat(p: Pt): LngLat {
  const lat = (360 / Math.PI) * Math.atan(Math.exp((180 - p.y * 360) * RAD)) - 90;
  return [p.x * 360 - 180, lat];
}

/** Metres per CSS pixel at a latitude and zoom, for 512px tiles. */
export function metresPerPixel(latitude: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos(latitude * RAD)) / (512 * 2 ** zoom);
}

function haversine(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle length of a path, in metres. */
export function geodesicLength(path: readonly LngLat[]): number {
  let total = 0;
  let previous: LngLat | null = null;
  for (const at of path) {
    if (previous) total += haversine(previous, at);
    previous = at;
  }
  return total;
}

/** Area enclosed by a ring on the sphere, in square metres. The ring may be open or closed. */
export function geodesicArea(ring: readonly LngLat[]): number {
  const first = ring[0];
  if (!first || ring.length < 3) return 0;
  let total = 0;
  let previous = first;
  const closed = [...ring.slice(1), first];
  for (const at of closed) {
    total += (at[0] - previous[0]) * RAD * (2 + Math.sin(previous[1] * RAD) + Math.sin(at[1] * RAD));
    previous = at;
  }
  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function growBox(box: Box, p: Pt): void {
  if (p.x < box.minX) box.minX = p.x;
  if (p.y < box.minY) box.minY = p.y;
  if (p.x > box.maxX) box.maxX = p.x;
  if (p.y > box.maxY) box.maxY = p.y;
}

export function boxOf(points: Iterable<Pt>): Box {
  const box = emptyBox();
  for (const p of points) growBox(box, p);
  return box;
}

export function padBox(box: Box, by: number): Box {
  return { minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boxContains(box: Box, p: Pt): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The closest point to `p` on segment a–b. */
export function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Consecutive pairs of a polyline. */
export function* segments(points: readonly Pt[]): Generator<[Pt, Pt]> {
  let previous: Pt | null = null;
  for (const p of points) {
    if (previous) yield [previous, p];
    previous = p;
  }
}

export function distanceToPolyline(p: Pt, points: readonly Pt[]): number {
  let best = Infinity;
  for (const [a, b] of segments(points)) {
    const d = distance(p, closestOnSegment(p, a, b));
    if (d < best) best = d;
  }
  if (best === Infinity) {
    const only = points[0];
    if (only) best = distance(p, only);
  }
  return best;
}

export function polylineLength(points: readonly Pt[]): number {
  let total = 0;
  for (const [a, b] of segments(points)) total += distance(a, b);
  return total;
}

/** Even-odd test over one or more closed rings, so holes are outside. */
export function pointInRings(p: Pt, rings: readonly (readonly Pt[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    let previous = ring[ring.length - 1];
    if (!previous) continue;
    for (const current of ring) {
      const crosses = current.y > p.y !== previous.y > p.y;
      if (crosses && p.x < ((previous.x - current.x) * (p.y - current.y)) / (previous.y - current.y) + current.x) {
        inside = !inside;
      }
      previous = current;
    }
  }
  return inside;
}

function orientation(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

export function boxCorners(box: Box): Pt[] {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}

/** True when any part of the polyline lies inside or crosses the box. */
export function polylineTouchesBox(points: readonly Pt[], box: Box): boolean {
  for (const p of points) if (boxContains(box, p)) return true;
  const corners = boxCorners(box);
  const edges = [...segments([...corners, ...corners.slice(0, 1)])];
  for (const [a, b] of segments(points)) {
    for (const [c, d] of edges) if (segmentsCross(a, b, c, d)) return true;
  }
  return false;
}

/** The point a given distance along a polyline, with the direction of travel there. */
export function alongPolyline(points: readonly Pt[], target: number): { at: Pt; dir: Pt } | null {
  let travelled = 0;
  let last: { at: Pt; dir: Pt } | null = null;
  for (const [a, b] of segments(points)) {
    const length = distance(a, b);
    if (length === 0) continue;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    if (travelled + length >= target) {
      const t = target - travelled;
      return { at: { x: a.x + dir.x * t, y: a.y + dir.y * t }, dir };
    }
    travelled += length;
    last = { at: b, dir };
  }
  return last;
}

/** Area-weighted centroid of a ring; falls back to the vertex mean for a degenerate ring. */
export function ringCentroid(ring: readonly Pt[]): Pt | null {
  let previous = ring[ring.length - 1];
  if (!previous) return null;
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  let sumX = 0;
  let sumY = 0;
  for (const current of ring) {
    const cross = previous.x * current.y - current.x * previous.y;
    twiceArea += cross;
    cx += (previous.x + current.x) * cross;
    cy += (previous.y + current.y) * cross;
    sumX += current.x;
    sumY += current.y;
    previous = current;
  }
  if (Math.abs(twiceArea) < 1e-30) return { x: sumX / ring.length, y: sumY / ring.length };
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}
