import type { MapFeature, MapSettings, RichText } from "@/model/types";
import { BASEMAP_ATTRIBUTION } from "./basemap";
import { toCss } from "./color";
import { formatAsOf, langForDir, legendEntries, scaleBar, sourceLine, type LegendEntry } from "./furniture";
import type { Palette } from "./palette";
import type { PatternCache } from "./patterns";
import { paintSwatch, SWATCH_HEIGHT, SWATCH_WIDTH } from "./swatch";
import { layRuns, runsSize, type LaidRun, type TextRun } from "./furniture-text";
import { fontFamilies, fontSpec, wrapText } from "./text";

export { loadFurnitureFonts } from "./furniture-text";

/**
 * The title block, legend, credits, scale bar and attribution of an exported
 * image, drawn on the canvas to match `MapTitleBlock`, `MapLegend`,
 * `MapCredits` and `ScaleBar`: the same model, the same typefaces, the same
 * hard-edged panels, mirrored for a right-to-left map.
 */
export interface FurnitureInput {
  /** Image size in CSS pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  title: RichText;
  settings: MapSettings;
  features: readonly MapFeature[];
  palette: Palette;
  patterns: PatternCache;
  dir: "ltr" | "rtl";
  metresPerPixel: number;
  /** The camera the image was made with. A tilted image has no single scale, so it gets no scale bar; a turned one gets a north arrow. */
  bearing?: number;
  pitch?: number;
  /**
   * Bands above and below the map, in CSS pixels, from `measureFurnitureBands`.
   * When given, the furniture is set in those bands on the panel colour and
   * never over the map, so it cannot hide a feature or an annotation.
   */
  bands?: FurnitureBands;
}

export interface FurnitureBands {
  top: number;
  bottom: number;
  /** Where the key goes in the bands: the author's corner unless another one makes the bands shorter. */
  legendPosition: LegendPosition;
}

type LegendPosition = MapSettings["legend"]["position"];
const POSITIONS: readonly LegendPosition[] = ["top-start", "top-end", "bottom-start", "bottom-end"];

const MARGIN = 16;
const PAD_X = 12;
const PAD_Y = 10;
const GAP = 8;
const ROW_GAP = 6;
const RADIUS = 4;
const COLUMN_GAP = 16;
const MAX_LEGEND_COLUMNS = 3;
/** In bands, the key takes at most this share of the image's height. */
const BAND_LEGEND_SHARE = 0.3;

class FurniturePainter {
  /** How far the furniture reaches in from the top and from the bottom of the image. */
  readonly extents = { top: 0, bottom: 0 };
  private readonly rtl: boolean;
  private readonly colors: { ink: string; soft: string; panel: string; rule: string };

  constructor(
    private readonly context: CanvasRenderingContext2D,
    private readonly input: FurnitureInput,
    private readonly measuring = false,
    private readonly legendPosition: LegendPosition | null = null,
  ) {
    this.rtl = input.dir === "rtl";
    const { palette } = input;
    this.colors = { ink: toCss(palette.ink, 1), soft: toCss(palette.inkSoft, 1), panel: toCss(palette.panel, 0.96), rule: toCss(palette.rule, 1) };
  }

  /** Left edge of a box of the given width sitting at the start or end side of the image. */
  private boxX(width: number, side: "start" | "end"): number {
    const atLeft = (side === "start") !== this.rtl;
    return atLeft ? MARGIN : this.input.width - MARGIN - width;
  }

  /** Records the space a box takes, for `measureFurnitureBands`. */
  private note(y: number, height: number): void {
    if (y + height / 2 < this.input.height / 2) this.extents.top = Math.max(this.extents.top, y + height);
    else this.extents.bottom = Math.max(this.extents.bottom, this.input.height - y);
  }

  private panel(x: number, y: number, width: number, height: number): void {
    const { context } = this;
    /* In bands the furniture sits on the band itself, as printed matter around the map. */
    if (this.input.bands) return;
    context.beginPath();
    context.roundRect(x + 0.5, y + 0.5, width - 1, height - 1, RADIUS);
    context.fillStyle = this.colors.panel;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = this.colors.rule;
    context.stroke();
  }

  /** Draws runs top-down inside a box, each line against the box's start edge. Returns the y below them. */
  private runs(runs: LaidRun[], x: number, y: number, width: number): number {
    const { context } = this;
    context.textBaseline = "middle";
    context.textAlign = this.rtl ? "right" : "left";
    const edge = this.rtl ? x + width : x;
    let cursor = y;
    for (const run of runs) {
      context.font = run.font;
      context.direction = run.dir;
      context.fillStyle = run.color;
      for (const line of run.lines) {
        context.fillText(line, edge, cursor + run.lineHeight / 2);
        cursor += run.lineHeight;
      }
    }
    return cursor;
  }

