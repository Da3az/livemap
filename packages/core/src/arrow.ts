import type { ArrowFeature, LngLat } from "./types.js";
import {
  cumulativeDistances,
  lngLatToWorld,
  metresPerPixel,
  pathLength,
  pointAlong,
  resampleEvenly,
  worldToLngLat,
  type WorldXY,
} from "./geo.js";

export interface Marker {
  readonly position: LngLat;
  /** Compass bearing the marker points toward, degrees. */
  readonly bearing: number;
}

export interface BuiltArrow {
  /** The drawable shaft, already trimmed for the heads. */
  readonly shaft: readonly LngLat[];
  /** The full untrimmed curve — use for hit-testing and bounds. */
  readonly curve: readonly LngLat[];
  readonly headEnd: Marker | null;
  readonly headStart: Marker | null;
  readonly chevrons: readonly Marker[];
  readonly lengthM: number;
}

export interface ArrowBuildOptions {
  readonly samplesPerSegment?: number;
  /** Arrowhead length in metres; see `arrowHeadMetres`. */
  readonly headLengthM?: number;
  /** Chevron spacing in metres along the shaft. */
  readonly chevronSpacingM?: number;
}

const DEFAULTS = {
  samplesPerSegment: 24,
  headLengthM: 0,
  chevronSpacingM: 0,
} as const;

/** One nanometre: below anything authorable, above float accumulation error. */
export const DEGENERATE_LENGTH_M = 1e-6;

/**
 * Catmull-Rom through `control`, in Mercator world space (lng/lat skews at high
 * latitude). `curvature` scales the tangents: 0 traces the straight chord, so
 * it is exactly the polyline through the controls; 1 is full Catmull-Rom.
 */
export function splineThrough(
  control: readonly LngLat[],
  curvature: number,
  samplesPerSegment: number = DEFAULTS.samplesPerSegment,
): LngLat[] {
  if (control.length < 2) return [...control];

  const c = Math.max(0, Math.min(1, curvature));
  const pts: WorldXY[] = control.map(lngLatToWorld);
  const n = pts.length;
  const out: WorldXY[] = [];

  const at = (i: number): WorldXY => pts[Math.max(0, Math.min(n - 1, i))]!;

  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    // Endpoints clamp to one-sided differences so the curve cannot bulge past
    // the first/last control point.
    const m1 = {
      x: (c * (p2.x - p0.x)) / 2,
      y: (c * (p2.y - p0.y)) / 2,
    };
    const m2 = {
      x: (c * (p3.x - p1.x)) / 2,
      y: (c * (p3.y - p1.y)) / 2,
    };

    const steps = Math.max(1, samplesPerSegment);
    // Skip t=0 after the first segment: it duplicates the previous end.
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;

      // Cubic Hermite basis.
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;

      out.push({
        x: h00 * p1.x + h10 * m1.x + h01 * p2.x + h11 * m2.x,
        y: h00 * p1.y + h10 * m1.y + h01 * p2.y + h11 * m2.y,
      });
    }
  }

  return out.map(worldToLngLat);
}

/**
 * Sub-path from `fromM` to `toM` metres along `path`. Used to pull the shaft
 * back from the tips, so the line does not show through a filled arrowhead.
 */
export function trimPath(
  path: readonly LngLat[],
  fromM: number,
  toM: number,
): LngLat[] {
  if (path.length < 2) return [...path];
  const cum = cumulativeDistances(path);
  const total = cum[cum.length - 1]!;
  const a = Math.max(0, Math.min(total, fromM));
  const b = Math.max(a, Math.min(total, toM));
  if (b - a <= 0) return [];

  const out: LngLat[] = [];
  const start = pointAlong(path, a);
  if (start) out.push(start.position);

  for (let i = 0; i < path.length; i++) {
    const d = cum[i]!;
    if (d > a && d < b) out.push(path[i]!);
  }

  const end = pointAlong(path, b);
  if (end) out.push(end.position);
  return out;
}

