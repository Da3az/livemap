import type {
  AnnotationFeature,
  ArrowFeature,
  ColorRef,
  DashStyle,
  FillPattern,
  FrontlineFeature,
  LabelStyle,
  MapFeature,
  PointFeature,
  RichText,
  Stroke,
} from "@/model/types";
import { DEFAULT_LABEL_STYLE } from "./defaults";
import { detachPreset, resolveStyle, type PresetLookup, type ResolvedStyle } from "./style";
import { bi, type Bilingual } from "./text";

/* ------------------------------------------------------------ properties */

/**
 * Every style property the inspector can show and change, by a flat name.
 * The same names key `StylePatch`, the selection summary and undo labels.
 */
export interface StyleValues {
  /** The main colour across kinds: outline and fill of areas, lines, icons. */
  color: ColorRef;
  "fill.color": ColorRef;
  "fill.opacity": number;
  "fill.pattern": FillPattern;
  "stroke.color": ColorRef;
  "stroke.width": number;
  "stroke.opacity": number;
  "stroke.dash": DashStyle;
  /** Text drawn on the map with the feature; null removes it. */
  label: RichText | null;
  "labelStyle.color": ColorRef | "ink";
  "labelStyle.size": number;
  "labelStyle.weight": 400 | 600;
  "labelStyle.halo": boolean;
  "labelStyle.box": boolean;
  "point.symbol": PointFeature["symbol"];
  "point.size": number;
  "annotation.text": RichText;
  "annotation.leader": AnnotationFeature["leader"];
  "arrow.curvature": number;
  /** Which side a two-point arrow bows to; a feature without `bend` reads as "left". */
  "arrow.bend": NonNullable<ArrowFeature["bend"]>;
  "arrow.head": ArrowFeature["head"];
  "arrow.tapered": boolean;
  "frontline.facing": FrontlineFeature["facing"];
  "frontline.toothShape": FrontlineFeature["toothShape"];
  "frontline.toothSpacing": number;
  "frontline.toothSize": number;
}

export type StyleProperty = keyof StyleValues;

/** Any subset of style properties. Each feature takes the ones its kind has. */
export type StylePatch = Partial<StyleValues>;

interface PropertySpec<K extends StyleProperty> {
  label: Bilingual;
  /** True when a preset governs it: changing it on a feature detaches the preset. */
  preset: boolean;
  /** undefined: this feature has no such property. */
  read(feature: MapFeature, style: ResolvedStyle): StyleValues[K] | undefined;
  /** Returns the feature untouched when the patch lacks the property or the kind does not have it. */
  write(feature: MapFeature, patch: StylePatch): MapFeature;
}

function hasStroke(feature: MapFeature): feature is Exclude<MapFeature, PointFeature | AnnotationFeature> {
  return feature.kind !== "point" && feature.kind !== "annotation";
}

function strokeSpec<K extends "stroke.color" | "stroke.width" | "stroke.opacity" | "stroke.dash">(
  key: K,
  label: Bilingual,
  merge: (stroke: Stroke, value: StyleValues[K]) => Stroke,
  pick: (stroke: Stroke) => StyleValues[K],
): PropertySpec<K> {
  return {
    label,
    preset: true,
    read: (_feature, style) => (style.stroke === null ? undefined : pick(style.stroke)),
    write: (feature, patch) => {
      const value: StyleValues[K] | undefined = patch[key];
      if (value === undefined || !hasStroke(feature)) return feature;
      return { ...feature, stroke: merge(feature.stroke, value) };
    },
  };
}

function labelStyleOf(feature: MapFeature): LabelStyle | undefined {
  if (feature.kind === "annotation") return feature.labelStyle;
  return feature.label === undefined ? undefined : (feature.labelStyle ?? DEFAULT_LABEL_STYLE);
}