  private box(runs: LaidRun[], side: "start" | "end", y: number | { bottom: number }): { height: number } {
    const size = runsSize(runs);
    if (size.height === 0) return { height: 0 };
    const width = size.width + PAD_X * 2;
    const height = size.height + PAD_Y * 2;
    const x = this.boxX(width, side);
    const top = typeof y === "number" ? y : y.bottom - height;
    this.note(top, height);
    this.panel(x, top, width, height);
    this.runs(runs, x + PAD_X, top + PAD_Y, size.width);
    return { height };
  }

  private titleRuns(maxWidth: number): LaidRun[] {
    const { settings, title, dir } = this.input;
    const { ui, title: serif } = fontFamilies();
    const block = settings.titleBlock;
    const runs: TextRun[] = [{ text: title, font: fontSpec(serif, 23, 600), color: this.colors.ink, lineHeight: 28 }];
    if (block.subtitle) runs.push({ text: block.subtitle, font: fontSpec(ui, 13, 400), color: this.colors.soft, lineHeight: 18 });
    if (block.asOf) {
      runs.push({ text: { value: formatAsOf(block.asOf, langForDir(dir)), dir }, font: fontSpec(ui, 12, 500), color: this.colors.soft, lineHeight: 18 });
    }
    return layRuns(runs, maxWidth);
  }

  private creditRuns(maxWidth: number): LaidRun[] {
    const { settings, dir } = this.input;
    const block = settings.titleBlock;
    const font = fontSpec(fontFamilies().ui, 12, 400);
    const runs: TextRun[] = [];
    if (block.source) runs.push({ text: sourceLine(block.source, langForDir(dir)), font, color: this.colors.soft, lineHeight: 16 });
    if (block.credit) runs.push({ text: block.credit, font, color: this.colors.soft, lineHeight: 16 });
    if (block.note) runs.push({ text: block.note, font, color: this.colors.soft, lineHeight: 16 });
    return layRuns(runs, maxWidth);
  }