export function buildArrow(
  feature: ArrowFeature,
  options: ArrowBuildOptions = {},
): BuiltArrow {
  const opts = { ...DEFAULTS, ...options };
  const curve = splineThrough(
    feature.control,
    feature.curvature,
    opts.samplesPerSegment,
  );

  const rawLength = pathLength(curve);

  // Epsilon, not `=== 0`: coincident control points still emit spline samples,
  // and float error gives them a length of ~1e-8 m.
  const lengthM = rawLength < DEGENERATE_LENGTH_M ? 0 : rawLength;

  if (curve.length < 2 || lengthM === 0) {
    return {
      shaft: curve,
      curve,
      headEnd: null,
      headStart: null,
      chevrons: [],
      lengthM: 0,
    };
  }

  const wantsEnd = feature.head === "single" || feature.head === "double";
  const wantsStart = feature.head === "double";

  // Cap the trim at 40%, or a short arrow at low zoom becomes two heads and
  // no shaft.
  const maxTrim = lengthM * 0.4;
  const headLen = Math.max(0, Math.min(maxTrim, opts.headLengthM));

  const trimEnd = wantsEnd ? headLen : 0;
  const trimStart = wantsStart ? headLen : 0;

  const shaft = trimPath(curve, trimStart, lengthM - trimEnd);

  const endPoint = pointAlong(curve, lengthM);
  const startPoint = pointAlong(curve, 0);

  const headEnd: Marker | null =
    wantsEnd && endPoint
      ? { position: endPoint.position, bearing: endPoint.bearing }
      : null;

  // A start head points back along the path.
  const headStart: Marker | null =
    wantsStart && startPoint
      ? {
          position: startPoint.position,
          bearing: (startPoint.bearing + 180) % 360,
        }
      : null;

  const chevrons: Marker[] = [];
  if (feature.chevrons && opts.chevronSpacingM > 0) {
    // Keep chevrons clear of both tips so they do not collide with the heads.
    const inset = Math.max(headLen, opts.chevronSpacingM * 0.5);
    for (const p of resampleEvenly(curve, opts.chevronSpacingM)) {
      if (p.along < inset) continue;
      if (p.along > lengthM - inset) continue;
      chevrons.push({ position: p.position, bearing: p.bearing });
    }
  }

  return { shaft, curve, headEnd, headStart, chevrons, lengthM };
}

// Heads and chevrons are sized in px and converted to metres per view: sized
// in metres they stay put while the curve shrinks, so they bloat on zoom out.

export function arrowHeadPx(strokeWidthPx: number): number {
  // 3.2x reads proportionate at news-graphic stroke weights (2-8px).
  return Math.max(8, Math.min(42, strokeWidthPx * 3.2));
}

export function arrowHeadMetres(
  strokeWidthPx: number,
  lat: number,
  zoom: number,
): number {
  return arrowHeadPx(strokeWidthPx) * metresPerPixel(lat, zoom);
}

export function chevronSpacingMetres(
  strokeWidthPx: number,
  lat: number,
  zoom: number,
): number {
  const px = Math.max(24, strokeWidthPx * 9);
  return px * metresPerPixel(lat, zoom);
}

/** Called on zoom change; `buildArrow` stays view-independent. */
export function buildArrowForView(
  feature: ArrowFeature,
  zoom: number,
): BuiltArrow {
  const lat = feature.control[0]?.[1] ?? 0;
  return buildArrow(feature, {
    headLengthM: arrowHeadMetres(feature.stroke.width, lat, zoom),
    chevronSpacingM: feature.chevrons
      ? chevronSpacingMetres(feature.stroke.width, lat, zoom)
      : 0,
  });
}

/**
 * The sprite is authored pointing EAST, and `icon-rotate` is clockwise from up
 * while bearings are clockwise from north — hence -90. Needs
 * `icon-rotation-alignment: "map"` and `icon-ignore-placement: true`; without
 * the latter MapLibre's collision engine silently drops arrowheads.
 */
export const iconRotateForBearing = (b: number): number => b - 90;

export const bearingForIconRotate = (r: number): number => (r + 90 + 360) % 360;
