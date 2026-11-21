/** Colour arithmetic for values that arrive as CSS strings (tokens, basemap styles, user picks). */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255];
}

function parseHex(text: string): Rgba | null {
  const hex = text.slice(1);
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a] = [...hex].map((digit) => parseInt(digit + digit, 16));
    if (r === undefined || g === undefined || b === undefined) return null;
    return { r, g, b, a: a === undefined ? 1 : a / 255 };
  }
  if (hex.length === 6 || hex.length === 8) {
    const value = (start: number) => parseInt(hex.slice(start, start + 2), 16);
    return { r: value(0), g: value(2), b: value(4), a: hex.length === 8 ? value(6) / 255 : 1 };
  }
  return null;
}

/** Parses hex, rgb(), rgba(), hsl() and hsla(). Anything else (named colours, expressions) is null. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase();
  if (text.startsWith("#")) return parseHex(text);
  const match = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(text);
  if (!match) return null;
  const [, fn = "", body = ""] = match;
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  const numbers = parts.map((part) => parseFloat(part));
  const [first, second, third, fourth] = numbers;
  if (first === undefined || second === undefined || third === undefined || numbers.some(Number.isNaN)) return null;
  const alphaPart = parts[3];
  const alpha = fourth === undefined ? 1 : alphaPart?.endsWith("%") ? fourth / 100 : fourth;
  if (fn.startsWith("rgb")) return { r: clamp255(first), g: clamp255(second), b: clamp255(third), a: alpha };
  const [r, g, b] = hslToRgb(first, second / 100, third / 100);
  return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: alpha };
}

export function toCss(color: Rgba, alpha = color.a): string {
  return `rgba(${clamp255(color.r)}, ${clamp255(color.g)}, ${clamp255(color.b)}, ${Math.round(alpha * 1000) / 1000})`;
}

export function mix(from: Rgba, to: Rgba, amount: number): Rgba {
  const blend = (a: number, b: number) => a + (b - a) * amount;
  return { r: blend(from.r, to.r), g: blend(from.g, to.g), b: blend(from.b, to.b), a: from.a };
}

/** Pulls a colour toward its own grey; 0 leaves it, 1 removes all chroma. */
export function desaturate(color: Rgba, amount: number): Rgba {
  const grey = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return mix(color, { r: grey, g: grey, b: grey, a: color.a }, amount);
}

export function luminance(color: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
