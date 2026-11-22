import type { CustomLayerInterface } from "maplibre-gl";
import type { MapLibreMap } from "../maplibre";
import { FEATURE_LAYER_ID, featureLayerBefore } from "./layer-position";

export interface FeatureLayerClient {
  /** The layer joined a style; `gl` may be a new context. */
  attach(gl: WebGL2RenderingContext): void;
  /** The layer left the style; GPU resources stay valid for a later `attach` on the same context. */
  detach(): void;
  draw(gl: WebGL2RenderingContext): void;
  /** The context is gone; drop GPU resources without deleting them. */
  contextLost(): void;
}

/**
 * The single owner of the feature layer's place in the map. A basemap swap
 * (`setStyle`, with or without a diff), the blank style a map starts on, and
 * a lost-and-restored WebGL context all leave the style without the layer;
 * after each, the layer is added again in its place (see layer-position.ts)
 * and its GPU resources re-created. Between those moments the layer is simply
 * absent: nothing draws and nothing throws.
 */
export class FeatureLayerOwner {
  private readonly layer: CustomLayerInterface;
  private readonly disposers: (() => void)[] = [];
  private destroyed = false;

  constructor(
    private readonly map: MapLibreMap,
    client: FeatureLayerClient,
  ) {
    this.layer = {
      id: FEATURE_LAYER_ID,
      type: "custom",
      renderingMode: "2d",
      onAdd: (_map, gl) => client.attach(gl),
      onRemove: () => client.detach(),
      render: (gl) => client.draw(gl),
    };
    const ensure = () => this.ensure();
    const lost = () => client.contextLost();
    /* `styledata` covers a diffed style change that removes the layer; `idle` retries anything that was not ready. */
    for (const event of ["style.load", "styledata", "idle", "webglcontextrestored"] as const) {
      map.on(event, ensure);
      this.disposers.push(() => map.off(event, ensure));
    }
    map.on("webglcontextlost", lost);
    this.disposers.push(() => map.off("webglcontextlost", lost));
    this.ensure();
  }

  /** Adds the layer if the style lacks it and moves it back if something was put above or below it. Never throws. */
  ensure(): void {
    if (this.destroyed) return;
    const { map } = this;
    try {
      const before = featureLayerBefore(map);
      if (!map.getLayer(FEATURE_LAYER_ID)) {
        map.addLayer(this.layer, before);
        return;
      }
      const order = map.getLayersOrder();
      const index = order.indexOf(FEATURE_LAYER_ID);
      const placed = before === undefined ? index === order.length - 1 : order[index + 1] === before;
      if (!placed) map.moveLayer(FEATURE_LAYER_ID, before);
    } catch {
      /* The style is between loads; the next `styledata`, `style.load` or `idle` tries again. */
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const dispose of this.disposers) dispose();
    try {
      if (this.map.getLayer(FEATURE_LAYER_ID)) this.map.removeLayer(FEATURE_LAYER_ID);
    } catch {
      /* A map mid-teardown has no style to remove from. */
    }
  }
}
