import { alongPolyline, distance, polylineLength, segments, type Pt } from "./geo";

const SAMPLES_PER_SEGMENT = 18;

function hermite(p0: Pt, p1: Pt, m0: Pt, m1: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return {
    x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
    y: h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
  };
}

/** Which side of the direction of travel a two-point arrow bows to. */
export type BendSide = "left" | "right";

/** At full curvature the arc of a two-point arrow stands this fraction of its length off the straight line. */
const ARC_RISE = 0.18;

/**
 * A two-point arrow has no interior point to curve through, so its curvature
 * is an arc: a quadratic curve that rises `ARC_RISE × curvature` of the
 * chord, to the left of the direction of travel unless told otherwise. Left
 * is fixed in map space (north for an arrow heading east), so the arc keeps
 * its side when the map is turned.
 */
function arcSpan(a: Pt, b: Pt, amount: number, bend: BendSide): Pt[] {
  const side = bend === "left" ? 1 : -1;
  /* A quadratic curve peaks at half its control point's offset. */
  const reach = 2 * ARC_RISE * amount * side;
  const control = { x: (a.x + b.x) / 2 + (b.y - a.y) * reach, y: (a.y + b.y) / 2 - (b.x - a.x) * reach };
  const span: Pt[] = [];
  for (let step = 0; step <= SAMPLES_PER_SEGMENT; step++) {
    const t = step / SAMPLES_PER_SEGMENT;
    const u = 1 - t;
    span.push({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y });
  }
  return span;
}

/**
 * The spans of a cardinal spline through the control points. `curvature`
 * scales the tangents: 0 gives straight segments, 1 a Catmull-Rom curve.
 * With exactly two points it is an arc instead (see `arcSpan`); `bend`
 * matters only then. The construction is invariant under scaling and
 * rotation, so the same samples serve every zoom.
 */
export function curveSpans(control: readonly Pt[], curvature: number, bend: BendSide = "left"): Pt[][] {
  const amount = Math.max(0, Math.min(1, curvature));
  const pairs = [...segments(control)];
  const [first, second] = control;
  if (amount > 0 && control.length === 2 && first && second) return [arcSpan(first, second, amount, bend)];
  if (amount === 0 || control.length < 3) return pairs.map(([a, b]) => [a, b]);

  const tangents = control.map((point, index) => {
    const before = control[index - 1] ?? point;
    const after = control[index + 1] ?? point;
    const span = index === 0 || index === control.length - 1 ? 1 : 0.5;
    return { x: (after.x - before.x) * span * amount, y: (after.y - before.y) * span * amount };
  });

  return pairs.map(([a, b], index) => {
    const m0 = tangents[index] ?? { x: 0, y: 0 };
    const m1 = tangents[index + 1] ?? { x: 0, y: 0 };
    const span: Pt[] = [];
    for (let step = 0; step <= SAMPLES_PER_SEGMENT; step++) span.push(hermite(a, b, m0, m1, step / SAMPLES_PER_SEGMENT));
    return span;
  });
}

/** The whole curve as one polyline. */
export function sampleCurve(control: readonly Pt[], curvature: number, bend: BendSide = "left"): Pt[] {
  const spans = curveSpans(control, curvature, bend);
  const out: Pt[] = [];
  spans.forEach((span, index) => out.push(...(index === 0 ? span : span.slice(1))));
  const only = control[0];
  if (out.length === 0 && only) out.push(only);
  return out;
}

/** The point halfway along each span, where a new control point can go without bending the curve. */
export function curveMidpoints(control: readonly Pt[], curvature: number, bend: BendSide = "left"): Pt[] {
  return curveSpans(control, curvature, bend).flatMap((span) => {
    const middle = alongPolyline(span, polylineLength(span) / 2);
    return middle ? [middle.at] : [];
  });
}

