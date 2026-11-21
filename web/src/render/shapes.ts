import { taperedDashes, taperedOutline, trimEnd } from "./curve";
import {
  alongPolyline,
  boxOf,
  distance,
  emptyBox,
  growBox,
  padBox,
  polylineLength,
  ringCentroid,
  segments,
  type Box,
  type Pt,
} from "./geo";
import type { SceneItem } from "./scene";
import { textBox, type TextBlock } from "./text";
import type { View } from "./view";

/**
 * What a feature looks like on screen for one view, in CSS pixels. The same
 * shape is painted, hit-tested and outlined when selected, so a click lands on
 * what is drawn: the arrow's curve and head, the teeth, the icon's disc.
 */
export interface PlacedText {
  block: TextBlock;
  centre: Pt;
  box: Box;
}

interface ShapeBase {
  /** Everything the shape paints, for culling and for the first pass of a hit test. */
  box: Box;
  /** The optional label, or an annotation's text. */
  text: PlacedText | null;
  /** Set by label placement when the label found no free place: it is neither painted nor hit. */
  labelHidden?: boolean;
}

export type ScreenShape = ShapeBase &
  (
    | { kind: "area"; rings: Pt[][] }
    | { kind: "line"; points: Pt[] }
    | { kind: "arrow"; shaft: Pt[]; /** The filled pieces of a tapered shaft: one outline, or one per dash. */ taper: Pt[][] | null; heads: Pt[][] }
    | { kind: "frontline"; points: Pt[]; teeth: Pt[][] }
    | { kind: "point"; centre: Pt; radius: number }
    | { kind: "annotation"; anchor: Pt; leader: Pt[] | null; dot: boolean }
  );

export const ANCHOR_DOT_RADIUS = 3;
const SEMICIRCLE_STEPS = 10;
const LABEL_GAP = 4;

function place(block: TextBlock | null, centre: Pt | null): PlacedText | null {
  if (!block || !centre) return null;
  return { block, centre, box: textBox(block, centre) };
}

function midpoint(points: readonly Pt[]): Pt | null {
  return alongPolyline(points, polylineLength(points) / 2)?.at ?? points[0] ?? null;
}

/* ------------------------------------------------------------------ arrows */

function headLengthFor(width: number, available: number): number {
  const wanted = Math.max(10, Math.min(44, width * 3.2 + 4));
  return Math.min(wanted, available);
}

function headAt(tip: Pt, dir: Pt, length: number): Pt[] {
  const half = length * 0.55;
  const base = { x: tip.x - dir.x * length, y: tip.y - dir.y * length };
  return [tip, { x: base.x - dir.y * half, y: base.y + dir.x * half }, { x: base.x + dir.y * half, y: base.y - dir.x * half }];
}

function arrowParts(curve: Pt[], width: number, head: "none" | "single" | "double", tapered: boolean, dash: readonly number[]) {
  const heads: Pt[][] = [];
  let shaft = curve;
  const total = polylineLength(curve);
  const headCount = head === "double" ? 2 : head === "single" ? 1 : 0;
  const length = headCount > 0 ? headLengthFor(width, total / (headCount + 0.6)) : 0;
  /* The shaft stops one pixel inside the head so the two meet without a seam. */
  const cut = Math.max(0, length - 1);

  const tip = shaft[shaft.length - 1];
  if (headCount >= 1 && tip) {
    const trimmed = trimEnd(shaft, cut);
    if (trimmed) {
      heads.push(headAt(tip, trimmed.dir, length));
      shaft = trimmed.points;
    }
  }
  const tail = shaft[0];
  if (headCount === 2 && tail) {
    const trimmed = trimEnd([...shaft].reverse(), cut);
    if (trimmed) {
      heads.push(headAt(tail, trimmed.dir, length));
      shaft = trimmed.points.reverse();
    }
  }
  const thin = Math.max(1, width * 0.35);
  const thick = width * 1.4;
  /* A dashed taper is the taper cut into dashes, so it still reads as dashed. */
  const taper = !tapered ? null : dash.length > 0 ? taperedDashes(shaft, thin, thick, dash) : [taperedOutline(shaft, thin, thick)];
  return { shaft, taper, heads };
}

