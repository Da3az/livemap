import earcut from "earcut";
import type { FillPattern } from "@/model/types";
import { parseColor } from "../color";
import type { Pt } from "../geo";
import { textColors } from "../paint";
import type { Palette } from "../palette";
import type { SceneItem } from "../scene";
import { ANCHOR_DOT_RADIUS, type ScreenShape } from "../shapes";
import type { ResolvedStroke } from "../style";
import type { TextBlock } from "../text";
import type { DashRegistry, ImageRegistry } from "./images";
import { packColor, PrimMode, SEG_END_BUTT, SEG_ROUND_DASH, SEG_SCALED_PHASE, SEG_START_BUTT, SEG_TRIMMED, type PrimBuffer } from "./prims";

/**
 * Turns features into primitives, one paint operation of the 2D renderer at
 * a time and in the same order: the same colours, opacities, widths, caps,
 * joins, casings and dash patterns. Everything is emitted in mercator; what
 * the 2D renderer computed in screen pixels (arrow heads, tapers, teeth,
 * leaders, label places) arrives as a screen shape and is carried back to
 * mercator through the camera it was built for.
 */

export interface EmitContext {
  palette: Palette;
  images: ImageRegistry;
  dashes: DashRegistry;
  /** Mercator → CSS pixels for the view being built, for dash phases. Null behind the eye. */
  project: (p: Pt) => Pt | null;
  /**
   * The sub-pixel phase to rasterise a feature's text at, for text anchored at
   * a point of the shapes' screen coordinates.
   */
  textPhase: (screen: Pt, id: string) => Pt;
}

/** Segments never span more than this in mercator, so every vertex near the view is near the GPU's origin. */
const MAX_SPAN = 2 ** -13;
const CASING_EXTRA = 2;
const PATTERN_WASH = 0.35;
const PATTERN_GAIN = 2;
const PATTERN_LAYER: Record<Exclude<FillPattern, "none">, number> = { hatch: 1, cross: 2, dots: 3 };

type Rgba4 = [number, number, number, number];

const parsed = new Map<string, { r: number; g: number; b: number; a: number }>();

function rgba(css: string, opacity = 1): Rgba4 {
  let color = parsed.get(css);
  if (!color) {
    color = parseColor(css) ?? { r: 128, g: 128, b: 128, a: 1 };
    if (parsed.size > 4096) parsed.clear();
    parsed.set(css, color);
  }
  return [color.r, color.g, color.b, color.a * opacity];
}

function same(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Drops repeated points and the closing duplicate of a ring, then splits long spans. */
function prepare(points: readonly Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = out[out.length - 1];
    if (!last || !same(last, p)) out.push(p);
  }
  if (closed && out.length > 1 && same(out[0]!, out[out.length - 1]!)) out.pop();
  const dense: Pt[] = [];
  const count = closed ? out.length : out.length - 1;
  for (let index = 0; index < out.length; index++) {
    const a = out[index]!;
    dense.push(a);
    if (index >= count) continue;
    const b = out[(index + 1) % out.length]!;
    const pieces = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / MAX_SPAN);
    for (let piece = 1; piece < pieces; piece++) dense.push({ x: a.x + ((b.x - a.x) * piece) / pieces, y: a.y + ((b.y - a.y) * piece) / pieces });
  }
  return dense;
}

export interface StrokeOptions {
  width: number;
  color: Rgba4;
  /** Dash and gap lengths in CSS pixels; empty for solid. */
  dash: readonly number[];
  /** The line cap: butt or round. */
  butt: boolean;
  /**
   * Without pitch: let the GPU take the dash phase from each segment's
   * cumulative mercator distance at this zoom's scale, so the stroke is built
   * once. `trimmed` also cuts the path where the feature's per-zoom trim says.
   */
  scaled?: boolean;
  trimmed?: boolean;
}

