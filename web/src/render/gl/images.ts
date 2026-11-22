import type { PointFeature } from "@/model/types";
import { paintGlyph } from "../icons";
import type { Pt } from "../geo";
import { fontFamilies, fontSpec, paintText, requestFont, textBox, type TextBlock, type TextColors } from "../text";

/**
 * Everything drawn from the atlas: labels, notes, marker glyphs and numbers.
 * The browser rasterises each one with the same canvas code the 2D renderer
 * used (`paintText`, `paintGlyph`), so Arabic is shaped and joined by the
 * browser in the interface typefaces, exactly as before. An entry knows its
 * size in device pixels and where its top-left corner sits relative to the
 * point it is drawn at; the GPU snaps that point to a whole device pixel.
 */
export interface ImageEntry {
  id: number;
  key: string;
  width: number;
  height: number;
  /** Device pixels from the anchor's snapped pixel to the entry's top-left corner. */
  originX: number;
  originY: number;
  /** Where within its pixel the anchor was when the entry was rasterised. */
  phaseX: number;
  phaseY: number;
  /** Paints the entry with its top-left corner at (x, y) device pixels of the context. */
  draw(context: CanvasRenderingContext2D, x: number, y: number): void;
}

const NO_PHASE: Pt = { x: 0, y: 0 };
/** Sub-pixel phases are kept to 1/256 pixel: the browser rounds glyph baselines, so a coarser step flips that rounding. */
const PHASE_STEPS = 256;

/** Where a device-pixel position falls within its pixel, to the nearest 1/256. */
export function phaseOf(device: Pt): Pt {
  const fraction = (value: number) => {
    const q = Math.round((value - Math.floor(value)) * PHASE_STEPS) / PHASE_STEPS;
    return q >= 1 ? 0 : q;
  };
  return { x: fraction(device.x), y: fraction(device.y) };
}

/** Ids are stable for the registry's life. A new pixel ratio, palette or typeface starts a new registry. */
export class ImageRegistry {
  private readonly byKey = new Map<string, ImageEntry>();
  readonly entries: ImageEntry[] = [];

  constructor(readonly pixelRatio: number) {}

  get(id: number): ImageEntry | undefined {
    return this.entries[id];
  }

  /**
   * `phase` is where, within its device pixel, the anchor falls (0–1 on each
   * axis): the entry is drawn that far into the pixel the GPU snaps the anchor
   * to, so text laid out for a view lands exactly where the 2D canvas put it.
   */
  private add(key: string, box: { minX: number; minY: number; maxX: number; maxY: number }, paint: (context: CanvasRenderingContext2D) => void, phase: Pt = NO_PHASE): ImageEntry {
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const pr = this.pixelRatio;
    const originX = Math.floor(box.minX * pr);
    const originY = Math.floor(box.minY * pr);
    const width = Math.max(1, Math.ceil(box.maxX * pr) - originX + (phase.x > 0 ? 1 : 0));
    const height = Math.max(1, Math.ceil(box.maxY * pr) - originY + (phase.y > 0 ? 1 : 0));
    const entry: ImageEntry = {
      id: this.entries.length,
      key,
      width,
      height,
      originX,
      originY,
      phaseX: phase.x,
      phaseY: phase.y,
      draw: (context, x, y) => {
        context.setTransform(pr, 0, 0, pr, x - originX + phase.x, y - originY + phase.y);
        paint(context);
      },
    };
    this.entries.push(entry);
    this.byKey.set(key, entry);
    return entry;
  }

  /** A text block centred on its anchor, with its box or halo, for an anchor at `phase` within its device pixel. */
  text(block: TextBlock, colors: TextColors, phase: Pt = NO_PHASE): ImageEntry {
    const box = textBox(block, { x: 0, y: 0 });
    /* The halo is stroked on the glyph outlines and reaches half its width past the text box. */
    const margin = (block.style.halo && !block.style.box ? Math.max(3, block.size * 0.3) / 2 : 0.5) + 1.5;
    const key = `t|${phase.x}|${phase.y}|${block.font}|${block.dir}|${block.align}|${block.width}|${block.lineHeight}|${block.style.css}|${block.style.halo}|${block.style.box}|${colors.halo}|${colors.boxFill}|${colors.boxEdge}|${block.lines.join("\n")}`;
    return this.add(key, { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin }, (context) =>
      paintText(context, block, { x: 0, y: 0 }, colors),
      phase,
    );
  }

  /** What sits on a marker's disc: an icon or a number of up to three digits. */
  markerSymbol(symbol: PointFeature["symbol"], radius: number, ink: string): ImageEntry {
    const reach = radius * 1.6 + 2;
    const box = { minX: -reach, minY: -reach, maxX: reach, maxY: reach };
    if ("icon" in symbol) {
      return this.add(`i|${symbol.icon}|${radius}|${ink}`, box, (context) => paintGlyph(context, symbol.icon, 0, 0, radius * 2, ink));
    }
    const label = symbol.number.slice(0, 3);
    const size = radius * ([1.2, 1.2, 1.02, 0.8][label.length] ?? 0.8);
    const font = fontSpec(fontFamilies().ui, size, 600);
    void requestFont(font, label);
    return this.add(`n|${label}|${font}|${ink}`, box, (context) => {
      context.font = font;
      context.direction = "ltr";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = ink;
      context.fillText(label, 0, size * 0.04);
    });
  }
}

/** Distinct dash patterns, one row each in a small float texture: [count, period, lengths…]. */
export class DashRegistry {
  static readonly WIDTH = 64;
  private readonly rows = new Map<string, number>();
  data = new Float32Array(DashRegistry.WIDTH);
  version = 0;

  row(dash: readonly number[]): number {
    const lengths = dash.slice(0, DashRegistry.WIDTH - 2);
    if (lengths.length % 2 === 1) lengths.pop();
    const key = lengths.join(",");
    const known = this.rows.get(key);
    if (known !== undefined) return known;
    const row = this.rows.size;
    const needed = (row + 1) * DashRegistry.WIDTH;
    if (needed > this.data.length) {
      const next = new Float32Array(Math.max(needed, this.data.length * 2));
      next.set(this.data);
      this.data = next;
    }
    const o = row * DashRegistry.WIDTH;
    this.data[o] = lengths.length;
    this.data[o + 1] = lengths.reduce((sum, length) => sum + length, 0);
    lengths.forEach((length, index) => (this.data[o + 2 + index] = length));
    this.rows.set(key, row);
    this.version++;
    return row;
  }

  get height(): number {
    return Math.max(1, this.rows.size);
  }
}
