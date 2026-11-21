import type { FillPattern } from "@/model/types";

/** Pattern tiles are drawn once per colour, pattern and pixel ratio, then reused for every fill. */
const TILE = 8;

function drawTile(pattern: Exclude<FillPattern, "none">, color: string, pixelRatio: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(TILE * pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.scale(canvas.width / TILE, canvas.height / TILE);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 1.4;
  context.lineCap = "square";
  const diagonal = (rising: boolean) => {
    /* Three strokes so the line continues across the tile's edges without a gap. */
    for (const shift of [-TILE, 0, TILE]) {
      context.beginPath();
      context.moveTo(shift, rising ? TILE : 0);
      context.lineTo(shift + TILE, rising ? 0 : TILE);
      context.stroke();
    }
  };
  if (pattern === "hatch") diagonal(true);
  if (pattern === "cross") {
    context.lineWidth = 1.1;
    diagonal(true);
    diagonal(false);
  }
  if (pattern === "dots") {
    for (const [x, y] of [
      [2, 2],
      [6, 6],
    ] as const) {
      context.beginPath();
      context.arc(x, y, 1.15, 0, Math.PI * 2);
      context.fill();
    }
  }
  return canvas;
}

export class PatternCache {
  private readonly tiles = new Map<string, HTMLCanvasElement>();

  /**
   * A fill style for the pattern. `origin` pins the pattern to the map, so it
   * travels with the shape while panning instead of sliding underneath it.
   */
  get(
    context: CanvasRenderingContext2D,
    pattern: Exclude<FillPattern, "none">,
    color: string,
    pixelRatio: number,
    origin: { x: number; y: number },
  ): CanvasPattern | null {
    const key = `${pattern}|${color}|${pixelRatio}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = drawTile(pattern, color, pixelRatio);
      this.tiles.set(key, tile);
    }
    const fill = context.createPattern(tile, "repeat");
    if (!fill) return null;
    const scale = TILE / tile.width;
    const wrap = (value: number) => ((value % TILE) + TILE) % TILE;
    fill.setTransform(new DOMMatrix().translate(wrap(origin.x), wrap(origin.y)).scale(scale));
    return fill;
  }

  clear(): void {
    this.tiles.clear();
  }
}