/** Strokes a path with round joins, as `context.stroke()` does after `lineJoin = "round"`. */
export function stroke(buffer: PrimBuffer, points: readonly Pt[], closed: boolean, options: StrokeOptions, context: EmitContext): void {
  if (options.width <= 0 || options.color[3] <= 0) return;
  const pts = prepare(points, closed);
  const n = pts.length;
  if (n < 2) return;
  const color = packColor(options.color);
  const dashed = options.dash.length > 1 && options.dash.some((length) => length > 0);
  const dashRow = dashed ? context.dashes.row(options.dash) : -1;
  const period = dashed ? options.dash.reduce((sum, length) => sum + length, 0) : 0;
  const scaled = options.scaled === true;
  const flags =
    (options.butt ? SEG_START_BUTT | SEG_END_BUTT : 0) |
    (dashed && !options.butt ? SEG_ROUND_DASH : 0) |
    (scaled ? SEG_SCALED_PHASE : 0) |
    (options.trimmed ? SEG_TRIMMED : 0);
  const segments = closed ? n : n - 1;
  let travelled = 0;
  let along = 0;
  let previousScreen = dashed && !scaled ? context.project(pts[0]!) : null;
  for (let index = 0; index < segments; index++) {
    const a = pts[index]!;
    const b = pts[(index + 1) % n]!;
    const prev = closed ? pts[(index - 1 + n) % n]! : index > 0 ? pts[index - 1]! : null;
    const next = closed ? pts[(index + 2) % n]! : index < n - 2 ? pts[index + 2]! : null;
    const phase = dashed && !scaled ? travelled % period : 0;
    buffer.segment(a, b, closed && n === 2 ? null : prev, closed && n === 2 ? null : next, options.width / 2, color, flags, dashRow, phase, along);
    along += Math.hypot(b.x - a.x, b.y - a.y);
    if (dashed && !scaled) {
      const screen = context.project(b);
      if (screen && previousScreen) travelled += Math.hypot(screen.x - previousScreen.x, screen.y - previousScreen.y);
      previousScreen = screen;
    }
  }
}

