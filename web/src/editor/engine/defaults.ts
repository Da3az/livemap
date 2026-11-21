import type {
  AnnotationFeature,
  AreaFeature,
  ArrowFeature,
  FeatureBase,
  FrontlineFeature,
  LineFeature,
  LngLat,
  MapFeature,
  PointFeature,
} from "@/model/types";

/** What a tool produces before the caller's draw defaults are applied. */

const PROTECTED_KEYS: ReadonlySet<string> = new Set([
  "id",
  "kind",
  "order",
  "rings",
  "path",
  "control",
  "at",
  "anchor",
  "textAt",
  "updatedAt",
  "updatedBy",
]);

export interface NewFeatureContext {
  id: string;
  order: string;
  dir: "ltr" | "rtl";
  defaults: Partial<MapFeature>;
}

function base(context: NewFeatureContext): FeatureBase {
  return {
    id: context.id,
    order: context.order,
    name: { value: "", dir: context.dir },
    groupId: null,
    hidden: false,
    locked: false,
    presetId: null,
    validFrom: null,
    validTo: null,
    lineageId: null,
    updatedAt: new Date().toISOString(),
    updatedBy: "",
  };
}

/**
 * Applies the caller's draw defaults. Only fields the new feature already has
 * are taken, so defaults left over from another tool (a fill, when drawing a
 * line) are ignored, and identity and geometry can never be overwritten.
 */
function withDefaults<F extends MapFeature>(feature: F, defaults: Partial<MapFeature>): F {
  if (defaults.kind !== undefined && defaults.kind !== feature.kind) return feature;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (value !== undefined && key in feature && !PROTECTED_KEYS.has(key)) patch[key] = value;
  }
  return Object.assign({ ...feature }, patch);
}

export function newArea(context: NewFeatureContext, ring: LngLat[]): AreaFeature {
  const first = ring[0];
  const feature: AreaFeature = {
    ...base(context),
    kind: "area",
    rings: [first ? [...ring, first] : []],
    fill: { color: { slot: 1 }, opacity: 0.35, pattern: "none" },
    stroke: { color: { slot: 1 }, width: 2, opacity: 1, dash: "solid" },
  };
  return withDefaults(feature, context.defaults);
}

export function newLine(context: NewFeatureContext, path: LngLat[]): LineFeature {
  const feature: LineFeature = {
    ...base(context),
    kind: "line",
    path,
    stroke: { color: { slot: 2 }, width: 3, opacity: 1, dash: "solid" },
  };
  return withDefaults(feature, context.defaults);
}

export function newArrow(context: NewFeatureContext, control: LngLat[]): ArrowFeature {
  const feature: ArrowFeature = {
    ...base(context),
    kind: "arrow",
    control,
    curvature: 1,
    head: "single",
    tapered: false,
    stroke: { color: { slot: 1 }, width: 4, opacity: 1, dash: "solid" },
  };
  return withDefaults(feature, context.defaults);
}

export function newFrontline(context: NewFeatureContext, path: LngLat[]): FrontlineFeature {
  const feature: FrontlineFeature = {
    ...base(context),
    kind: "frontline",
    path,
    facing: "left",
    toothShape: "triangle",
    toothSpacing: 22,
    toothSize: 9,
    stroke: { color: { slot: 1 }, width: 3, opacity: 1, dash: "solid" },
  };
  return withDefaults(feature, context.defaults);
}

export function newPoint(context: NewFeatureContext, at: LngLat): PointFeature {
  const feature: PointFeature = {
    ...base(context),
    kind: "point",
    at,
    symbol: { icon: "pin" },
    color: { slot: 1 },
    size: 26,
  };
  return withDefaults(feature, context.defaults);
}

export function newAnnotation(context: NewFeatureContext, anchor: LngLat, textAt: LngLat): AnnotationFeature {
  const feature: AnnotationFeature = {
    ...base(context),
    kind: "annotation",
    anchor,
    textAt,
    text: { value: context.dir === "rtl" ? "نص" : "Text", dir: context.dir },
    labelStyle: { color: "ink", size: 13, weight: 600, halo: true, box: true },
    leader: { shape: "straight", anchorDot: true },
  };
  return withDefaults(feature, context.defaults);
}
