import type { MapLibreMap } from "../maplibre";

export const FEATURE_LAYER_ID = "livemap-features";

/**
 * Where the feature layer sits in the basemap's style. Decision P0.2b: the
 * whole layer, text included, draws above the basemap's own labels, which is
 * the top of the style. To put it under the basemap's place and road names
 * instead, change this one value to "below-basemap-labels".
 */
export const FEATURE_LAYER_PLACEMENT: "top" | "below-basemap-labels" = "top";

/**
 * The layer the feature layer must sit directly below, or undefined for the
 * top of the style. A style with no symbol layer has nothing to sit under,
 * so the layer then goes on top whatever the placement.
 */
export function featureLayerBefore(map: MapLibreMap): string | undefined {
  if (FEATURE_LAYER_PLACEMENT === "top") return undefined;
  const layers = map.getStyle()?.layers ?? [];
  return layers.find((layer) => layer.type === "symbol" && layer.id !== FEATURE_LAYER_ID)?.id;
}
