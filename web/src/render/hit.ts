import {
  boxContains,
  boxCorners,
  boxesOverlap,
  distance,
  distanceToPolyline,
  padBox,
  pointInRings,
  polylineTouchesBox,
  type Box,
  type Pt,
} from "./geo";
import type { SceneItem } from "./scene";
import { ANCHOR_DOT_RADIUS, type ScreenShape } from "./shapes";

function closed(ring: readonly Pt[]): Pt[] {
  const first = ring[0];
  return first ? [...ring, first] : [];
}

/** True when the point is on what the feature paints, within `tolerance` CSS pixels. */
export function hitsShape(item: SceneItem, shape: ScreenShape, p: Pt, tolerance: number): boolean {
  if (!boxContains(padBox(shape.box, tolerance), p)) return false;
  const reach = (item.style.stroke?.width ?? 0) / 2 + tolerance;
  if (shape.text && !shape.labelHidden && shape.kind !== "annotation" && boxContains(shape.text.box, p)) return true;
  switch (shape.kind) {
    case "area": {
      const filled = item.style.fill !== null && item.style.fill.opacity > 0;
      if (filled && pointInRings(p, shape.rings)) return true;
      return shape.rings.some((ring) => distanceToPolyline(p, closed(ring)) <= reach);
    }
    case "line":
      return distanceToPolyline(p, shape.points) <= reach;
    case "arrow":
      if (shape.heads.some((head) => pointInRings(p, [head]))) return true;
      return distanceToPolyline(p, shape.shaft) <= reach;
    case "frontline":
      if (shape.teeth.some((tooth) => pointInRings(p, [tooth]))) return true;
      return distanceToPolyline(p, shape.points) <= reach;
    case "point":
      return distance(p, shape.centre) <= shape.radius + tolerance;
    case "annotation":
      if (shape.text && boxContains(padBox(shape.text.box, tolerance), p)) return true;
      if (shape.dot && distance(p, shape.anchor) <= ANCHOR_DOT_RADIUS + tolerance) return true;
      return shape.leader !== null && distanceToPolyline(p, shape.leader) <= tolerance + 1;
  }
}

/** True when any drawn part of the shape lies inside or crosses the rectangle. */
export function shapeTouchesBox(shape: ScreenShape, box: Box): boolean {
  if (!boxesOverlap(shape.box, box)) return false;
  switch (shape.kind) {
    case "area":
      if (shape.rings.some((ring) => polylineTouchesBox(closed(ring), box))) return true;
      return boxCorners(box).some((corner) => pointInRings(corner, shape.rings));
    case "line":
      return polylineTouchesBox(shape.points, box);
    case "arrow":
      return polylineTouchesBox(shape.shaft, box) || shape.heads.some((head) => polylineTouchesBox(closed(head), box));
    case "frontline":
      return polylineTouchesBox(shape.points, box);
    case "point":
      return boxesOverlap(padBox({ minX: shape.centre.x, minY: shape.centre.y, maxX: shape.centre.x, maxY: shape.centre.y }, shape.radius), box);
    case "annotation":
      if (shape.text && boxesOverlap(shape.text.box, box)) return true;
      if (shape.dot && boxContains(box, shape.anchor)) return true;
      return shape.leader !== null && polylineTouchesBox(shape.leader, box);
  }
}