  /**
   * The key. Rows stack in one column while they fit the height its corner
   * leaves; past that they flow into up to three columns (filled top to bottom,
   * then across, in reading order), and a key still too tall is drawn smaller,
   * never off the image.
   */
  private legend(entries: LegendEntry[], top: Record<"start" | "end", number>, bottom: Record<"start" | "end", number>): void {
    const { settings, palette, patterns, pixelRatio } = this.input;
    const { ui, title: serif } = fontFamilies();
    const { context } = this;
    const position = this.input.bands?.legendPosition ?? this.legendPosition ?? settings.legend.position;
    const vertical = position.startsWith("top") ? "top" : "bottom";
    const side = position.endsWith("start") ? "start" : "end";
    const room = Math.max(80, this.input.height - top[side] - bottom[side]);
    /* Measured for bands, the key may take at most a share of the image, or the map would vanish. */
    const available = this.input.bands !== undefined || this.measuring ? Math.min(room, this.input.height * BAND_LEGEND_SHARE) : room;
    const maxWidth = this.input.width - MARGIN * 2;

    const maxLabel = Math.max(80, Math.min(220, this.input.width * 0.4));
    const heading = layRuns([{ text: settings.legend.title, font: fontSpec(serif, 15, 600), color: this.colors.ink, lineHeight: 20 }], maxLabel + SWATCH_WIDTH);
    const rows = entries.map((entry) => ({
      entry,
      label: layRuns([{ text: entry.label, font: fontSpec(ui, 13, 400), color: this.colors.ink, lineHeight: 17 }], maxLabel),
    }));
    const rowHeights = rows.map((row) => Math.max(SWATCH_HEIGHT, runsSize(row.label).height));
    const rowWidths = rows.map((row) => SWATCH_WIDTH + GAP + runsSize(row.label).width);
    const headingSize = runsSize(heading);
    const headingBlock = headingSize.height > 0 ? headingSize.height + ROW_GAP : 0;

    const columnsFor = (count: number): number[][] => {
      const perColumn = Math.ceil(rows.length / count);
      return Array.from({ length: count }, (_, column) => rows.map((_, index) => index).slice(column * perColumn, (column + 1) * perColumn)).filter((list) => list.length > 0);
    };
    const measure = (columns: number[][]) => {
      const heights = columns.map((list) => list.reduce((total, index) => total + (rowHeights[index] ?? 0), 0) + ROW_GAP * (list.length - 1));
      const widths = columns.map((list) => Math.max(0, ...list.map((index) => rowWidths[index] ?? 0)));
      const inner = Math.max(headingSize.width, widths.reduce((a, b) => a + b, 0) + COLUMN_GAP * (columns.length - 1));
      return { widths, inner, width: inner + PAD_X * 2, height: PAD_Y * 2 + headingBlock + Math.max(0, ...heights) };
    };
    let columns = columnsFor(1);
    let size = measure(columns);
    for (let count = 2; count <= MAX_LEGEND_COLUMNS && size.height > available; count++) {
      const next = columnsFor(count);
      const nextSize = measure(next);
      if (nextSize.width > maxWidth) break;
      columns = next;
      size = nextSize;
    }
    const scale = Math.min(1, available / size.height, maxWidth / size.width);

    const width = size.width * scale;
    const height = size.height * scale;
    const x = this.boxX(width, side);
    const y = vertical === "top" ? top[side] : this.input.height - bottom[side] - height;
    this.note(y, height);
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    this.panel(0, 0, size.width, size.height);
    const cursorTop = this.runs(heading, PAD_X, PAD_Y, size.inner) + (headingSize.height > 0 ? ROW_GAP : 0);
    let columnStart = 0;
    columns.forEach((list, column) => {
      const columnWidth = size.widths[column] ?? 0;
      /* Columns run from the start side: leftmost in LTR, rightmost in RTL. */
      const left = this.rtl ? size.inner + PAD_X - columnStart - columnWidth : PAD_X + columnStart;
      let cursor = cursorTop;
      for (const index of list) {
        const row = rows[index];
        if (!row) continue;
        const rowHeight = rowHeights[index] ?? SWATCH_HEIGHT;
        const swatchX = this.rtl ? left + columnWidth - SWATCH_WIDTH : left;
        const swatchY = cursor + (rowHeight - SWATCH_HEIGHT) / 2;
        paintSwatch(context, row.entry.sample, settings, palette, patterns, {
          box: { minX: swatchX, minY: swatchY, maxX: swatchX + SWATCH_WIDTH, maxY: swatchY + SWATCH_HEIGHT },
          pixelRatio: pixelRatio * scale,
          forward: this.rtl ? -1 : 1,
        });
        const labelX = this.rtl ? left : left + SWATCH_WIDTH + GAP;
        const labelHeight = runsSize(row.label).height;
        this.runs(row.label, labelX, cursor + (rowHeight - labelHeight) / 2, columnWidth - SWATCH_WIDTH - GAP);
        cursor += rowHeight + ROW_GAP;
      }
      columnStart += columnWidth + COLUMN_GAP;
    });
    context.restore();
  }

  /** The scale bar sits at the end side, above the attribution. Returns the height it used. */
  private scale(bottom: number): number {
    const { context, input } = this;
    const model = scaleBar(input.metresPerPixel, langForDir(input.dir));
    if (!model) return 0;
    const font = fontSpec(fontFamilies().ui, 11, 500);
    const label = wrapText({ value: model.label, dir: input.dir }, font, 400);
    const width = Math.max(model.width, label.width) + PAD_X;
    const height = 30;
    const x = this.boxX(width, "end");
    const y = input.height - bottom - height;
    this.note(y, height);
    this.panel(x, y, width, height);
    const barX = this.rtl ? x + width - PAD_X / 2 - model.width : x + PAD_X / 2;
    context.beginPath();
    context.moveTo(barX + 0.5, y + 19);
    context.lineTo(barX + 0.5, y + 24.5);
    context.lineTo(barX + model.width - 0.5, y + 24.5);
    context.lineTo(barX + model.width - 0.5, y + 19);
    context.lineWidth = 1.5;
    context.strokeStyle = this.colors.ink;
    context.stroke();
    this.runs([{ text: { value: model.label, dir: input.dir }, font, color: this.colors.ink, lineHeight: 14, ...label }], x + PAD_X / 2, y + 4, width - PAD_X);
    return height + GAP;
  }

  /** A small plate with an arrow to true north, for an image whose top is not north. Returns the height it used. */
  private north(bottom: number, bearing: number): number {
    const { context } = this;
    const size = 30;
    const x = this.boxX(size, "end");
    const y = this.input.height - bottom - size;
    this.note(y, size);
    this.panel(x, y, size, size);
    context.save();
    context.translate(x + size / 2, y + size / 2);
    context.rotate((-bearing * Math.PI) / 180);
    context.beginPath();
    context.moveTo(0, -11);
    context.lineTo(5, 3);
    context.lineTo(0, 0);
    context.lineTo(-5, 3);
    context.closePath();
    context.fillStyle = this.colors.ink;
    context.fill();
    context.font = fontSpec(fontFamilies().ui, 11, 600);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.direction = this.input.dir;
    context.fillText(this.rtl ? "ش" : "N", 0, 8);
    context.restore();
    return size + GAP;
  }

