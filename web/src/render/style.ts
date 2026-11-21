import type { DashStyle, Fill, FillPattern, LabelStyle, MapFeature, MapSettings, Stroke, StylePreset } from "@/model/types";
import type { ColorRef } from "@/model/types";
import { toCss, type Rgba } from "./color";
import { casingFor, isWeakOnLand, readableOn, resolveColor, type Palette } from "./palette";

export interface ResolvedFill {
  color: Rgba;
  css: string;
  opacity: number;
  pattern: FillPattern;
  /** Set when the colour is weak against the land colour: the area then always carries an outline. */
  outline: string | null;
}

export interface ResolvedStroke {
  color: Rgba;
  css: string;
  /** CSS pixels */
  width: number;
  opacity: number;
  /** Dash and gap lengths in CSS pixels; empty for a solid line. */
  dash: number[];
  roundCaps: boolean;
  /** Set when the colour is weak against the land colour. */
  casing: string | null;
}

export interface ResolvedMarker {
  color: Rgba;
  css: string;
  /** The glyph or number on the disc. */
  ink: string;
  ring: string;
}

export interface ResolvedText {
  css: string;
  size: number;
  weight: 400 | 600;
  halo: boolean;
  box: boolean;
}

export interface FeatureStyle {
  fill: ResolvedFill | null;
  stroke: ResolvedStroke | null;
  marker: ResolvedMarker | null;
  /** Style of the optional label, or of an annotation's own text. */
  text: ResolvedText;
}

const DEFAULT_LABEL: LabelStyle = { color: "ink", size: 13, weight: 600, halo: true, box: false };

/** Dash patterns scale with the stroke so a thick dashed line still reads as dashed. */
export function dashArray(dash: DashStyle, width: number): number[] {
  const unit = Math.max(width, 1.5);
  if (dash === "solid") return [];
  if (dash === "dashed") return [unit * 3.2, unit * 2.2];
  if (dash === "dotted") return [0, unit * 2.2];
  const lengths = dash.custom.filter((length) => Number.isFinite(length) && length >= 0);
  if (lengths.length === 0 || lengths.every((length) => length === 0)) return [];
  return lengths.length % 2 === 0 ? lengths : [...lengths, ...lengths];
}

export function resolveFill(fill: Fill, palette: Palette): ResolvedFill {
  const color = resolveColor(fill.color, palette);
  return {
    color,
    css: toCss(color, 1),
    opacity: clampUnit(fill.opacity),
    pattern: fill.pattern,
    outline: isWeakOnLand(color, palette) ? casingFor(color, palette) : null,
  };
}

export function resolveStroke(stroke: Stroke, palette: Palette): ResolvedStroke {
  const color = resolveColor(stroke.color, palette);
  const width = Math.max(0, stroke.width);
  return {
    color,
    css: toCss(color, 1),
    width,
    opacity: clampUnit(stroke.opacity),
    dash: dashArray(stroke.dash, width),
    roundCaps: stroke.dash === "dotted",
    casing: isWeakOnLand(color, palette) ? casingFor(color, palette) : null,
  };
}

export function resolveMarker(colorRef: ColorRef, palette: Palette): ResolvedMarker {
  const color = resolveColor(colorRef, palette);
  return { color, css: toCss(color, 1), ink: toCss(readableOn(color, palette), 1), ring: toCss(palette.halo, 1) };
}

export function resolveText(style: LabelStyle | undefined, palette: Palette): ResolvedText {
  const label = style ?? DEFAULT_LABEL;
  const color = label.color === "ink" ? palette.ink : resolveColor(label.color, palette);
  return { css: toCss(color, 1), size: Math.max(8, label.size), weight: label.weight, halo: label.halo, box: label.box };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function presetFor(feature: MapFeature, settings: MapSettings): StylePreset | null {
  if (feature.presetId === null) return null;
  return settings.presets.find((preset) => preset.id === feature.presetId) ?? null;
}

/**
 * The style a feature is drawn with. A preset replaces the fields it defines;
 * a preset that says nothing about a field (a fill preset on a line) leaves
 * the feature's own value in place.
 */
export function resolveFeatureStyle(feature: MapFeature, settings: MapSettings, palette: Palette): FeatureStyle {
  const preset = presetFor(feature, settings);
  const text = resolveText(feature.labelStyle, palette);
  switch (feature.kind) {
    case "area": {
      const fill = resolveFill(preset?.fill ?? feature.fill, palette);
      const stroke = resolveStroke(preset?.stroke ?? feature.stroke, palette);
      return { fill, stroke, marker: null, text };
    }
    case "line":
    case "arrow":
    case "frontline":
      return { fill: null, stroke: resolveStroke(preset?.stroke ?? feature.stroke, palette), marker: null, text };
    case "point":
      return { fill: null, stroke: null, marker: resolveMarker(preset?.iconColor ?? feature.color, palette), text };
    case "annotation":
      return { fill: null, stroke: null, marker: null, text };
  }
}