function signedArea(ring: readonly Pt[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** The anti-aliased outer edges of a filled region. `inside` is true when the region lies inside the ring. */
function fringeRing(buffer: PrimBuffer, ring: readonly Pt[], inside: boolean, color: number, paint: number): void {
  const area = signedArea(ring);
  if (area === 0) return;
  /* With a positive shoelace sum the left normal (−dy, dx) points into the ring. */
  const side = (area > 0) === inside ? -1 : 1;
  for (let index = 0; index < ring.length; index++) buffer.fringe(ring[index]!, ring[(index + 1) % ring.length]!, side, color, paint);
}

/** Fills rings even-odd (first ring outer, the rest holes), as `context.fill("evenodd")`. */
export function fillRings(buffer: PrimBuffer, rings: readonly (readonly Pt[])[], color: Rgba4, paint: number): void {
  if (color[3] <= 0) return;
  const prepared = rings.map((ring) => prepare(ring, true)).filter((ring) => ring.length >= 3);
  const outer = prepared[0];
  if (!outer) return;
  const ox = outer[0]!.x;
  const oy = outer[0]!.y;
  const flat: number[] = [];
  const holes: number[] = [];
  const all: Pt[] = [];
  prepared.forEach((ring, index) => {
    if (index > 0) holes.push(all.length);
    for (const p of ring) {
      flat.push(p.x - ox, p.y - oy);
      all.push(p);
    }
  });
  const packed = packColor(color);
  /* Which ring each vertex is on and where, to tell outline edges from earcut's diagonals. */
  const ringOf: number[] = [];
  const startOf: number[] = [];
  prepared.forEach((ring, index) => {
    const start = ringOf.length;
    for (let k = 0; k < ring.length; k++) {
      ringOf.push(index);
      startOf.push(start);
    }
  });
  const onOutline = (i: number, j: number) => {
    if (ringOf[i] !== ringOf[j]) return false;
    const length = prepared[ringOf[i]!]!.length;
    const step = (((j - startOf[j]!) - (i - startOf[i]!)) % length + length) % length;
    return step === 1 || step === length - 1;
  };
  const triangles = earcut(flat, holes.length > 0 ? holes : null, 2);
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const [i, j, k] = [triangles[index]!, triangles[index + 1]!, triangles[index + 2]!];
    const outline = (onOutline(i, j) ? 1 : 0) | (onOutline(j, k) ? 2 : 0) | (onOutline(k, i) ? 4 : 0);
    buffer.triangle(all[i]!, all[j]!, all[k]!, packed, paint, outline);
  }
  prepared.forEach((ring, index) => fringeRing(buffer, ring, index === 0, packed, paint));
}

/**
 * Fills polygons nonzero, with the casing stroked first when the colour has
 * one: arrow heads, tapered shafts and their dashes, and teeth. A tapered
 * outline (an even count: one side out, the other back) is filled as a strip
 * of quads, which stays correct where a tight bend folds it over itself.
 */
function solid(buffer: PrimBuffer, polygons: readonly (readonly Pt[])[], strokeStyle: ResolvedStroke, context: EmitContext): void {
  if (strokeStyle.opacity <= 0) return;
  const shapes = polygons.map((polygon) => polygon.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).filter((polygon) => polygon.length >= 3);
  if (strokeStyle.casing) {
    for (const polygon of shapes) stroke(buffer, polygon, true, { width: CASING_EXTRA, color: rgba(strokeStyle.casing, strokeStyle.opacity), dash: [], butt: false }, context);
  }
  const color = packColor(rgba(strokeStyle.css, strokeStyle.opacity));
  for (const polygon of shapes) {
    const n = polygon.length;
    if (n % 2 === 0 && n >= 4) {
      const half = n / 2;
      for (let index = 0; index < half - 1; index++) {
        const l0 = polygon[index]!;
        const l1 = polygon[index + 1]!;
        const r0 = polygon[n - 1 - index]!;
        const r1 = polygon[n - 2 - index]!;
        buffer.triangle(l0, r0, l1, color, 0, (index === 0 ? 1 : 0) | 4);
        buffer.triangle(l1, r0, r1, color, 0, 2 | (index === half - 2 ? 4 : 0));
      }
    } else {
      for (let index = 1; index < n - 1; index++) {
        buffer.triangle(polygon[0]!, polygon[index]!, polygon[index + 1]!, color, 0, (index === 1 ? 1 : 0) | 2 | (index === n - 2 ? 4 : 0));
      }
    }
    /*
     * The fill's own anti-aliased edge, over the casing where there is one,
     * as the 2D canvas filled it. A lone triangle (a head, a tooth) carries
     * its edge itself; see the triangle branch of the vertex shader.
     */
    if (n !== 3) fringeRing(buffer, polygon, true, color, 0);
  }
}

/** A stroke with the casing underneath when the colour needs one; `paintStroke` in paint.ts. */
function cased(
  buffer: PrimBuffer,
  points: readonly Pt[],
  closed: boolean,
  s: ResolvedStroke,
  options: { casing: boolean; squareEnds?: boolean; scaled?: boolean; trimmed?: boolean },
  context: EmitContext,
): void {
  if (s.width <= 0 || s.opacity <= 0) return;
  const square = options.squareEnds === true || s.dash.length > 0;
  const butt = !(s.roundCaps || !square);
  const gpu = { scaled: options.scaled === true, trimmed: options.trimmed === true };
  if (options.casing && s.casing) stroke(buffer, points, closed, { width: s.width + CASING_EXTRA, color: rgba(s.casing, s.opacity), dash: s.dash, butt, ...gpu }, context);
  stroke(buffer, points, closed, { width: s.width, color: rgba(s.css, s.opacity), dash: s.dash, butt, ...gpu }, context);
}

/**
 * A front line's teeth, drawn by the GPU at this zoom's spacing along each
 * segment of the path: the casing round every tooth first, then the fills,
 * as the 2D renderer stroked and filled them.
 */
function teeth(buffer: PrimBuffer, path: readonly Pt[], feature: { toothSize: number; toothSpacing: number; facing: "left" | "right"; toothShape: "triangle" | "semicircle" }, s: ResolvedStroke): void {
  if (s.opacity <= 0) return;
  const pts = prepare(path, false);
  const side = feature.facing === "left" ? 1 : -1;
  const semicircle = feature.toothShape === "semicircle";
  const pass = (color: number, casing: boolean) => {
    let along = 0;
    for (let index = 0; index + 1 < pts.length; index++) {
      const a = pts[index]!;
      const b = pts[index + 1]!;
      buffer.teeth(a, b, along, feature.toothSize, feature.toothSpacing, side, semicircle, casing, color);
      along += Math.hypot(b.x - a.x, b.y - a.y);
    }
  };
  if (s.casing) pass(packColor(rgba(s.casing, s.opacity)), true);
  pass(packColor(rgba(s.css, s.opacity)), false);
}

/* ----------------------------------------------------------------- features */

/** True when what the feature draws depends on the zoom or turn: dash phases, arrow heads, teeth, leaders. */
export function isViewDependent(item: SceneItem): boolean {
  const { feature, style } = item;
  if (feature.kind === "arrow" || feature.kind === "annotation") return true;
  /* A front line's teeth always depend on the view; its stroke only when dashed. */
  if (feature.kind === "frontline") return true;
  return (style.stroke?.dash.length ?? 0) > 0 && feature.kind !== "point";
}

/** The part of an area that does not depend on the view: the fill and a solid outline. */
function areaFill(buffer: PrimBuffer, item: SceneItem, rings: readonly (readonly Pt[])[]): void {
  const fill = item.style.fill;
  if (!fill || fill.opacity <= 0) return;
  if (fill.pattern === "none") {
    fillRings(buffer, rings, rgba(fill.css, fill.opacity), 0);
    return;
  }
  fillRings(buffer, rings, rgba(fill.css, fill.opacity * PATTERN_WASH), 0);
  fillRings(buffer, rings, rgba(fill.css, Math.min(1, fill.opacity * PATTERN_GAIN)), PATTERN_LAYER[fill.pattern]);
}

function areaOutline(buffer: PrimBuffer, item: SceneItem, rings: readonly (readonly Pt[])[], context: EmitContext, scaled = false): void {
  const { stroke: s, fill } = item.style;
  const outlined = s !== null && s.width > 0 && s.opacity > 0;
  if (s && outlined) {
    for (const ring of rings) cased(buffer, ring, true, s, { casing: false, scaled }, context);
  } else if (fill?.outline && fill.opacity > 0) {
    for (const ring of rings) stroke(buffer, ring, true, { width: 1, color: rgba(fill.outline), dash: [], butt: false }, context);
  }
}

function marker(buffer: PrimBuffer, item: SceneItem, centre: Pt, radius: number, context: EmitContext): void {
  const { feature, style } = item;
  if (!style.marker || feature.kind !== "point") return;
  buffer.disc(centre, radius + 1.5, packColor(rgba(style.marker.ring)));
  buffer.disc(centre, radius, packColor(rgba(style.marker.css)));
  buffer.image(centre, context.images.markerSymbol(feature.symbol, radius, style.marker.ink).id);
}

export function textImage(block: TextBlock, screen: Pt, id: string, context: EmitContext): number {
  return context.images.text(block, textColors(context.palette), context.textPhase(screen, id)).id;
}

/**
 * What a feature draws that holds at every view, from its mercator geometry.
 * Areas, lines and markers are entirely here. Without pitch, so are dash
 * phases, front-line teeth and arrow shafts: the GPU derives them from this
 * zoom's scale (these instances are `PrimMode.Flat`; with pitch the per-view
 * part draws them instead).
 */
export function emitStatic(buffer: PrimBuffer, item: SceneItem, context: EmitContext): void {
  const { geometry, style, feature } = item;
  const dashed = (style.stroke?.dash.length ?? 0) > 0;
  const flat = (emit: () => void) => {
    buffer.mode = PrimMode.Flat;
    emit();
    buffer.mode = PrimMode.Both;
  };
  if (geometry.kind === "area") {
    areaFill(buffer, item, geometry.rings);
    if (!dashed) areaOutline(buffer, item, geometry.rings, context);
    else flat(() => areaOutline(buffer, item, geometry.rings, context, true));
    return;
  }
  if (geometry.kind === "line" && style.stroke) {
    if (!dashed) cased(buffer, geometry.path, false, style.stroke, { casing: true }, context);
    else flat(() => cased(buffer, geometry.path, false, style.stroke!, { casing: true, scaled: true }, context));
    return;
  }
  if (geometry.kind === "frontline" && feature.kind === "frontline" && style.stroke) {
    if (!dashed) cased(buffer, geometry.path, false, style.stroke, { casing: true }, context);
    flat(() => {
      if (dashed) cased(buffer, geometry.path, false, style.stroke!, { casing: true, scaled: true }, context);
      teeth(buffer, geometry.path, feature, style.stroke!);
    });
    return;
  }
  if (geometry.kind === "arrow" && feature.kind === "arrow" && style.stroke && !feature.tapered) {
    const s = style.stroke;
    flat(() => {
      /* The shaft, cut by the GPU where this zoom's heads begin; then the heads, casings first, as they were stroked and filled. */
      cased(buffer, geometry.curve, false, s, { casing: true, squareEnds: true, scaled: true, trimmed: true }, context);
      const tip = geometry.curve[geometry.curve.length - 1];
      const tail = geometry.curve[0];
      if (feature.head === "none" || !tip || !tail || s.opacity <= 0) return;
      const tips: [Pt, boolean][] = feature.head === "double" ? [[tip, true], [tail, false]] : [[tip, true]];
      if (s.casing) for (const [at, end] of tips) buffer.head(at, end, true, packColor(rgba(s.casing, s.opacity)));
      for (const [at, end] of tips) buffer.head(at, end, false, packColor(rgba(s.css, s.opacity)));
    });
    return;
  }
  if (geometry.kind === "point" && feature.kind === "point") marker(buffer, item, geometry.at, Math.max(4, feature.size / 2), context);
}

/**
 * What depends on the view, from the screen shape built for it. `toMerc`
 * carries screen points back through the camera that view used. `flat`
 * leaves out what the static part draws without pitch.
 */
export function emitView(buffer: PrimBuffer, item: SceneItem, shape: ScreenShape | null, toMerc: (p: Pt) => Pt, context: EmitContext, flat = false): void {
  const { geometry, style } = item;
  const merc = (points: readonly Pt[]) => points.map(toMerc);
  if (geometry.kind === "area") {
    if (!flat && (style.stroke?.dash.length ?? 0) > 0) areaOutline(buffer, item, geometry.rings, context);
    return;
  }
  if (geometry.kind === "line") {
    if (!flat && style.stroke && style.stroke.dash.length > 0) cased(buffer, geometry.path, false, style.stroke, { casing: true }, context);
    return;
  }
  if (!shape) return;
  if (shape.kind === "arrow" && style.stroke) {
    /* Without pitch an untapered arrow is entirely in the static part. */
    if (flat && item.feature.kind === "arrow" && !item.feature.tapered) return;
    if (shape.taper) solid(buffer, shape.taper.map(merc), style.stroke, context);
    else if (!flat) cased(buffer, merc(shape.shaft), false, style.stroke, { casing: true, squareEnds: true }, context);
    if (shape.heads.length > 0) solid(buffer, shape.heads.map(merc), style.stroke, context);
    return;
  }
  if (shape.kind === "frontline" && style.stroke) {
    if (flat) return;
    /* A solid stroke is in the static part (see `emitStatic`); a dashed one needs this view's phase. */
    if (style.stroke.dash.length > 0) cased(buffer, merc(shape.points), false, style.stroke, { casing: true }, context);
    if (shape.teeth.length > 0) solid(buffer, shape.teeth.map(merc), style.stroke, context);
    return;
  }
  if (shape.kind === "annotation") annotation(buffer, item, shape, toMerc, context);
}

function annotation(buffer: PrimBuffer, item: SceneItem, shape: Extract<ScreenShape, { kind: "annotation" }>, toMerc: (p: Pt) => Pt, context: EmitContext): void {
  const halo = rgba(`rgba(${context.palette.halo.r}, ${context.palette.halo.g}, ${context.palette.halo.b}, 1)`);
  const ink = rgba(item.style.text.css);
  if (shape.leader) {
    const leader = shape.leader.map(toMerc);
    stroke(buffer, leader, false, { width: 3.5, color: halo, dash: [], butt: false }, context);
    stroke(buffer, leader, false, { width: 1.25, color: ink, dash: [], butt: false }, context);
  }
  if (shape.dot) {
    const anchor = toMerc(shape.anchor);
    buffer.disc(anchor, ANCHOR_DOT_RADIUS + 1.25, packColor(halo));
    buffer.disc(anchor, ANCHOR_DOT_RADIUS, packColor(ink));
  }
  if (shape.text) buffer.image(toMerc(shape.text.centre), textImage(shape.text.block, shape.text.centre, item.feature.id, context));
}

/** Every part of a feature from one screen shape: the shape being drawn, which changes on every pointer move. */
export function emitWhole(buffer: PrimBuffer, item: SceneItem, shape: ScreenShape, toMerc: (p: Pt) => Pt, context: EmitContext): void {
  const merc = (points: readonly Pt[]) => points.map(toMerc);
  const { style, feature } = item;
  if (shape.kind === "area") {
    const rings = shape.rings.map(merc);
    areaFill(buffer, item, rings);
    areaOutline(buffer, item, rings, context);
  } else if (shape.kind === "line") {
    if (style.stroke) cased(buffer, merc(shape.points), false, style.stroke, { casing: true }, context);
  } else if (shape.kind === "point") {
    if (feature.kind === "point") marker(buffer, item, toMerc(shape.centre), shape.radius, context);
  } else if (shape.kind === "frontline") {
    if (style.stroke && style.stroke.dash.length === 0) cased(buffer, merc(shape.points), false, style.stroke, { casing: true }, context);
    emitView(buffer, item, shape, toMerc, context);
  } else {
    emitView(buffer, item, shape, toMerc, context);
  }
  if (shape.kind !== "annotation" && shape.text && !shape.labelHidden) buffer.image(toMerc(shape.text.centre), textImage(shape.text.block, shape.text.centre, item.feature.id, context));
}
