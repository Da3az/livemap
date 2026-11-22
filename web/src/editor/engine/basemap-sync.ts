import type { StyleSpecification } from "maplibre-gl";
import type { ThemeMode } from "@/editor/controller";
import type { BasemapStyleId, LabelLanguage } from "@/model/types";
import { blankStyle, buildBasemapStyle, effectiveStyleId, loadBasemapStyle } from "@/render/basemap";
import type { MapLibreMap } from "@/render/maplibre";
import type { Palette } from "@/render/palette";

/**
 * Fetches, restyles and sets the basemap. The features are a custom layer
 * inside the style, so a style change drops them; the renderer's own layer
 * owner (render/gl/feature-layer.ts) puts the layer back on every style load
 * and after a lost context, so nothing here has to. Selection and handles
 * stay on a canvas above the map. The latest request wins; an older fetch
 * that finishes late is ignored.
 */
export class BasemapSync {
  private request = 0;
  private shownStyleId: BasemapStyleId | null = null;
  /** One report per basemap: a failing tile server fails hundreds of requests. */
  tilesReported = false;

  constructor(
    private readonly map: MapLibreMap,
    private readonly ready: Promise<void>,
    private readonly onFailure: (detail: string) => void,
    private readonly isDestroyed: () => boolean,
  ) {}

  async apply(basemap: { styleId: BasemapStyleId; labelLanguage: LabelLanguage }, theme: ThemeMode, palette: Palette): Promise<void> {
    const request = ++this.request;
    const id = effectiveStyleId(basemap.styleId, theme);
    let style: StyleSpecification;
    let failure: string | null = null;
    try {
      const raw = await loadBasemapStyle(id);
      style = buildBasemapStyle(raw, id, { language: basemap.labelLanguage, palette });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      style = blankStyle(palette);
    }
    await this.ready;
    if (this.isDestroyed() || request !== this.request) return;
    this.tilesReported = failure !== null;
    if (failure !== null) this.onFailure(failure);
    /* Diffing is for a restyle of the same basemap (language, tint); a different one is replaced whole. */
    const sameBasemap = failure === null && this.shownStyleId === id && this.map.isStyleLoaded() === true;
    this.shownStyleId = failure === null ? id : null;
    this.map.setStyle(style, { diff: sameBasemap });
  }
}
