// One layer per geometry class; all styling is data-driven from the properties
// `buildSources` writes.

import { SOURCE_IDS } from "./sources.js";

export const LAYER_IDS = {
  areaFill: "lm-area-fill",
  areaStroke: "lm-area-stroke",
  areaStrokeDashed: "lm-area-stroke-dashed",
  teeth: "lm-teeth-fill",
  lines: "lm-lines",
  linesDashed: "lm-lines-dashed",
  markers: "lm-markers",
  labels: "lm-labels",
} as const;

/** Font stack. Must exist in the style's glyph endpoint. */
export type FontStack = readonly string[];

export interface LayerOptions {
  /** Glyph fonts. The default relies on the basemap style's stack. */
  readonly fonts?: FontStack;
  /** Insert our layers beneath this existing layer id, if present. */
  readonly beforeId?: string;
}

const DEFAULT_FONTS: FontStack = ["Noto Sans Regular"];

// Dash arrays cannot be data-driven in MapLibre, so dashed geometry needs its
// own layer filtered on `hasDash`.
const DASH_PATTERN = [2, 1.5];

export function buildLayers(options: LayerOptions = {}): unknown[] {
  const fonts = options.fonts ?? DEFAULT_FONTS;

  return [
    {
      id: LAYER_IDS.areaFill,
      type: "fill",
      source: SOURCE_IDS.areas,
      // *-sort-key is a LAYOUT property, not paint. In paint MapLibre rejects
      // the whole layer.
      layout: { "fill-sort-key": ["get", "sortKey"] },
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": ["get", "fillOpacity"],
      },
    },
    {
      id: LAYER_IDS.areaStroke,
      type: "line",
      source: SOURCE_IDS.areas,
      filter: ["==", ["get", "hasDash"], 0],
      layout: {
        "line-cap": "round",
        "line-join": "round",
        "line-sort-key": ["get", "sortKey"],
      },
      paint: {
        "line-color": ["get", "strokeColor"],
        "line-width": ["get", "strokeWidth"],
        "line-opacity": ["get", "strokeOpacity"],
      },
    },
    {
      id: LAYER_IDS.areaStrokeDashed,
      type: "line",
      source: SOURCE_IDS.areas,
      filter: ["==", ["get", "hasDash"], 1],
      layout: {
        "line-cap": "butt",
        "line-join": "round",
        "line-sort-key": ["get", "sortKey"],
      },
      paint: {
        "line-color": ["get", "strokeColor"],
        "line-width": ["get", "strokeWidth"],
        "line-opacity": ["get", "strokeOpacity"],
        "line-dasharray": DASH_PATTERN,
      },
    },
    {
      // Teeth sit under the base line so the base reads as a continuous edge.
      id: LAYER_IDS.teeth,
      type: "fill",
      source: SOURCE_IDS.teeth,
      layout: { "fill-sort-key": ["get", "sortKey"] },
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": ["get", "fillOpacity"],
      },
    },
    {
      id: LAYER_IDS.lines,
      type: "line",
      source: SOURCE_IDS.lines,
      filter: ["==", ["get", "hasDash"], 0],
      layout: {
        "line-cap": "round",
        "line-join": "round",
        "line-sort-key": ["get", "sortKey"],
      },
      paint: {
        "line-color": ["get", "strokeColor"],
        "line-width": ["get", "strokeWidth"],
        "line-opacity": ["get", "strokeOpacity"],
      },
    },
    {
      id: LAYER_IDS.linesDashed,
      type: "line",
      source: SOURCE_IDS.lines,
      filter: ["==", ["get", "hasDash"], 1],
      layout: {
        "line-cap": "butt",
        "line-join": "round",
        "line-sort-key": ["get", "sortKey"],
      },
      paint: {
        "line-color": ["get", "strokeColor"],
        "line-width": ["get", "strokeWidth"],
        "line-opacity": ["get", "strokeOpacity"],
        "line-dasharray": DASH_PATTERN,
      },
    },
    {
      id: LAYER_IDS.markers,
      type: "symbol",
      source: SOURCE_IDS.markers,
      layout: {
        "icon-image": ["get", "image"],
        "icon-size": ["get", "iconSize"],
        "icon-rotate": ["get", "iconRotate"],
        // "map" keeps arrowheads tangent to their curve under rotate/pitch.
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        // Required: the collision engine otherwise silently drops arrowheads.
        "icon-ignore-placement": true,
        "icon-anchor": "center",
        "symbol-sort-key": ["get", "sortKey"],
        "symbol-z-order": "source",
      },
      paint: {
        "icon-opacity": ["get", "opacity"],
      },
    },
    {
      id: LAYER_IDS.labels,
      type: "symbol",
      source: SOURCE_IDS.labels,
      layout: {
        "text-field": ["get", "text"],
        "text-font": fonts,
        "text-size": ["get", "textSize"],
        // No `text-offset`: de-confliction bakes the offset into the label's
        // point geometry, so a style-level offset would double-apply it.
        "text-anchor": "center",
        "text-max-width": 14,
        // We de-conflict in `sources.ts`; the built-in engine must not also
        // hide labels we placed.
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "symbol-sort-key": ["get", "sortKey"],
      },
      paint: {
        "text-color": ["get", "textColor"],
        "text-halo-color": ["get", "haloColor"],
        // Never below 1.01 — MapLibre #8949 cuts Arabic glyph joins at <= 1px.
        // `normaliseHaloWidth` enforces the floor upstream.
        "text-halo-width": ["get", "haloWidth"],
      },
    },
  ];
}

/** Layer ids in paint order, bottom first. */
export const LAYER_ORDER: readonly string[] = [
  LAYER_IDS.areaFill,
  LAYER_IDS.areaStroke,
  LAYER_IDS.areaStrokeDashed,
  LAYER_IDS.teeth,
  LAYER_IDS.lines,
  LAYER_IDS.linesDashed,
  LAYER_IDS.markers,
  LAYER_IDS.labels,
];
