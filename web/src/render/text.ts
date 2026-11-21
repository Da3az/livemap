import type { RichText } from "@/model/types";
import type { Box, Pt } from "./geo";
import type { ResolvedText } from "./style";

/**
 * Text is drawn with the browser's own text engine on a 2D canvas: Arabic is
 * shaped and joined by the same code that renders the rest of the interface,
 * in the interface typefaces, and an exported image uses the identical path.
 */

export interface FontFamilies {
  ui: string;
  title: string;
}

let families: FontFamilies | null = null;

/** The design's font stacks, read from the `font-ui` and `font-title` utilities instead of repeated here. */
export function fontFamilies(): FontFamilies {
  if (families) return families;
  const read = (className: string) => {
    const probe = document.createElement("span");
    probe.className = className;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return family;
  };
  families = { ui: read("font-ui"), title: read("font-title") };
  return families;
}

export function fontSpec(family: string, size: number, weight: number): string {
  return `${weight} ${size}px ${family}`;
}

/* ------------------------------------------------------------ font loading */

const requested = new Set<string>();
const listeners = new Set<() => void>();
let epoch = 0;

/** Bumped whenever a font finishes loading, so cached measurements can be thrown away. */
export function fontEpoch(): number {
  return epoch;
}

export function onFontsLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Asks the browser for the faces this text needs. A canvas does not wait for
 * web fonts: it draws a fallback, so the faces are requested explicitly and
 * the caller redraws when they arrive.
 */
export function requestFont(font: string, text: string): Promise<void> {
  const key = `${font}|${text}`;
  if (requested.has(key)) return Promise.resolve();
  requested.add(key);
  return document.fonts.load(font, text).then(
    (faces) => {
      if (faces.length === 0) return;
      epoch++;
      for (const listener of listeners) listener();
    },
    () => undefined,
  );
}

/* ------------------------------------------------------------------ layout */

const RTL_CHARACTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const LTR_CHARACTER = /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff]/;

/** `auto` follows the first strongly directional character, as the Unicode algorithm does. */
export function resolveDir(text: RichText): "ltr" | "rtl" {
  if (text.dir !== "auto") return text.dir;
  for (const character of text.value) {
    if (RTL_CHARACTER.test(character)) return "rtl";
    if (LTR_CHARACTER.test(character)) return "ltr";
  }
  return "ltr";
}

export interface TextBlock {
  lines: string[];
  dir: "ltr" | "rtl";
  font: string;
  size: number;
  lineHeight: number;
  /** Size of the text itself, without box padding. */
  width: number;
  height: number;
  align: "start" | "center";
  style: ResolvedText;
}

let measurer: CanvasRenderingContext2D | null = null;

function measuringContext(): CanvasRenderingContext2D {
  if (measurer) return measurer;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("This browser cannot create a 2D canvas");
  measurer = context;
  return context;
}

function wrapLine(context: CanvasRenderingContext2D, line: string, maxWidth: number): string[] {
  if (context.measureText(line).width <= maxWidth) return [line];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

export function layoutText(
  text: RichText,
  style: ResolvedText,
  options: { family: string; align: "start" | "center"; maxWidth: number },
): TextBlock | null {
  const value = text.value.trim();
  if (!value) return null;
  const font = fontSpec(options.family, style.size, style.weight);
  void requestFont(font, value);
  const context = measuringContext();
  context.font = font;
  const dir = resolveDir(text);
  context.direction = dir;
  const lines = value.split("\n").flatMap((line) => wrapLine(context, line.trim(), options.maxWidth));
  const lineHeight = Math.round(style.size * 1.3);
  const width = Math.max(...lines.map((line) => context.measureText(line).width));
  return { lines, dir, font, size: style.size, lineHeight, width, height: lines.length * lineHeight, align: options.align, style };
}

export const BOX_PADDING_X = 6;
export const BOX_PADDING_Y = 3;

/** The rectangle a block occupies when centred on a point, including its box padding. */
export function textBox(block: TextBlock, centre: Pt): Box {
  const padX = block.style.box ? BOX_PADDING_X : 2;
  const padY = block.style.box ? BOX_PADDING_Y : 1;
  return {
    minX: centre.x - block.width / 2 - padX,
    maxX: centre.x + block.width / 2 + padX,
    minY: centre.y - block.height / 2 - padY,
    maxY: centre.y + block.height / 2 + padY,
  };
}

export interface TextColors {
  halo: string;
  boxFill: string;
  boxEdge: string;
}

export function paintText(context: CanvasRenderingContext2D, block: TextBlock, centre: Pt, colors: TextColors): void {
  const box = textBox(block, centre);
  context.save();
  if (block.style.box) {
    context.beginPath();
    context.roundRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY, 2);
    context.fillStyle = colors.boxFill;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = colors.boxEdge;
    context.stroke();
  }
  context.font = block.font;
  context.direction = block.dir;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  let x = centre.x;
  if (block.align === "center") {
    context.textAlign = "center";
  } else {
    context.textAlign = "start";
    x = block.dir === "rtl" ? centre.x + block.width / 2 : centre.x - block.width / 2;
  }
  let y = centre.y - block.height / 2 + block.lineHeight / 2;
  for (const line of block.lines) {
    if (block.style.halo && !block.style.box) {
      context.lineWidth = Math.max(3, block.size * 0.3);
      context.strokeStyle = colors.halo;
      context.strokeText(line, x, y);
    }
    context.fillStyle = block.style.css;
    context.fillText(line, x, y);
    y += block.lineHeight;
  }
  context.restore();
}

/** Wraps free text to a width in one font, for furniture drawn on an exported image. */
export function wrapText(text: RichText, font: string, maxWidth: number): { lines: string[]; width: number; dir: "ltr" | "rtl" } {
  const context = measuringContext();
  context.font = font;
  const dir = resolveDir(text);
  context.direction = dir;
  const lines = text.value
    .trim()
    .split("\n")
    .flatMap((line) => wrapLine(context, line.trim(), maxWidth));
  return { lines, dir, width: Math.max(0, ...lines.map((line) => context.measureText(line).width)) };
}

/**
 * Waits until the typefaces `blocks` are set in have loaded, or `waitMs` has
 * passed. True when a typeface arrived meanwhile, so text measured before
 * it must be measured again.
 */
export async function fontsReadyFor(blocks: readonly TextBlock[], waitMs: number): Promise<boolean> {
  const loads = blocks.map((block) => document.fonts.load(block.font, block.lines.join(" ")));
  const before = fontEpoch();
  await Promise.race([Promise.allSettled(loads), new Promise((resolve) => setTimeout(resolve, waitMs))]);
  return fontEpoch() !== before;
}
