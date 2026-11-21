import type {
  ColorRef,
  FeatureKind,
  Fill,
  LabelStyle,
  MapFeature,
  PointFeature,
  Stroke,
  StylePreset,
} from "@/model/types";

/** The look of a feature after its preset, if any, has been applied. */
export interface ResolvedStyle {
  /** The preset actually in effect; null when the feature has none or it no longer exists. */
  presetId: string | null;
  fill: Fill | null;
  stroke: Stroke | null;
  /** The feature's main colour: outline for shapes and lines, icon colour for points. */
  color: ColorRef | null;
}

/** What a small preview of a feature or legend entry needs. */
export interface Swatch extends ResolvedStyle {
  kind: FeatureKind;
  symbol: PointFeature["symbol"] | null;
}

/** Look up presets by id. */
export type PresetLookup = ReadonlyMap<string, StylePreset>;

/** Index presets by id. */
export function presetLookup(presets: readonly StylePreset[]): PresetLookup {
  const byId = new Map<string, StylePreset>();
  for (const preset of presets) byId.set(preset.id, preset);
  return byId;
}

/** The style a feature is drawn with, following its preset where it has one. */
export function resolveStyle(feature: MapFeature, presets: PresetLookup): ResolvedStyle {
  const found = feature.presetId === null ? undefined : presets.get(feature.presetId);
  const preset = found !== undefined && found.appliesTo.includes(feature.kind) ? found : undefined;
  const presetId = preset?.id ?? null;
  switch (feature.kind) {
    case "area": {
      const stroke = preset?.stroke ?? feature.stroke;
      return { presetId, fill: preset?.fill ?? feature.fill, stroke, color: stroke.color };
    }
    case "line":
    case "arrow":
    case "frontline": {
      const stroke = preset?.stroke ?? feature.stroke;
      return { presetId, fill: null, stroke, color: stroke.color };
    }
    case "point":
      return { presetId, fill: null, stroke: null, color: preset?.iconColor ?? feature.color };
    case "annotation":
      return { presetId: null, fill: null, stroke: null, color: null };
  }
}

/** The preview of one feature. */
export function swatchOf(feature: MapFeature, presets: PresetLookup): Swatch {
  return {
    ...resolveStyle(feature, presets),
    kind: feature.kind,
    symbol: feature.kind === "point" ? feature.symbol : null,
  };
}

/** Copy the preset's look into the feature and let go of the preset. */
export function detachPreset(feature: MapFeature, presets: PresetLookup): MapFeature {
  if (feature.presetId === null) return feature;
  const style = resolveStyle(feature, presets);
  switch (feature.kind) {
    case "area":
      return { ...feature, presetId: null, fill: style.fill ?? feature.fill, stroke: style.stroke ?? feature.stroke };
    case "line":
    case "arrow":
    case "frontline":
      return { ...feature, presetId: null, stroke: style.stroke ?? feature.stroke };
    case "point":
      return { ...feature, presetId: null, color: style.color ?? feature.color };
    case "annotation":
      return { ...feature, presetId: null };
  }
}

/** Kinds a preset can style. Annotations carry text style only, so they are left out. */
export const PRESET_KINDS: FeatureKind[] = ["area", "line", "arrow", "frontline", "point"];

/** The preset fields a feature's current look translates to. */
export function presetStyleFrom(
  feature: MapFeature,
  presets: PresetLookup,
): Pick<StylePreset, "fill" | "stroke" | "iconColor" | "appliesTo"> | null {
  const style = resolveStyle(feature, presets);
  if (style.color === null) return null;
  const stroke: Stroke = style.stroke ?? { color: style.color, width: 2, opacity: 1, dash: "solid" };
  const fill: Fill = style.fill ?? { color: style.color, opacity: 0.25, pattern: "none" };
  return { fill, stroke, iconColor: style.color, appliesTo: [...PRESET_KINDS] };
}

/* ------------------------------------------------------------- clipboard */

/** A copied look, ready to paste onto features of any kind. */
export interface StyleClipboard {
  sourceKind: FeatureKind;
  presetId: string | null;
  fill: Fill | null;
  stroke: Stroke | null;
  color: ColorRef | null;
  labelStyle: LabelStyle | null;
  pointSize: number | null;
}

/** Copy a feature's look. */
export function copyStyleOf(feature: MapFeature, presets: PresetLookup): StyleClipboard {
  const style = resolveStyle(feature, presets);
  return {
    sourceKind: feature.kind,
    presetId: style.presetId,
    fill: style.fill,
    stroke: style.stroke,
    color: style.color,
    labelStyle: feature.labelStyle ?? null,
    pointSize: feature.kind === "point" ? feature.size : null,
  };
}

/**
 * Paste a copied look. A preset is carried over where it still exists and
 * applies; otherwise the nearest equivalent local style is written.
 */
export function pasteStyleOnto(feature: MapFeature, clip: StyleClipboard, presets: PresetLookup): MapFeature {
  let next: MapFeature = feature;
  if (clip.labelStyle !== null && (next.kind === "annotation" || next.label !== undefined)) {
    next = { ...next, labelStyle: clip.labelStyle };
  }
  if (next.kind === "annotation") return next;
  const preset = clip.presetId === null ? undefined : presets.get(clip.presetId);
  if (preset !== undefined && preset.appliesTo.includes(next.kind)) return { ...next, presetId: preset.id };
  if (clip.color === null) return next;
  switch (next.kind) {
    case "area": {
      const stroke = clip.stroke ?? { ...next.stroke, color: clip.color };
      const fill = clip.fill ?? { ...next.fill, color: clip.color };
      return { ...next, presetId: null, fill, stroke };
    }
    case "line":
    case "arrow":
    case "frontline":
      return {
        ...next,
        presetId: null,
        stroke: clip.sourceKind === "area" || clip.stroke === null ? { ...next.stroke, color: clip.color } : clip.stroke,
      };
    case "point":
      return { ...next, presetId: null, color: clip.color, size: clip.pointSize ?? next.size };
  }
}
