import type { Map as MapLibreMap } from "maplibre-gl";
import { toCss } from "@/render/color";
import type { Box, Pt } from "@/render/geo";
import { traceOutline } from "@/render/paint";
import type { Palette } from "@/render/palette";
import type { ScreenShape } from "@/render/shapes";
import { readView, type View } from "@/render/view";

/**
 * The editing layer: selection outlines, vertex handles, the rubber band and
 * the snap marker. It is a second canvas above the features and exists only
 * in an interactive controller, so a preview or an embed draws none of it.
 */
export type ChromePainter = (pen: ChromePen, view: View) => void;

export class Chrome {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private painter: ChromePainter | null = null;
  private frame = 0;
  private paintedViewKey = "";
  private paused = false;
  private palette: Palette;
  private readonly onRender: () => void;
  private readonly onResize: () => void;

  constructor(
    private readonly map: MapLibreMap,
    palette: Palette,
  ) {
    this.palette = palette;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
    map.getCanvasContainer().appendChild(this.canvas);
    this.context = this.canvas.getContext("2d");
    this.onRender = () => {
      if (readView(map).key !== this.paintedViewKey) this.paintNow();
    };
    map.on("render", this.onRender);
    /* A resize can leave the view's key as it was painted (see readView), so it always repaints. */
    this.onResize = () => this.paintNow();
    map.on("resize", this.onResize);
  }

  setPainter(painter: ChromePainter): void {
    this.painter = painter;
    this.requestPaint();
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.requestPaint();
  }

  /** While paused nothing is painted; resuming paints once. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else this.requestPaint();
  }

  requestPaint(): void {
    if (this.frame !== 0 || this.paused) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paintNow();
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.map.off("render", this.onRender);
    this.map.off("resize", this.onResize);
    this.canvas.remove();
    this.painter = null;
  }

  private paintNow(): void {
    const { canvas, context } = this;
    if (!context || this.paused) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const view = readView(this.map);
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.round(view.width * pixelRatio);
    const height = Math.round(view.height * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    this.painter?.(new ChromePen(context, this.palette), view);
    this.paintedViewKey = view.key;
  }
}

export type HandleLook = "vertex" | "vertex-active" | "midpoint" | "start";

/** The few marks the tools draw, in the selection colour over a light or dark map. */
export class ChromePen {
  private readonly accent: string;
  private readonly paper: string;

  constructor(
    private readonly context: CanvasRenderingContext2D,
    palette: Palette,
  ) {
    this.accent = toCss(palette.selection, 1);
    this.paper = toCss(palette.panel, 1);
  }

  /** A thin line along what the feature paints, leaving its own stroke and dash visible. */
  outline(shape: ScreenShape): void {
    const { context } = this;
    traceOutline(context, shape);
    context.lineJoin = "round";
    context.lineWidth = 3;
    context.strokeStyle = this.paper;
    context.globalAlpha = 0.55;
    context.stroke();
    context.globalAlpha = 1;
    context.lineWidth = 1.25;
    context.strokeStyle = this.accent;
    context.stroke();
  }

  handle(at: Pt, look: HandleLook, coarse: boolean): void {
    const { context } = this;
    const radius = (look === "midpoint" ? 3.5 : look === "start" ? 6.5 : 5) * (coarse ? 1.7 : 1);
    context.beginPath();
    context.arc(at.x, at.y, radius, 0, Math.PI * 2);
    context.globalAlpha = look === "midpoint" ? 0.85 : 1;
    context.fillStyle = look === "vertex-active" || look === "midpoint" ? this.accent : this.paper;
    context.fill();
    context.lineWidth = look === "midpoint" ? 1 : 1.75;
    context.strokeStyle = look === "midpoint" ? this.paper : this.accent;
    context.stroke();
    context.globalAlpha = 1;
  }

  /** The rubber band between the last placed point and the pointer. */
  guide(points: readonly Pt[]): void {
    const { context } = this;
    context.beginPath();
    let started = false;
    for (const p of points) {
      if (started) context.lineTo(p.x, p.y);
      else context.moveTo(p.x, p.y);
      started = true;
    }
    context.setLineDash([4, 4]);
    context.lineWidth = 1.25;
    context.strokeStyle = this.accent;
    context.stroke();
    context.setLineDash([]);
  }

  /** Where the pointer has snapped: a ring on a vertex, a diamond on an edge. */
  snap(at: Pt, type: "vertex" | "edge"): void {
    const { context } = this;
    const size = 8;
    context.beginPath();
    if (type === "vertex") {
      context.arc(at.x, at.y, size, 0, Math.PI * 2);
    } else {
      context.moveTo(at.x, at.y - size);
      context.lineTo(at.x + size, at.y);
      context.lineTo(at.x, at.y + size);
      context.lineTo(at.x - size, at.y);
      context.closePath();
    }
    context.lineWidth = 4;
    context.strokeStyle = this.paper;
    context.stroke();
    context.lineWidth = 2;
    context.strokeStyle = this.accent;
    context.stroke();
  }

  /** Where a keyboard places the next point: a cross with a clear centre, readable over any map. */
  crosshair(at: Pt): void {
    const { context } = this;
    const arms: [number, number, number, number][] = [
      [at.x, at.y - 18, at.x, at.y - 5],
      [at.x, at.y + 5, at.x, at.y + 18],
      [at.x - 18, at.y, at.x - 5, at.y],
      [at.x + 5, at.y, at.x + 18, at.y],
    ];
    for (const [width, colour] of [
      [5, this.paper],
      [2, this.accent],
    ] as const) {
      context.beginPath();
      for (const [x1, y1, x2, y2] of arms) {
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
      }
      context.lineWidth = width;
      context.lineCap = "round";
      context.strokeStyle = colour;
      context.stroke();
    }
    context.beginPath();
    context.arc(at.x, at.y, 2, 0, Math.PI * 2);
    context.fillStyle = this.accent;
    context.fill();
  }

  /** The handle that bends an arrow: a diamond, so it reads apart from the round vertex handles. */
  bend(at: Pt, coarse: boolean, active: boolean): void {
    const { context } = this;
    const size = coarse ? 10 : 6.5;
    context.beginPath();
    context.moveTo(at.x, at.y - size);
    context.lineTo(at.x + size, at.y);
    context.lineTo(at.x, at.y + size);
    context.lineTo(at.x - size, at.y);
    context.closePath();
    context.fillStyle = active ? this.accent : this.paper;
    context.fill();
    context.lineWidth = 1.75;
    context.strokeStyle = this.accent;
    context.stroke();
  }

  marquee(box: Box): void {
    const { context } = this;
    context.beginPath();
    context.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    context.globalAlpha = 0.12;
    context.fillStyle = this.accent;
    context.fill();
    context.globalAlpha = 1;
    context.lineWidth = 1;
    context.strokeStyle = this.accent;
    context.stroke();
  }
}