  /** Required on every image that shows the basemap. Returns the height it used. */
  attribution(): number {
    const { context, input } = this;
    const font = fontSpec(fontFamilies().ui, 11, 400);
    const laid = wrapText({ value: BASEMAP_ATTRIBUTION, dir: "ltr" }, font, input.width - MARGIN * 2 - 12);
    const lineHeight = 14;
    const width = laid.width + 12;
    const height = laid.lines.length * lineHeight + 6;
    const x = this.rtl ? 0 : input.width - width;
    const y = input.height - height;
    this.note(y, height);
    context.fillStyle = toCss(input.palette.panel, 0.85);
    context.fillRect(x, y, width, height);
    context.font = font;
    context.direction = "ltr";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = this.colors.soft;
    laid.lines.forEach((line, index) => context.fillText(line, x + 6, y + 3 + lineHeight * (index + 0.5)));
    return height + GAP;
  }

  paint(): void {
    const { input, context } = this;
    const { settings } = input;
    if (input.bands) {
      context.fillStyle = toCss(input.palette.panel, 1);
      context.fillRect(0, 0, input.width, input.bands.top);
      context.fillRect(0, input.height - input.bands.bottom, input.width, input.bands.bottom);
      context.fillStyle = this.colors.rule;
      if (input.bands.top > 0) context.fillRect(0, input.bands.top - 1, input.width, 1);
      if (input.bands.bottom > 0) context.fillRect(0, input.height - input.bands.bottom, input.width, 1);
    }
    const top = { start: MARGIN, end: MARGIN };
    const bottom = { start: MARGIN, end: MARGIN };
    const textWidth = Math.max(120, Math.min(440, input.width - MARGIN * 2 - PAD_X * 2));

    bottom.end = this.attribution();
    if (settings.embed.scaleBar && (input.pitch ?? 0) === 0) bottom.end += this.scale(bottom.end);
    if (Math.abs(input.bearing ?? 0) >= 0.5) bottom.end += this.north(bottom.end, input.bearing ?? 0);

    if (settings.titleBlock.show) {
      top.start += this.box(this.titleRuns(textWidth), "start", MARGIN).height + GAP;
      const credits = this.box(this.creditRuns(Math.min(textWidth, input.width * 0.5)), "start", { bottom: input.height - MARGIN });
      if (credits.height > 0) bottom.start += credits.height + GAP;
    }

    if (settings.legend.show) {
      const entries = legendEntries(settings, input.features);
      if (entries.length > 0) this.legend(entries, top, bottom);
    }
  }
}

/**
 * The bands the furniture needs above and below the map: a dry run of the
 * layout on a scratch canvas, recording how far it reaches from each edge.
 */
export function measureFurnitureBands(input: FurnitureInput): FurnitureBands {
  const scratch = document.createElement("canvas").getContext("2d");
  const own = input.settings.legend.position;
  if (!scratch) return { top: 0, bottom: 0, legendPosition: own };
  const measure = (legendPosition: LegendPosition): FurnitureBands => {
    const painter = new FurniturePainter(scratch, { ...input, bands: undefined }, true, legendPosition);
    painter.paint();
    const { top, bottom } = painter.extents;
    return { top: Math.ceil(top > 0 ? top + MARGIN / 2 : 0), bottom: Math.ceil(bottom > 0 ? bottom + MARGIN / 2 : 0), legendPosition };
  };
  /* The author's corner first; another corner only when it leaves the map clearly more room. */
  let best = measure(own);
  for (const position of POSITIONS) {
    if (position === own) continue;
    const candidate = measure(position);
    if (candidate.top + candidate.bottom < best.top + best.bottom - 8) best = candidate;
  }
  return best;
}

export function paintFurniture(context: CanvasRenderingContext2D, input: FurnitureInput): void {
  context.save();
  new FurniturePainter(context, input).paint();
  context.restore();
}

/** The basemap attribution alone, for an image exported without the rest of the furniture. */
export function paintAttribution(context: CanvasRenderingContext2D, input: FurnitureInput): void {
  context.save();
  new FurniturePainter(context, input).attribution();
  context.restore();
}
