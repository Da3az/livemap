/**
 * GeoJSON out: what the editor would publish, as a FeatureCollection other
 * tools can read, with `livemap:*` properties that keep what simplestyle
 * cannot say.
 */
import type { ArrowFeature, ColorRef, DashStyle, LngLat, MapFeature, PaletteSlot, StylePreset } from "@/model/types";
import { sampleCurve } from "@/render/curve";
import { lngLatToMerc, mercToLngLat } from "@/render/geo";
import { sortKeyed } from "./ordering";
import { presetLookup, resolveStyle } from "./style";

/** The light-basemap hex of each palette slot (DESIGN.md), used when an export needs a literal colour. */
export const PALETTE_HEX: Record<PaletteSlot, string> = {
  1: "#b0250f",
  2: "#3854c3",
  3: "#cfa200",
  4: "#136a42",
  5: "#863079",
  6: "#2fa3e7",
  7: "#be639b",
  8: "#689339",
};

/** A GeoJSON geometry as exported. */
export type ExportGeometry =
  | { type: "Point"; coordinates: LngLat }
  | { type: "LineString"; coordinates: LngLat[] }
  | { type: "Polygon"; coordinates: LngLat[][] };

/** A GeoJSON feature as exported. */
export interface ExportFeature {
  type: "Feature";
  id: string;
  geometry: ExportGeometry;
  properties: Record<string, string | number | boolean | number[] | null>;
}

/** A GeoJSON FeatureCollection as exported. `JSON.stringify` it for a file. */
export interface ExportCollection {
  type: "FeatureCollection";
  features: ExportFeature[];
}

/** What the export needs besides the features. */
export interface ExportOptions {
  /** The map's presets, so features that follow one export its look. */
  presets?: readonly StylePreset[];
  /** Turn a colour reference into a hex. Default: the light palette. */
  resolveColor?: (color: ColorRef) => string;
  /** Include features the editor hid. Default false, matching what is published. */
  includeHidden?: boolean;
  /** Ids of hidden groups, whose features count as hidden. */
  hiddenGroupIds?: ReadonlySet<string>;
}

/**
 * The line an arrow is drawn along, sampled with the renderer's own curve in
 * Web Mercator: a spline through three or more control points, or the arc of
 * a two-point arrow bowed to its `bend` side. An exported arrow lies where
 * the map draws it.
 */
function arrowLine(feature: ArrowFeature): LngLat[] {
  const control = feature.control.map(lngLatToMerc);
  return sampleCurve(control, feature.curvature, feature.bend ?? "left").map(mercToLngLat);
}

function dashValue(dash: DashStyle): string | number[] {
  return typeof dash === "string" ? dash : dash.custom;
}

/**
 * Features as a GeoJSON FeatureCollection, in draw order (bottom first).
 * Areas export as polygons, lines and front lines as lines, arrows as the
 * curve the map draws, icons as points and annotations as points at the anchor
 * with the text in `text`. Style goes into simplestyle properties (`stroke`,
 * `stroke-width`, `stroke-opacity`, `fill`, `fill-opacity`, `marker-color`)
 * so other tools show a similar map, plus `livemap:*` properties that keep
 * what simplestyle cannot say (kind, palette slots, dash, pattern, dates).
 */
export function exportGeoJson(features: Iterable<MapFeature>, options: ExportOptions = {}): ExportCollection {
  const presets = presetLookup(options.presets ?? []);
  const hex = options.resolveColor ?? ((color: ColorRef): string => ("slot" in color ? PALETTE_HEX[color.slot] : color.custom));
  const hiddenGroups = options.hiddenGroupIds ?? new Set<string>();
  const out: ExportFeature[] = [];

  for (const feature of sortKeyed(features)) {
    const hidden = feature.hidden || (feature.groupId !== null && hiddenGroups.has(feature.groupId));
    if (hidden && options.includeHidden !== true) continue;
    const style = resolveStyle(feature, presets);
    const properties: ExportFeature["properties"] = { name: feature.name.value, "livemap:kind": feature.kind };
    if (feature.kind !== "annotation" && feature.label !== undefined) properties.label = feature.label.value;
    if (feature.validFrom !== null) properties["livemap:valid-from"] = feature.validFrom;
    if (feature.validTo !== null) properties["livemap:valid-to"] = feature.validTo;
    if (style.stroke !== null) {
      properties.stroke = hex(style.stroke.color);
      properties["stroke-width"] = style.stroke.width;
      properties["stroke-opacity"] = style.stroke.opacity;
      properties["livemap:dash"] = dashValue(style.stroke.dash);
      if ("slot" in style.stroke.color) properties["livemap:stroke-slot"] = style.stroke.color.slot;
    }
    if (style.fill !== null) {
      properties.fill = hex(style.fill.color);
      properties["fill-opacity"] = style.fill.opacity;
      properties["livemap:pattern"] = style.fill.pattern;
      if ("slot" in style.fill.color) properties["livemap:fill-slot"] = style.fill.color.slot;
    }

    let geometry: ExportGeometry;
    switch (feature.kind) {
      case "area":
        geometry = { type: "Polygon", coordinates: feature.rings };
        break;
      case "line":
        geometry = { type: "LineString", coordinates: feature.path };
        break;
      case "frontline":
        geometry = { type: "LineString", coordinates: feature.path };
        properties["livemap:facing"] = feature.facing;
        properties["livemap:tooth-shape"] = feature.toothShape;
        break;
      case "arrow":
        geometry = { type: "LineString", coordinates: arrowLine(feature) };
        properties["livemap:head"] = feature.head;
        properties["livemap:tapered"] = feature.tapered;
        break;
      case "point":
        geometry = { type: "Point", coordinates: feature.at };
        if (style.color !== null) {
          properties["marker-color"] = hex(style.color);
          if ("slot" in style.color) properties["livemap:marker-slot"] = style.color.slot;
        }
        properties["marker-size"] = feature.size;
        properties["livemap:symbol"] = "icon" in feature.symbol ? feature.symbol.icon : feature.symbol.number;
        break;
      case "annotation":
        geometry = { type: "Point", coordinates: feature.anchor };
        properties.text = feature.text.value;
        properties["livemap:text-dir"] = feature.text.dir;
        properties["livemap:text-at"] = [feature.textAt[0], feature.textAt[1]];
        break;
    }
    out.push({ type: "Feature", id: feature.id, geometry, properties });
  }
  return { type: "FeatureCollection", features: out };
}
