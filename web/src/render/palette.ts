import type { ColorRef } from "@/model/types";
import { contrast, mix, parseColor, toCss, type Rgba } from "./color";

export type ThemeMode = "light" | "dark";

/**
 * Every colour the map draws with, resolved from the design tokens. Nothing
 * here is a second copy of the token values: they are read from the `--map-*`
 * and neutral variables in scope at the map's container.
 */
export interface Palette {
  theme: ThemeMode;
  slots: readonly Rgba[];
  land: Rgba;
  water: Rgba;
  halo: Rgba;
  ink: Rgba;
  inkSoft: Rgba;
  panel: Rgba;
  rule: Rgba;
  /** Selection, handles and guides on the map. */
  selection: Rgba;
  /** Compared between reads to tell whether anything has to be redrawn. */
  key: string;
}

const VARIABLES = [
  "--map-1",
  "--map-2",
  "--map-3",
  "--map-4",
  "--map-5",
  "--map-6",
  "--map-7",
  "--map-8",
  "--map-land",
  "--map-water",
  "--map-halo",
  "--ink",
  "--ink-2",
  "--panel",
  "--rule-strong",
  "--plum",
] as const;

/** Used only when a variable is missing, so a broken stylesheet shows up as grey instead of throwing. */
const UNRESOLVED: Rgba = { r: 128, g: 128, b: 128, a: 1 };

/**
 * Reads the palette for a theme from a probe carrying the `light` or `dark`
 * class, so it is right whatever the page around the map is set to and even
 * when the host has not switched the document class yet.
 */
export function readPalette(element: HTMLElement, theme: ThemeMode): Palette {
  const probe = document.createElement("div");
  probe.className = theme;
  probe.style.display = "none";
  element.appendChild(probe);
  const computed = getComputedStyle(probe);
  const raw = VARIABLES.map((name) => computed.getPropertyValue(name).trim());
  probe.remove();

  const read = (name: (typeof VARIABLES)[number]): Rgba => parseColor(raw[VARIABLES.indexOf(name)] ?? "") ?? UNRESOLVED;
  return {
    theme,
    slots: VARIABLES.slice(0, 8).map(read),
    land: read("--map-land"),
    water: read("--map-water"),
    halo: read("--map-halo"),
    ink: read("--ink"),
    inkSoft: read("--ink-2"),
    panel: read("--panel"),
    rule: read("--rule-strong"),
    selection: read("--plum"),
    key: `${theme}|${raw.join("|")}`,
  };
}

export function resolveColor(ref: ColorRef, palette: Palette): Rgba {
  if ("slot" in ref) return palette.slots[ref.slot - 1] ?? UNRESOLVED;
  return parseColor(ref.custom) ?? UNRESOLVED;
}

/** Below this ratio against the land colour a stroke gets a casing and a fill gets an outline. */
const WEAK_CONTRAST = 3;

export function isWeakOnLand(color: Rgba, palette: Palette): boolean {
  return contrast(color, palette.land) < WEAK_CONTRAST;
}

/** A darker (light theme) or lighter (dark theme) version of a colour, used to case weak colours. */
export function casingFor(color: Rgba, palette: Palette): string {
  return toCss(mix(color, palette.ink, 0.5), 1);
}

/** The lighter or darker of the two neutrals, whichever reads better on the given colour. */
export function readableOn(color: Rgba, palette: Palette): Rgba {
  return contrast(color, palette.panel) >= contrast(color, palette.ink) ? palette.panel : palette.ink;
}
