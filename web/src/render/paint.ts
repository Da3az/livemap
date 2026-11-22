import type { PointFeature } from "@/model/types";
import { toCss } from "./color";
import type { Pt } from "./geo";
import { paintGlyph } from "./icons";
import type { Palette } from "./palette";
import type { PatternCache } from "./patterns";
import type { SceneItem } from "./scene";
import { ANCHOR_DOT_RADIUS, type ScreenShape } from "./shapes";
import type { FeatureStyle, ResolvedFill, ResolvedMarker, ResolvedStroke } from "./style";
import { fontFamilies, fontSpec, paintText, requestFont, type TextColors } from "./text";

export interface PaintEnv {
  palette: Palette;
  patterns: PatternCache;
  pixelRatio: number;
  /** Screen position of a fixed map point; patterns are pinned to it. */
  patternOrigin: Pt;
}

const CASING_EXTRA = 2;
/** With a pattern, the colour underneath is a light wash and the marks carry the weight. */
const PATTERN_WASH = 0.35;
const PATTERN_GAIN = 2;

export function textColors(palette: Palette): TextColors {
  return { halo: toCss(palette.halo, 1), boxFill: toCss(palette.halo, 0.95), boxEdge: toCss(palette.rule, 1) };
}

function tracePolyline(context: CanvasRenderingContext2D, points: readonly Pt[], close = false): void {
  let started = false;
  for (const p of points) {
    if (started) context.lineTo(p.x, p.y);
    else context.moveTo(p.x, p.y);
    started = true;
  }
  if (close && started) context.closePath();
}

function tracePolygons(context: CanvasRenderingContext2D, polygons: readonly (readonly Pt[])[]): void {
  context.beginPath();
  for (const polygon of polygons) tracePolyline(context, polygon, true);
}

export function paintFill(context: CanvasRenderingContext2D, fill: ResolvedFill, env: PaintEnv): void {
  if (fill.opacity <= 0) return;
  if (fill.pattern === "none") {
    context.globalAlpha = fill.opacity;
    context.fillStyle = fill.css;
    context.fill("evenodd");
    return;
  }
  context.globalAlpha = fill.opacity * PATTERN_WASH;
  context.fillStyle = fill.css;
  context.fill("evenodd");
  const pattern = env.patterns.get(context, fill.pattern, fill.css, env.pixelRatio, env.patternOrigin);
  if (pattern) {
    context.globalAlpha = Math.min(1, fill.opacity * PATTERN_GAIN);
    context.fillStyle = pattern;
    context.fill("evenodd");
  }
}

/** Strokes the current path, with the casing underneath when the colour needs one. */
export function paintStroke(context: CanvasRenderingContext2D, stroke: ResolvedStroke, options: { casing: boolean; squareEnds?: boolean }): void {
  if (stroke.width <= 0 || stroke.opacity <= 0) return;
  context.lineJoin = "round";
  const square = options.squareEnds === true || stroke.dash.length > 0;
  context.lineCap = stroke.roundCaps || !square ? "round" : "butt";
  context.setLineDash(stroke.dash);
  context.globalAlpha = stroke.opacity;
  if (options.casing && stroke.casing) {
    context.lineWidth = stroke.width + CASING_EXTRA;
    context.strokeStyle = stroke.casing;
    context.stroke();
  }
  context.lineWidth = stroke.width;
  context.strokeStyle = stroke.css;
  context.stroke();
  context.setLineDash([]);
}

/** Fills the current path in the stroke's colour: arrow heads, tapered shafts and teeth. */
function paintSolid(context: CanvasRenderingContext2D, stroke: ResolvedStroke): void {
  if (stroke.opacity <= 0) return;
  context.globalAlpha = stroke.opacity;
  if (stroke.casing) {
    context.lineJoin = "round";
    context.lineWidth = CASING_EXTRA;
    context.strokeStyle = stroke.casing;
    context.stroke();
  }
  context.fillStyle = stroke.css;
  context.fill();
}

export function paintMarker(
  context: CanvasRenderingContext2D,
  marker: ResolvedMarker,
  symbol: PointFeature["symbol"],
  centre: Pt,
  radius: number,
): void {
  context.beginPath();
  context.arc(centre.x, centre.y, radius + 1.5, 0, Math.PI * 2);
  context.fillStyle = marker.ring;
  context.fill();
  context.beginPath();
  context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  context.fillStyle = marker.css;
  context.fill();
  if ("icon" in symbol) {
    paintGlyph(context, symbol.icon, centre.x, centre.y, radius * 2, marker.ink);
    return;
  }
  const label = symbol.number.slice(0, 3);
  const size = radius * ([1.2, 1.2, 1.02, 0.8][label.length] ?? 0.8);
  const font = fontSpec(fontFamilies().ui, size, 600);
  void requestFont(font, label);
  context.font = font;
  context.direction = "ltr";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = marker.ink;
  context.fillText(label, centre.x, centre.y + size * 0.04);
}

