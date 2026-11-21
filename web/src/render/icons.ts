import type { IconId } from "@/model/types";

/**
 * The event icon set: twelve glyphs on a 24-unit grid, each sitting inside
 * the central 14 units so it clears the disc it is drawn on. Strokes are 1.9
 * units with round ends; filled parts use the even-odd rule so a cut-out reads.
 */
export interface IconGlyph {
  fill?: string;
  stroke?: string;
}

export const ICON_GRID = 24;
export const ICON_STROKE = 1.9;

export const ICON_GLYPHS: Record<IconId, IconGlyph> = {
  /* a target: ring and four ticks */
  strike: { stroke: "M12 8.2a3.8 3.8 0 1 0 0 7.6a3.8 3.8 0 1 0 0-7.6M12 5v3.2M12 15.8V19M5 12h3.2M15.8 12H19" },
  /* an eight-pointed burst */
  explosion: {
    fill: "M12 4.6l1.5 3.8 3.7-1.6-1.6 3.7 3.8 1.5-3.8 1.5 1.6 3.7-3.7-1.6-1.5 3.8-1.5-3.8-3.7 1.6 1.6-3.7L4.6 12l3.8-1.5-1.6-3.7 3.7 1.6z",
  },
  /* a barrier on two posts */
  checkpoint: { fill: "M5 8.6h14v3.6H5z", stroke: "M8 12.2V18M16 12.2V18" },
  /* a roof over a doorway */
  shelter: { fill: "M12 5.4l7 6.2h-1.9V18H13.6v-3.6h-3.2V18H6.9v-6.4H5z" },
  /* a cross */
  hospital: { fill: "M10 5.5h4V10h4.5v4H14v4.5h-4V14H5.5v-4H10z" },
  /* three waves */
  flood: {
    stroke:
      "M5.2 8.6c1.2-1.4 2.2-1.4 3.4 0s2.2 1.4 3.4 0 2.2-1.4 3.4 0 2.2 1.4 3.4 0M5.2 12.4c1.2-1.4 2.2-1.4 3.4 0s2.2 1.4 3.4 0 2.2-1.4 3.4 0 2.2 1.4 3.4 0M5.2 16.2c1.2-1.4 2.2-1.4 3.4 0s2.2 1.4 3.4 0 2.2-1.4 3.4 0 2.2 1.4 3.4 0",
  },
  /* a flame */
  fire: { fill: "M12.4 4.8c.5 3 4.3 4.6 4.3 8.6a4.7 4.7 0 0 1-9.4 0c0-1.9.9-3.2 2-4.2.2 1.4.9 2.1 1.6 2.2-.5-2.5.2-4.8 1.5-6.6z" },
  /* an aircraft seen from above */
  airport: {
    fill: "M12 4.6c.8 0 1.2.9 1.2 1.9v3.3l5.6 3.4v1.7l-5.6-1.8v3.2l1.8 1.4v1.3L12 18.2l-3 .8v-1.3l1.8-1.4v-3.2l-5.6 1.8v-1.7l5.6-3.4V6.5c0-1 .4-1.9 1.2-1.9z",
  },
  /* an anchor */
  port: { stroke: "M12 5.4a1.7 1.7 0 1 0 0 3.4a1.7 1.7 0 1 0 0-3.4M12 8.8V18.4M8.6 11.4h6.8M5.8 13.4c0 3 2.8 5 6.2 5s6.2-2 6.2-5" },
  /* a tent with its opening cut out */
  camp: { fill: "M12 5.2L19.4 18.4H4.6zM12 11.6l-2.6 6.8h5.2z" },
  /* a parcel */
  aid: { stroke: "M5.6 9.2L12 6l6.4 3.2v6.4L12 18.8l-6.4-3.2zM5.6 9.2L12 12.4l6.4-3.2M12 12.4v6.4" },
  /* a plain dot, for anything the set has no picture for */
  pin: { fill: "M12 8.2a3.8 3.8 0 1 0 0 7.6a3.8 3.8 0 1 0 0-7.6" },
};

const compiled = new Map<IconId, { fill: Path2D | null; stroke: Path2D | null }>();

function compile(icon: IconId) {
  let paths = compiled.get(icon);
  if (!paths) {
    const glyph = ICON_GLYPHS[icon];
    paths = { fill: glyph.fill ? new Path2D(glyph.fill) : null, stroke: glyph.stroke ? new Path2D(glyph.stroke) : null };
    compiled.set(icon, paths);
  }
  return paths;
}

/** Draws a glyph centred on a point, scaled so the 24-unit grid spans `size` CSS pixels. */
export function paintGlyph(context: CanvasRenderingContext2D, icon: IconId, x: number, y: number, size: number, color: string): void {
  const paths = compile(icon);
  const scale = size / ICON_GRID;
  context.save();
  context.translate(x - size / 2, y - size / 2);
  context.scale(scale, scale);
  if (paths.fill) {
    context.fillStyle = color;
    context.fill(paths.fill, "evenodd");
  }
  if (paths.stroke) {
    context.strokeStyle = color;
    context.lineWidth = ICON_STROKE;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(paths.stroke);
  }
  context.restore();
}
