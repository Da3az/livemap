import { sampleCurve, type BendSide } from "@/render/curve";
import { alongPolyline, polylineLength, type Pt } from "@/render/geo";

/** The point halfway along an arrow's curve: where its bend handle sits. Mercator in, Mercator out. */
export function curveMiddle(control: readonly Pt[], curvature: number, bend: BendSide): Pt | null {
  const line = sampleCurve(control, curvature, bend);
  return alongPolyline(line, polylineLength(line) / 2)?.at ?? null;
}

/**
 * The curvature, and for a two-point arrow the side, that bring the curve's
 * middle closest to `target`. The middle travels from the straight arrow's
 * middle (curvature 0) toward the fully curved one's (1); `target` is
 * projected onto that path. Null when curving does not move the middle, as
 * for an arrow whose points lie on one line.
 */
export function bendFor(control: readonly Pt[], target: Pt): { curvature: number; bend: BendSide } | null {
  const straight = curveMiddle(control, 0, "left");
  if (!straight) return null;
  const sides: BendSide[] = control.length === 2 ? ["left", "right"] : ["left"];
  let best: { t: number; side: BendSide } | null = null;
  for (const side of sides) {
    const curved = curveMiddle(control, 1, side);
    if (!curved) continue;
    const dx = curved.x - straight.x;
    const dy = curved.y - straight.y;
    const length = dx * dx + dy * dy;
    if (length < 1e-24) continue;
    const t = ((target.x - straight.x) * dx + (target.y - straight.y) * dy) / length;
    if (best === null || t > best.t) best = { t, side };
  }
  if (!best) return null;
  return { curvature: Math.round(Math.max(0, Math.min(1, best.t)) * 100) / 100, bend: best.side };
}
