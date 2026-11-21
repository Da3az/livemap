import type { MapFeature, MapSettings } from "@/model/types";
import type { Box, Pt } from "./geo";
import { paintShape, type PaintEnv } from "./paint";
import type { Palette } from "./palette";
import type { PatternCache } from "./patterns";
import { buildSceneItem } from "./scene";
import type { ScreenShape } from "./shapes";

export const SWATCH_WIDTH = 30;
export const SWATCH_HEIGHT = 18;

/**
 * A miniature of the sample feature's screen shape, laid out inside a swatch.
 * `forward` is +1 when the layout runs left to right and -1 when mirrored, so
 * an arrow's head points the way the reader reads.
 */
function swatchShape(sample: MapFeature, box: Box, forward: 1 | -1): ScreenShape {
  const midY = (box.minY + box.maxY) / 2;
  const startX = forward === 1 ? box.minX + 1 : box.maxX - 1;
  const endX = forward === 1 ? box.maxX - 1 : box.minX + 1;
  const start: Pt = { x: startX, y: midY };
  const end: Pt = { x: endX, y: midY };
  const base = { box, text: null };
  switch (sample.kind) {
    case "area":
      return {
        ...base,
        kind: "area",
        rings: [
          [
            { x: box.minX + 1, y: box.minY + 1 },
            { x: box.maxX - 1, y: box.minY + 1 },
            { x: box.maxX - 1, y: box.maxY - 1 },
            { x: box.minX + 1, y: box.maxY - 1 },
          ],
        ],
      };
    case "line":
      return { ...base, kind: "line", points: [start, end] };
    case "arrow": {
      const length = 8;
      const tip = end;
      const back = { x: tip.x - forward * length, y: midY };
      const heads = sample.head === "none" ? [] : [[tip, { x: back.x, y: midY - 4.5 }, { x: back.x, y: midY + 4.5 }]];
      return { ...base, kind: "arrow", shaft: [start, sample.head === "none" ? end : { x: back.x + forward, y: midY }], taper: null, heads };
    }
    case "frontline": {
      const lineY = midY + 3;
      const size = 6;
      const tooth = (x: number): Pt[] =>
        sample.toothShape === "triangle"
          ? [
              { x: x - size / 2, y: lineY },
              { x, y: lineY - size * 0.9 },
              { x: x + size / 2, y: lineY },
            ]
          : Array.from({ length: 9 }, (_, step) => {
              const angle = (Math.PI * step) / 8;
              return { x: x - (Math.cos(angle) * size) / 2, y: lineY - (Math.sin(angle) * size) / 2 };
            });
      const third = (box.maxX - box.minX) / 3;
      return {
        ...base,
        kind: "frontline",
        points: [
          { x: startX, y: lineY },
          { x: endX, y: lineY },
        ],
        teeth: [tooth(box.minX + third * 0.75), tooth(box.minX + third * 2.25)],
      };
    }
    case "point":
      return { ...base, kind: "point", centre: { x: (box.minX + box.maxX) / 2, y: midY }, radius: (box.maxY - box.minY) / 2 - 1 };
    case "annotation":
      return { ...base, kind: "annotation", anchor: start, leader: [start, end], dot: true };
  }
}

/** Paints a legend swatch with the same code that paints the feature on the map. */
export function paintSwatch(
  context: CanvasRenderingContext2D,
  sample: MapFeature,
  settings: MapSettings,
  palette: Palette,
  patterns: PatternCache,
  options: { box: Box; pixelRatio: number; forward: 1 | -1 },
): void {
  const item = buildSceneItem({ ...sample, label: undefined }, settings, palette);
  const env: PaintEnv = { palette, patterns, pixelRatio: options.pixelRatio, patternOrigin: { x: options.box.minX, y: options.box.minY } };
  paintShape(context, item, swatchShape(sample, options.box, options.forward), env);
}
