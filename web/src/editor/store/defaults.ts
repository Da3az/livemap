import type {
  AnnotationFeature,
  AreaFeature,
  ArrowFeature,
  ColorRef,
  FeatureBase,
  FeatureKind,
  Fill,
  FrontlineFeature,
  LabelStyle,
  LineFeature,
  LngLat,
  MapFeature,
  PointFeature,
  Stroke,
} from "@/model/types";
import type { ToolId } from "@/editor/controller";
import { KIND_NAMES, newId, rich } from "./text";
import type { UiDir } from "./doc";

/** The style the next drawn feature of each kind gets. `presetId` wins over the local style when set. */
export interface DrawDefaults {
  area: { presetId: string | null; fill: Fill; stroke: Stroke };
  line: { presetId: string | null; stroke: Stroke };
  arrow: {
    presetId: string | null;
    stroke: Stroke;
    curvature: number;
    bend: NonNullable<ArrowFeature["bend"]>;
    head: ArrowFeature["head"];
    tapered: boolean;
  };
  frontline: {
    presetId: string | null;
    stroke: Stroke;
    facing: FrontlineFeature["facing"];
    toothShape: FrontlineFeature["toothShape"];
    toothSpacing: number;
    toothSize: number;
  };
  point: { presetId: string | null; symbol: PointFeature["symbol"]; color: ColorRef; size: number };
  annotation: { labelStyle: LabelStyle; leader: AnnotationFeature["leader"] };
}

/** The label style a feature gets when it is first given a label. */
export const DEFAULT_LABEL_STYLE: LabelStyle = { color: "ink", size: 12, weight: 600, halo: true, box: false };

/** A solid stroke in a palette slot. */
export function defaultStroke(slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, width: number): Stroke {
  return { color: { slot }, width, opacity: 1, dash: "solid" };
}

/** What a new map starts with. Colours are palette slots, so they hold on light and dark basemaps. */
export function initialDrawDefaults(): DrawDefaults {
  return {
    area: {
      presetId: null,
      fill: { color: { slot: 1 }, opacity: 0.25, pattern: "none" },
      stroke: defaultStroke(1, 1.5),
    },
    line: { presetId: null, stroke: defaultStroke(2, 2.5) },
    arrow: { presetId: null, stroke: defaultStroke(1, 3), curvature: 0.5, bend: "left", head: "single", tapered: true },
    frontline: {
      presetId: null,
      stroke: defaultStroke(1, 2.5),
      facing: "left",
      toothShape: "triangle",
      toothSpacing: 18,
      toothSize: 7,
    },
    point: { presetId: null, symbol: { icon: "pin" }, color: { slot: 1 }, size: 22 },
    annotation: {
      labelStyle: { color: "ink", size: 13, weight: 600, halo: true, box: false },
      leader: { shape: "straight", anchorDot: true },
    },
  };
}

/**
 * The draw defaults of a tool in the shape `EditorController.setDrawDefaults`
 * takes. null for the select tool.
 */
export function controllerDrawDefaults(tool: ToolId, defaults: DrawDefaults): Partial<MapFeature> | null {
  switch (tool) {
    case "select":
      return null;
    case "area":
      return { kind: "area", ...defaults.area };
    case "line":
      return { kind: "line", ...defaults.line };
    case "arrow":
      return { kind: "arrow", ...defaults.arrow };
    case "frontline":
      return { kind: "frontline", ...defaults.frontline };
    case "point":
      return { kind: "point", ...defaults.point };
    case "annotation":
      return { kind: "annotation", ...defaults.annotation };
  }
}

/** The geometry that distinguishes one new feature from another of its kind. */
export type NewGeometry =
  | { kind: "area"; rings: LngLat[][] }
  | { kind: "line"; path: LngLat[] }
  | { kind: "arrow"; control: LngLat[] }
  | { kind: "frontline"; path: LngLat[] }
  | { kind: "point"; at: LngLat }
  | { kind: "annotation"; anchor: LngLat; textAt: LngLat; text: AnnotationFeature["text"] };

/** Everything a new feature needs besides its geometry and style. */
export interface NewFeatureContext {
  /** Draw-order key; the store replaces it when the feature is added. */
  order?: string;
  /** Leave empty and the store numbers it ("Area 4"). */
  name?: FeatureBase["name"];
  uiDir: UiDir;
  now: string;
  userId: string;
  id?: string;
}

/** A complete feature of the given geometry, styled from the draw defaults. */
export function buildFeature(geometry: NewGeometry, defaults: DrawDefaults, context: NewFeatureContext): MapFeature {
  const base: FeatureBase = {
    id: context.id ?? newId(),
    order: context.order ?? "",
    name: context.name ?? rich("", context.uiDir),
    groupId: null,
    hidden: false,
    locked: false,
    presetId: null,
    validFrom: null,
    validTo: null,
    lineageId: null,
    updatedAt: context.now,
    updatedBy: context.userId,
  };
  switch (geometry.kind) {
    case "area": {
      const feature: AreaFeature = { ...base, ...defaults.area, kind: "area", rings: geometry.rings };
      return feature;
    }
    case "line": {
      const feature: LineFeature = { ...base, ...defaults.line, kind: "line", path: geometry.path };
      return feature;
    }
    case "arrow": {
      const feature: ArrowFeature = { ...base, ...defaults.arrow, kind: "arrow", control: geometry.control };
      return feature;
    }
    case "frontline": {
      const feature: FrontlineFeature = { ...base, ...defaults.frontline, kind: "frontline", path: geometry.path };
      return feature;
    }
    case "point": {
      const feature: PointFeature = { ...base, ...defaults.point, kind: "point", at: geometry.at };
      return feature;
    }
    case "annotation": {
      const feature: AnnotationFeature = {
        ...base,
        ...defaults.annotation,
        kind: "annotation",
        anchor: geometry.anchor,
        textAt: geometry.textAt,
        text: geometry.text,
      };
      return feature;
    }
  }
}

/** "Area 4" / "منطقة 4": the name a feature gets when it arrives without one. */
export function defaultFeatureName(kind: FeatureKind, ordinal: number, uiDir: UiDir): FeatureBase["name"] {
  const word = KIND_NAMES[kind][uiDir === "rtl" ? "ar" : "en"];
  return rich(`${word} ${ordinal}`, uiDir);
}