function paintLeader(context: CanvasRenderingContext2D, shape: Extract<ScreenShape, { kind: "annotation" }>, style: FeatureStyle, env: PaintEnv): void {
  const halo = toCss(env.palette.halo, 1);
  if (shape.leader) {
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    tracePolyline(context, shape.leader);
    context.lineWidth = 3.5;
    context.strokeStyle = halo;
    context.stroke();
    context.lineWidth = 1.25;
    context.strokeStyle = style.text.css;
    context.stroke();
  }
  if (shape.dot) {
    context.beginPath();
    context.arc(shape.anchor.x, shape.anchor.y, ANCHOR_DOT_RADIUS + 1.25, 0, Math.PI * 2);
    context.fillStyle = halo;
    context.fill();
    context.beginPath();
    context.arc(shape.anchor.x, shape.anchor.y, ANCHOR_DOT_RADIUS, 0, Math.PI * 2);
    context.fillStyle = style.text.css;
    context.fill();
  }
}

/**
 * Paints one feature's geometry on a 2D canvas: the legend's swatches, on
 * screen and on exported images. The map itself is drawn by the WebGL layer
 * (gl/), whose primitives follow these operations one for one.
 */
export function paintShape(context: CanvasRenderingContext2D, item: SceneItem, shape: ScreenShape, env: PaintEnv): void {
  const { style, feature } = item;
  context.save();
  switch (shape.kind) {
    case "area": {
      tracePolygons(context, shape.rings);
      if (style.fill) paintFill(context, style.fill, env);
      const outlined = style.stroke !== null && style.stroke.width > 0 && style.stroke.opacity > 0;
      if (style.stroke && outlined) {
        paintStroke(context, style.stroke, { casing: false });
      } else if (style.fill?.outline && style.fill.opacity > 0) {
        context.globalAlpha = 1;
        context.lineWidth = 1;
        context.strokeStyle = style.fill.outline;
        context.stroke();
      }
      break;
    }
    case "line":
      if (style.stroke) {
        context.beginPath();
        tracePolyline(context, shape.points);
        paintStroke(context, style.stroke, { casing: true });
      }
      break;
    case "arrow":
      if (style.stroke) {
        if (shape.taper) {
          tracePolygons(context, shape.taper);
          paintSolid(context, style.stroke);
        } else {
          context.beginPath();
          tracePolyline(context, shape.shaft);
          /* A round cap would poke out beside the head, so the shaft ends square. */
          paintStroke(context, style.stroke, { casing: true, squareEnds: true });
        }
        if (shape.heads.length > 0) {
          tracePolygons(context, shape.heads);
          paintSolid(context, style.stroke);
        }
      }
      break;
    case "frontline":
      if (style.stroke) {
        context.beginPath();
        tracePolyline(context, shape.points);
        paintStroke(context, style.stroke, { casing: true });
        if (shape.teeth.length > 0) {
          tracePolygons(context, shape.teeth);
          paintSolid(context, style.stroke);
        }
      }
      break;
    case "point":
      if (style.marker && feature.kind === "point") paintMarker(context, style.marker, feature.symbol, shape.centre, shape.radius);
      break;
    case "annotation":
      paintLeader(context, shape, style, env);
      if (shape.text) paintText(context, shape.text.block, shape.text.centre, textColors(env.palette));
      break;
  }
  context.restore();
}

/** The outline of what is drawn, as the current path, for showing selection. */
export function traceOutline(context: CanvasRenderingContext2D, shape: ScreenShape): void {
  context.beginPath();
  switch (shape.kind) {
    case "area":
      for (const ring of shape.rings) tracePolyline(context, ring, true);
      break;
    case "line":
      tracePolyline(context, shape.points);
      break;
    case "frontline":
      tracePolyline(context, shape.points);
      break;
    case "arrow":
      tracePolyline(context, shape.shaft);
      for (const head of shape.heads) tracePolyline(context, head, true);
      break;
    case "point":
      context.arc(shape.centre.x, shape.centre.y, shape.radius + 4, 0, Math.PI * 2);
      break;
    case "annotation":
      if (shape.leader) tracePolyline(context, shape.leader);
      if (shape.text) {
        const { box } = shape.text;
        context.rect(box.minX - 2, box.minY - 2, box.maxX - box.minX + 4, box.maxY - box.minY + 4);
      }
      break;
  }
}