/* ------------------------------------------------------------------- teeth */

/** The part of segment a–b inside the box, as a parameter range, or null when it misses. */
function clipToBox(a: Pt, b: Pt, box: Box): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dy, a.y - box.minY],
    [dy, box.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

function tooth(at: Pt, dir: Pt, side: 1 | -1, size: number, shape: "triangle" | "semicircle"): Pt[] {
  /* The left of the direction of travel, in screen space where y grows downward. */
  const out = { x: dir.y * side, y: -dir.x * side };
  const half = size / 2;
  const start = { x: at.x - dir.x * half, y: at.y - dir.y * half };
  const end = { x: at.x + dir.x * half, y: at.y + dir.y * half };
  if (shape === "triangle") return [start, { x: at.x + out.x * size * 0.9, y: at.y + out.y * size * 0.9 }, end];
  const polygon: Pt[] = [];
  for (let step = 0; step <= SEMICIRCLE_STEPS; step++) {
    const angle = (Math.PI * step) / SEMICIRCLE_STEPS;
    const along = -Math.cos(angle) * half;
    const away = Math.sin(angle) * half;
    polygon.push({ x: at.x + dir.x * along + out.x * away, y: at.y + dir.y * along + out.y * away });
  }
  return polygon;
}

/**
 * Teeth at a fixed spacing in CSS pixels along the screen polyline, so their
 * size and rhythm hold at every zoom. Only stations inside the viewport are
 * produced: zoomed far in, a front line can be hundreds of thousands of
 * pixels long.
 */
function teethAlong(
  points: readonly Pt[],
  options: { spacing: number; size: number; side: 1 | -1; shape: "triangle" | "semicircle" },
  viewport: Box,
): Pt[][] {
  const spacing = Math.max(4, options.spacing);
  const teeth: Pt[][] = [];
  let travelled = 0;
  for (const [a, b] of segments(points)) {
    const length = distance(a, b);
    if (length === 0) continue;
    const clip = clipToBox(a, b, viewport);
    if (clip) {
      const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      const first = Math.ceil((travelled + clip[0] * length - spacing / 2) / spacing);
      const last = Math.floor((travelled + clip[1] * length - spacing / 2) / spacing);
      for (let index = Math.max(0, first); index <= last; index++) {
        const along = spacing / 2 + index * spacing - travelled;
        teeth.push(tooth({ x: a.x + dir.x * along, y: a.y + dir.y * along }, dir, options.side, options.size, options.shape));
      }
    }
    travelled += length;
  }
  return teeth;
}

/* ------------------------------------------------------------- annotations */

function clipSegmentAtBox(from: Pt, to: Pt, box: Box): Pt | null {
  const inside = clipToBox(to, from, box);
  if (!inside) return null;
  const t = inside[1];
  if (t >= 1) return null;
  return { x: to.x + (from.x - to.x) * t, y: to.y + (from.y - to.y) * t };
}

export function leaderPath(anchor: Pt, text: PlacedText, shape: "straight" | "elbow"): Pt[] | null {
  const { box, centre } = text;
  const insideX = anchor.x >= box.minX && anchor.x <= box.maxX;
  const insideY = anchor.y >= box.minY && anchor.y <= box.maxY;
  if (insideX && insideY) return null;
  if (shape === "straight") {
    const edge = clipSegmentAtBox(anchor, centre, box);
    return edge ? [anchor, edge] : null;
  }
  if (insideX) return [anchor, { x: anchor.x, y: anchor.y < box.minY ? box.minY : box.maxY }];
  const sideX = anchor.x < box.minX ? box.minX : box.maxX;
  if (insideY) return [anchor, { x: sideX, y: anchor.y }];
  return [anchor, { x: anchor.x, y: centre.y }, { x: sideX, y: centre.y }];
}

/* ------------------------------------------------------------------- build */

function boxOfShape(parts: Iterable<Pt>, margin: number, text: PlacedText | null): Box {
  const box = emptyBox();
  for (const p of parts) growBox(box, p);
  const padded = padBox(box, margin);
  if (text) {
    growBox(padded, { x: text.box.minX, y: text.box.minY });
    growBox(padded, { x: text.box.maxX, y: text.box.maxY });
  }
  return padded;
}

/** Whole worlds to shift an item by so the copy nearest the view is the one drawn, even across the antimeridian. */
export function worldWrap(item: SceneItem, view: View): number {
  return Math.round(view.centreX - (item.box.minX + item.box.maxX) / 2);
}

export function buildShape(item: SceneItem, view: View): ScreenShape {
  const { feature, geometry, style } = item;
  const wrap = worldWrap(item, view);
  const project = (p: Pt) => view.project(p, wrap);
  const strokeWidth = style.stroke?.width ?? 0;

  if (geometry.kind === "area") {
    const rings = geometry.rings.map((ring) => ring.map(project));
    const outer = rings[0];
    const text = place(item.text, outer ? ringCentroid(outer) : null);
    return { kind: "area", rings, text, box: boxOfShape(rings.flat(), strokeWidth / 2 + 1, text) };
  }
  if (geometry.kind === "line") {
    const points = geometry.path.map(project);
    const text = place(item.text, midpoint(points));
    return { kind: "line", points, text, box: boxOfShape(points, strokeWidth / 2 + 2, text) };
  }
  if (geometry.kind === "arrow" && feature.kind === "arrow") {
    const parts = arrowParts(geometry.curve.map(project), strokeWidth, feature.head, feature.tapered, style.stroke?.dash ?? []);
    const text = place(item.text, midpoint(parts.shaft));
    const all = [...parts.shaft, ...parts.heads.flat(), ...(parts.taper?.flat() ?? [])];
    return { kind: "arrow", ...parts, text, box: boxOfShape(all, strokeWidth + 2, text) };
  }
  if (geometry.kind === "frontline" && feature.kind === "frontline") {
    const points = geometry.path.map(project);
    const viewport = { minX: -feature.toothSize, minY: -feature.toothSize, maxX: view.width + feature.toothSize, maxY: view.height + feature.toothSize };
    const teeth = teethAlong(
      points,
      { spacing: feature.toothSpacing, size: feature.toothSize, side: feature.facing === "left" ? 1 : -1, shape: feature.toothShape },
      viewport,
    );
    const text = place(item.text, midpoint(points));
    return { kind: "frontline", points, teeth, text, box: boxOfShape(points, strokeWidth / 2 + feature.toothSize + 2, text) };
  }
  if (geometry.kind === "point" && feature.kind === "point") {
    const centre = project(geometry.at);
    const radius = Math.max(4, feature.size / 2);
    const text = place(item.text, item.text ? { x: centre.x, y: centre.y + radius + LABEL_GAP + item.text.height / 2 } : null);
    return { kind: "point", centre, radius, text, box: boxOfShape([centre], radius + 3, text) };
  }
  if (geometry.kind === "annotation" && feature.kind === "annotation") {
    const anchor = project(geometry.anchor);
    const text = place(item.text, project(geometry.textAt));
    const leader = feature.leader && text ? leaderPath(anchor, text, feature.leader.shape) : null;
    const dot = feature.leader?.anchorDot === true;
    const reach = leader || dot ? [anchor] : [];
    return { kind: "annotation", anchor, leader, dot, text, box: boxOfShape(reach, ANCHOR_DOT_RADIUS + 3, text) };
  }
  /* Geometry and feature kinds always agree; this keeps the function total without an assertion. */
  return { kind: "line", points: [], text: null, box: boxOf([]) };
}
