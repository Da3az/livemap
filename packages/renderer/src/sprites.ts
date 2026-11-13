// Sprites are drawn to a canvas at runtime, not shipped as a sheet: colour is
// per-feature, and MapLibre's `icon-color` only works on SDF images. Cached by
// (shape, colour, size).

export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly pixelRatio: number;
}

export interface ImageHost {
  hasImage(id: string): boolean;
  addImage(id: string, image: RasterImage, options?: { pixelRatio?: number }): void;
}

const DPR = 2;

function makeCanvas(size: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = size * DPR;
  canvas.height = size * DPR;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.scale(DPR, DPR);
  return { canvas, ctx };
}

function toRaster(canvas: HTMLCanvasElement): RasterImage {
  const ctx = canvas.getContext("2d")!;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8Array(d.data.buffer),
    pixelRatio: DPR,
  };
}

/**
 * Drawn pointing EAST (+x) — the convention `iconRotateForBearing` in
 * @livemap/core assumes when it subtracts 90 from a compass bearing.
 */
export function arrowheadImage(color: string, sizePx = 24): RasterImage {
  const { canvas, ctx } = makeCanvas(sizePx);
  const s = sizePx;

  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  // Barbed, not a plain triangle: the concave back edge still reads as an
  // arrow at small sizes.
  ctx.moveTo(s, s / 2);
  ctx.lineTo(s * 0.08, s * 0.1);
  ctx.lineTo(s * 0.34, s / 2);
  ctx.lineTo(s * 0.08, s * 0.9);
  ctx.closePath();
  ctx.fill();

  return toRaster(canvas);
}

/** Mid-shaft chevron, also pointing east. */
export function chevronImage(color: string, sizePx = 16): RasterImage {
  const { canvas, ctx } = makeCanvas(sizePx);
  const s = sizePx;

  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.14);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(s * 0.3, s * 0.2);
  ctx.lineTo(s * 0.74, s / 2);
  ctx.lineTo(s * 0.3, s * 0.8);
  ctx.stroke();

  return toRaster(canvas);
}

export function anchorDotImage(
  fill: string,
  ring: string,
  sizePx = 12,
): RasterImage {
  const { canvas, ctx } = makeCanvas(sizePx);
  const s = sizePx;
  const r = s / 2 - 1.5;

  ctx.clearRect(0, 0, s, s);
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ring;
  ctx.stroke();

  return toRaster(canvas);
}

/** OCHA icons ship monochrome `#000000`, so the fill is rewritten before rasterising. */
export function recolourSvg(svgText: string, color: string): string {
  return (
    svgText
      .replace(/fill\s*[:=]\s*(["']?)#0{3,6}\1/gi, `fill="${color}"`)
      .replace(/fill\s*[:=]\s*(["']?)black\1/gi, `fill="${color}"`)
      .replace(/fill\s*[:=]\s*(["']?)rgb\(0,\s*0,\s*0\)\1/gi, `fill="${color}"`)
      .replace(/fill\s*[:=]\s*(["']?)currentColor\1/gi, `fill="${color}"`)
      // No fill at all defaults to black in SVG, so inject one on the root.
      .replace(/<svg\b([^>]*)>/i, (m, attrs: string) =>
        /\bfill\s*=/.test(attrs) ? m : `<svg${attrs} fill="${color}">`,
      )
  );
}

export interface EventIconOptions {
  readonly sizePx?: number;
  readonly glyphColor?: string;
  readonly discFill?: string;
  readonly discRing?: string;
  /** Fraction of the disc the glyph occupies. */
  readonly glyphScale?: number;
}

export async function eventIconImage(
  svgText: string,
  options: EventIconOptions = {},
): Promise<RasterImage> {
  const size = options.sizePx ?? 32;
  const glyphColor = options.glyphColor ?? "#ffffff";
  const discFill = options.discFill ?? "#E03C31";
  const discRing = options.discRing ?? "#ffffff";
  const glyphScale = options.glyphScale ?? 0.58;

  const { canvas, ctx } = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);

  if (discFill !== "none") {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = discFill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = discRing;
    ctx.stroke();
  }

  const glyph = await loadSvgImage(recolourSvg(svgText, glyphColor));
  const gs = size * glyphScale;
  ctx.drawImage(glyph, (size - gs) / 2, (size - gs) / 2, gs, gs);

  return toRaster(canvas);
}

// Data URL rather than a blob URL: no object URL lifetime to manage.
export function loadSvgImage(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to decode SVG"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
}

/** Stable image id for a procedural sprite. */
export const spriteId = (
  shape: string,
  color: string,
  size: number,
): string => `lm:${shape}:${color}:${size}`;

/** Registers the sprite if absent; returns the id to use in `icon-image`. */
export function ensureArrowhead(
  host: ImageHost,
  color: string,
  sizePx = 24,
): string {
  const id = spriteId("arrowhead", color, sizePx);
  if (!host.hasImage(id)) {
    host.addImage(id, arrowheadImage(color, sizePx), { pixelRatio: DPR });
  }
  return id;
}

export function ensureChevron(
  host: ImageHost,
  color: string,
  sizePx = 16,
): string {
  const id = spriteId("chevron", color, sizePx);
  if (!host.hasImage(id)) {
    host.addImage(id, chevronImage(color, sizePx), { pixelRatio: DPR });
  }
  return id;
}

export function ensureAnchorDot(
  host: ImageHost,
  fill: string,
  ring: string,
  sizePx = 12,
): string {
  const id = spriteId(`anchordot-${ring}`, fill, sizePx);
  if (!host.hasImage(id)) {
    host.addImage(id, anchorDotImage(fill, ring, sizePx), { pixelRatio: DPR });
  }
  return id;
}