/** Removes `length` from the end of a polyline and returns what is left plus the cut point's heading. */
export function trimEnd(points: readonly Pt[], length: number): { points: Pt[]; dir: Pt } | null {
  const total = polylineLength(points);
  const cut = alongPolyline(points, Math.max(0, total - length));
  const tip = points[points.length - 1];
  if (!cut || !tip) return null;
  const kept: Pt[] = [];
  let travelled = 0;
  let previous: Pt | null = null;
  for (const point of points) {
    if (previous) travelled += distance(previous, point);
    if (travelled >= total - length && previous) break;
    kept.push(point);
    previous = point;
  }
  kept.push(cut.at);
  const span = distance(cut.at, tip);
  const dir = span > 0 ? { x: (tip.x - cut.at.x) / span, y: (tip.y - cut.at.y) / span } : cut.dir;
  return { points: kept, dir };
}

/** A polygon around a polyline whose width grows linearly from `startWidth` to `endWidth`. */
export function taperedOutline(points: readonly Pt[], startWidth: number, endWidth: number): Pt[] {
  const total = polylineLength(points);
  if (total === 0) return [];
  const left: Pt[] = [];
  const right: Pt[] = [];
  let travelled = 0;
  points.forEach((point, index) => {
    const before = points[index - 1] ?? point;
    const after = points[index + 1] ?? point;
    if (index > 0) travelled += distance(before, point);
    const span = distance(before, after);
    if (span === 0) return;
    const normal = { x: -(after.y - before.y) / span, y: (after.x - before.x) / span };
    const half = (startWidth + (endWidth - startWidth) * (travelled / total)) / 2;
    left.push({ x: point.x + normal.x * half, y: point.y + normal.y * half });
    right.push({ x: point.x - normal.x * half, y: point.y - normal.y * half });
  });
  return [...left, ...right.reverse()];
}

/** The part of a polyline between two distances along it. */
function slice(points: readonly Pt[], from: number, to: number): Pt[] {
  const start = alongPolyline(points, from);
  const end = alongPolyline(points, to);
  if (!start || !end) return [];
  const out: Pt[] = [start.at];
  let travelled = 0;
  let previous: Pt | null = null;
  for (const point of points) {
    if (previous) travelled += distance(previous, point);
    if (previous && travelled > from && travelled < to) out.push(point);
    previous = point;
  }
  out.push(end.at);
  return out;
}

function disc(centre: Pt, radius: number): Pt[] {
  const steps = 12;
  return Array.from({ length: steps }, (_, step) => {
    const angle = (Math.PI * 2 * step) / steps;
    return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
  });
}

/**
 * A tapered shaft cut into dashes. Each dash is its own slice of the taper,
 * so the marks widen toward the head as the solid shaft does, and the gaps
 * read as gaps at every width. `dash` is the usual on/off list in CSS
 * pixels; a zero-length "on" (the dotted style) becomes a round dot as wide
 * as the shaft is there. The pattern is laid from the head backwards so a
 * whole dash always meets the head.
 */
export function taperedDashes(points: readonly Pt[], startWidth: number, endWidth: number, dash: readonly number[]): Pt[][] {
  const total = polylineLength(points);
  const period = dash.reduce((sum, length) => sum + length, 0);
  if (total === 0 || dash.length < 2 || period <= 0) return [];
  const widthAt = (along: number) => startWidth + (endWidth - startWidth) * (along / total);
  const out: Pt[][] = [];
  let end = total;
  let index = 0;
  while (end > 0 && out.length < 2000) {
    const on = dash[index % dash.length] ?? 0;
    const off = dash[(index + 1) % dash.length] ?? 0;
    const start = Math.max(0, end - on);
    if (on === 0) {
      const at = alongPolyline(points, end);
      if (at) out.push(disc(at.at, widthAt(end) / 2));
    } else if (end - start > 0.5) {
      out.push(taperedOutline(slice(points, start, end), widthAt(start), widthAt(end)));
    }
    /* The gap grows with the shaft so the thick end does not close up. */
    end = start - Math.max(off, on === 0 ? widthAt(start) * 1.6 : widthAt(start) * 0.9);
    index += 2;
  }
  return out;
}