function withLabelStyle(feature: MapFeature, change: Partial<LabelStyle>): MapFeature {
  const current = feature.labelStyle ?? DEFAULT_LABEL_STYLE;
  return { ...feature, labelStyle: { ...current, ...change } };
}

const SPECS: { [K in StyleProperty]: PropertySpec<K> } = {
  color: {
    label: bi("colour", "اللون"),
    preset: true,
    read: (_feature, style) => style.color ?? undefined,
    write: (feature, patch) => {
      const color = patch.color;
      if (color === undefined) return feature;
      if (feature.kind === "area") {
        return { ...feature, fill: { ...feature.fill, color }, stroke: { ...feature.stroke, color } };
      }
      if (feature.kind === "point") return { ...feature, color };
      if (feature.kind === "annotation") return feature;
      return { ...feature, stroke: { ...feature.stroke, color } };
    },
  },
  "fill.color": {
    label: bi("fill colour", "لون التعبئة"),
    preset: true,
    read: (_feature, style) => style.fill?.color,
    write: (feature, patch) => {
      const color = patch["fill.color"];
      return color === undefined || feature.kind !== "area" ? feature : { ...feature, fill: { ...feature.fill, color } };
    },
  },
  "fill.opacity": {
    label: bi("fill opacity", "شفافية التعبئة"),
    preset: true,
    read: (_feature, style) => style.fill?.opacity,
    write: (feature, patch) => {
      const opacity = patch["fill.opacity"];
      return opacity === undefined || feature.kind !== "area"
        ? feature
        : { ...feature, fill: { ...feature.fill, opacity: clamp01(opacity) } };
    },
  },
  "fill.pattern": {
    label: bi("fill pattern", "نمط التعبئة"),
    preset: true,
    read: (_feature, style) => style.fill?.pattern,
    write: (feature, patch) => {
      const pattern = patch["fill.pattern"];
      return pattern === undefined || feature.kind !== "area"
        ? feature
        : { ...feature, fill: { ...feature.fill, pattern } };
    },
  },
  "stroke.color": strokeSpec(
    "stroke.color",
    bi("line colour", "لون الخط"),
    (stroke, color) => ({ ...stroke, color }),
    (stroke) => stroke.color,
  ),
  "stroke.width": strokeSpec(
    "stroke.width",
    bi("line width", "سُمك الخط"),
    (stroke, width) => ({ ...stroke, width: Math.max(0, width) }),
    (stroke) => stroke.width,
  ),
  "stroke.opacity": strokeSpec(
    "stroke.opacity",
    bi("line opacity", "شفافية الخط"),
    (stroke, opacity) => ({ ...stroke, opacity: clamp01(opacity) }),
    (stroke) => stroke.opacity,
  ),
  "stroke.dash": strokeSpec(
    "stroke.dash",
    bi("line dash", "تقطيع الخط"),
    (stroke, dash) => ({ ...stroke, dash }),
    (stroke) => stroke.dash,
  ),
  label: {
    label: bi("label", "التسمية"),
    preset: false,
    read: (feature) => (feature.kind === "annotation" ? undefined : (feature.label ?? null)),
    write: (feature, patch) => {
      const label = patch.label;
      if (label === undefined || feature.kind === "annotation") return feature;
      if (label === null || label.value === "") {
        const { label: _dropped, ...rest } = feature;
        return rest;
      }
      return { ...feature, label, labelStyle: feature.labelStyle ?? DEFAULT_LABEL_STYLE };
    },
  },
  "labelStyle.color": {
    label: bi("text colour", "لون النص"),
    preset: false,
    read: (feature) => labelStyleOf(feature)?.color,
    write: (feature, patch) => {
      const color = patch["labelStyle.color"];
      return color === undefined ? feature : withLabelStyle(feature, { color });
    },
  },
  "labelStyle.size": {
    label: bi("text size", "حجم النص"),
    preset: false,
    read: (feature) => labelStyleOf(feature)?.size,
    write: (feature, patch) => {
      const size = patch["labelStyle.size"];
      return size === undefined ? feature : withLabelStyle(feature, { size: Math.max(1, size) });
    },
  },
  "labelStyle.weight": {
    label: bi("text weight", "وزن النص"),
    preset: false,
    read: (feature) => labelStyleOf(feature)?.weight,
    write: (feature, patch) => {
      const weight = patch["labelStyle.weight"];
      return weight === undefined ? feature : withLabelStyle(feature, { weight });
    },
  },
  "labelStyle.halo": {
    label: bi("text halo", "هالة النص"),
    preset: false,
    read: (feature) => labelStyleOf(feature)?.halo,
    write: (feature, patch) => {
      const halo = patch["labelStyle.halo"];
      return halo === undefined ? feature : withLabelStyle(feature, { halo });
    },
  },
  "labelStyle.box": {
    label: bi("text box", "خلفية النص"),
    preset: false,
    read: (feature) => labelStyleOf(feature)?.box,
    write: (feature, patch) => {
      const box = patch["labelStyle.box"];
      return box === undefined ? feature : withLabelStyle(feature, { box });
    },
  },
  "point.symbol": {
    label: bi("symbol", "الرمز"),
    preset: false,
    read: (feature) => (feature.kind === "point" ? feature.symbol : undefined),
    write: (feature, patch) => {
      const symbol = patch["point.symbol"];
      if (symbol === undefined || feature.kind !== "point") return feature;
      return { ...feature, symbol: "number" in symbol ? { number: symbol.number.slice(0, 3) } : symbol };
    },
  },
  "point.size": {
    label: bi("icon size", "حجم الرمز"),
    preset: false,
    read: (feature) => (feature.kind === "point" ? feature.size : undefined),
    write: (feature, patch) => {
      const size = patch["point.size"];
      return size === undefined || feature.kind !== "point" ? feature : { ...feature, size: Math.max(1, size) };
    },
  },
  "annotation.text": {
    label: bi("text", "النص"),
    preset: false,
    read: (feature) => (feature.kind === "annotation" ? feature.text : undefined),
    write: (feature, patch) => {
      const text = patch["annotation.text"];
      return text === undefined || feature.kind !== "annotation" ? feature : { ...feature, text };
    },
  },
  "annotation.leader": {
    label: bi("leader line", "خط الإشارة"),
    preset: false,
    read: (feature) => (feature.kind === "annotation" ? feature.leader : undefined),
    write: (feature, patch) => {
      const leader = patch["annotation.leader"];
      return leader === undefined || feature.kind !== "annotation" ? feature : { ...feature, leader };
    },
  },
  "arrow.curvature": {
    label: bi("arrow curve", "انحناء السهم"),
    preset: false,
    read: (feature) => (feature.kind === "arrow" ? feature.curvature : undefined),
    write: (feature, patch) => {
      const curvature = patch["arrow.curvature"];
      return curvature === undefined || feature.kind !== "arrow"
        ? feature
        : { ...feature, curvature: clamp01(curvature) };
    },
  },
  "arrow.bend": {
    label: bi("arrow curve direction", "جهة انحناء السهم"),
    preset: false,
    read: (feature) => (feature.kind === "arrow" ? (feature.bend ?? "left") : undefined),
    write: (feature, patch) => {
      const bend = patch["arrow.bend"];
      return bend === undefined || feature.kind !== "arrow" ? feature : { ...feature, bend };
    },
  },
  "arrow.head": {
    label: bi("arrow head", "رأس السهم"),
    preset: false,
    read: (feature) => (feature.kind === "arrow" ? feature.head : undefined),
    write: (feature, patch) => {
      const head = patch["arrow.head"];
      return head === undefined || feature.kind !== "arrow" ? feature : { ...feature, head };
    },
  },
  "arrow.tapered": {
    label: bi("arrow taper", "استدقاق السهم"),
    preset: false,
    read: (feature) => (feature.kind === "arrow" ? feature.tapered : undefined),
    write: (feature, patch) => {
      const tapered = patch["arrow.tapered"];
      return tapered === undefined || feature.kind !== "arrow" ? feature : { ...feature, tapered };
    },
  },
  "frontline.facing": {
    label: bi("front line side", "جهة خط الجبهة"),
    preset: false,
    read: (feature) => (feature.kind === "frontline" ? feature.facing : undefined),
    write: (feature, patch) => {
      const facing = patch["frontline.facing"];
      return facing === undefined || feature.kind !== "frontline" ? feature : { ...feature, facing };
    },
  },
  "frontline.toothShape": {
    label: bi("tooth shape", "شكل الأسنان"),
    preset: false,
    read: (feature) => (feature.kind === "frontline" ? feature.toothShape : undefined),
    write: (feature, patch) => {
      const toothShape = patch["frontline.toothShape"];
      return toothShape === undefined || feature.kind !== "frontline" ? feature : { ...feature, toothShape };
    },
  },
  "frontline.toothSpacing": {
    label: bi("tooth spacing", "تباعد الأسنان"),
    preset: false,
    read: (feature) => (feature.kind === "frontline" ? feature.toothSpacing : undefined),
    write: (feature, patch) => {
      const toothSpacing = patch["frontline.toothSpacing"];
      return toothSpacing === undefined || feature.kind !== "frontline"
        ? feature
        : { ...feature, toothSpacing: Math.max(1, toothSpacing) };
    },
  },
  "frontline.toothSize": {
    label: bi("tooth size", "حجم الأسنان"),
    preset: false,
    read: (feature) => (feature.kind === "frontline" ? feature.toothSize : undefined),
    write: (feature, patch) => {
      const toothSize = patch["frontline.toothSize"];
      return toothSize === undefined || feature.kind !== "frontline"
        ? feature
        : { ...feature, toothSize: Math.max(1, toothSize) };
    },
  },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Every style property name, in inspector order. */
export const STYLE_PROPERTIES: StyleProperty[] = [
  "color",
  "fill.color",
  "fill.opacity",
  "fill.pattern",
  "stroke.color",
  "stroke.width",
  "stroke.opacity",
  "stroke.dash",
  "label",
  "labelStyle.color",
  "labelStyle.size",
  "labelStyle.weight",
  "labelStyle.halo",
  "labelStyle.box",
  "point.symbol",
  "point.size",
  "annotation.text",
  "annotation.leader",
  "arrow.curvature",
  "arrow.bend",
  "arrow.head",
  "arrow.tapered",
  "frontline.facing",
  "frontline.toothShape",
  "frontline.toothSpacing",
  "frontline.toothSize",
];

/** What a style property is called in a sentence ("Change fill opacity"). */
export function stylePropertyLabel(property: StyleProperty): Bilingual {
  return SPECS[property].label;
}

/** The properties a patch names. */
export function patchProperties(patch: StylePatch): StyleProperty[] {
  return STYLE_PROPERTIES.filter((property) => patch[property] !== undefined);
}

/** A feature's value for one property through its preset; undefined when its kind has no such property. */
export function readStyle<K extends StyleProperty>(
  feature: MapFeature,
  property: K,
  presets: PresetLookup,
): StyleValues[K] | undefined {
  return SPECS[property].read(feature, resolveStyle(feature, presets));
}

/**
 * A feature with the patch applied. Properties its kind lacks are skipped. If
 * the patch touches anything a preset governs, the preset is detached first so
 * the change is visible.
 */
export function applyStylePatch(feature: MapFeature, patch: StylePatch, presets: PresetLookup): MapFeature {
  const properties = patchProperties(patch);
  let next = feature;
  if (next.presetId !== null && properties.some((property) => SPECS[property].preset)) {
    next = detachPreset(next, presets);
  }
  for (const property of properties) next = SPECS[property].write(next, patch);
  return next;
}
