// Owns the livemap sources and layers on a map and keeps them in sync with the
// view. Rebuilds are debounced because the built geometry depends on zoom.

import type { MapFeature } from "@livemap/core";
import { buildSources, SOURCE_IDS, type BuiltSources } from "./sources.js";
import { buildLayers, LAYER_ORDER, type LayerOptions } from "./layers.js";
import {
  ensureAnchorDot,
  ensureArrowhead,
  ensureChevron,
  eventIconImage,
  type ImageHost,
} from "./sprites.js";

/** The slice of the MapLibre Map API used here. Structural, so a stub satisfies it. */
export interface MapLike extends ImageHost {
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addSource(id: string, source: unknown): void;
  removeSource(id: string): void;
  getLayer(id: string): unknown | undefined;
  addLayer(layer: unknown, beforeId?: string): void;
  removeLayer(id: string): void;
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  /**
   * `width`/`height` are DEVICE pixels; `clientWidth`/`clientHeight` are CSS
   * pixels. Label layout is CSS px, so it must use the client dimensions.
   */
  getCanvas(): {
    width: number;
    height: number;
    clientWidth?: number;
    clientHeight?: number;
  };
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
  isStyleLoaded(): boolean;
}

export interface IconSource {
  /** Raw SVG text for an icon id, e.g. `"ocha:Refugee"`. null = unknown. */
  resolve(iconId: string): Promise<string | null>;
}

export interface RendererOptions extends LayerOptions {
  readonly icons?: IconSource;
  /** Zoom delta that should trigger a rebuild. See `scheduleRebuild`. */
  readonly zoomEpsilon?: number;
  /** Debounce for view-driven rebuilds, ms. */
  readonly debounceMs?: number;
  /** Regions labels must avoid, in CSS px relative to the viewport. */
  readonly obstacles?: readonly { x: number; y: number; width: number; height: number }[];
}

const DEFAULTS = {
  zoomEpsilon: 0.25,
  debounceMs: 60,
} as const;

export class OverlayRenderer {
  private readonly map: MapLike;
  private readonly options: RendererOptions;
  private features: readonly MapFeature[] = [];
  private attached = false;
  private lastZoom = Number.NaN;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  // Kept because MapLibre exposes no public way to read a source's data back
  // (`source._data` is private and absent in 6.x).
  private lastSources: BuiltSources | null = null;

  /** Icon ids whose image is registered and ready. */
  private readonly readyIcons = new Set<string>();
  /** Icon ids currently being fetched, to avoid duplicate requests. */
  private readonly pendingIcons = new Set<string>();

  private readonly onViewChange = () => this.scheduleRebuild();

  // A rebuild was requested while the style was not ready. Without the retry
  // the map stays blank forever, with no error.
  private pendingRebuild = false;

  private readonly onStyleData = () => {
    if (this.pendingRebuild) this.rebuild();
  };

  constructor(map: MapLike, options: RendererOptions = {}) {
    this.map = map;
    this.options = { ...DEFAULTS, ...options };
  }

  /**
   * Add sources and layers; deferred if the style is not loaded yet.
   * `addSource` throws "Style is not done loading", and `map.loaded()` / the
   * `load` event are not sufficient guards — only `isStyleLoaded()` is.
   */
  attach(): void {
    if (this.attached || this.destroyed || this.attachPending) return;

    if (!this.map.isStyleLoaded()) {
      this.attachPending = true;
      const retry = () => {
        if (this.destroyed) return;
        if (!this.map.isStyleLoaded()) return;
        this.map.off("styledata", retry);
        this.map.off("load", retry);
        this.map.off("idle", retry);
        this.attachPending = false;
        this.attach();
      };
      this.map.on("styledata", retry);
      this.map.on("load", retry);
      this.map.on("idle", retry);
      return;
    }

    this.doAttach();
  }

  private attachPending = false;

  private doAttach(): void {
    for (const id of Object.values(SOURCE_IDS)) {
      if (!this.map.getSource(id)) {
        this.map.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
    }

    for (const layer of buildLayers(this.options)) {
      const id = (layer as { id: string }).id;
      if (!this.map.getLayer(id)) {
        if (this.options.beforeId && this.map.getLayer(this.options.beforeId)) {
          this.map.addLayer(layer, this.options.beforeId);
        } else {
          this.map.addLayer(layer);
        }
      }
    }

    this.map.on("zoom", this.onViewChange);
    this.map.on("move", this.onViewChange);
    // `load` and `styledata` are one-shot edges that may already have fired by
    // the time we subscribe. `idle` re-fires whenever rendering settles, so it
    // is the reliable retry hook.
    this.map.on("styledata", this.onStyleData);
    this.map.on("load", this.onStyleData);
    this.map.on("idle", this.onStyleData);
    this.attached = true;
    this.rebuild();
  }

  detach(): void {
    if (!this.attached) return;
    this.map.off("zoom", this.onViewChange);
    this.map.off("move", this.onViewChange);
    this.map.off("styledata", this.onStyleData);
    this.map.off("load", this.onStyleData);
    this.map.off("idle", this.onStyleData);

    // Layers must go before their sources, or MapLibre throws.
    for (const id of [...LAYER_ORDER].reverse()) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const id of Object.values(SOURCE_IDS)) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
    this.attached = false;
  }

  destroy(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.detach();
    this.destroyed = true;
  }

  /** Replace the feature set and rebuild immediately. */
  setFeatures(features: readonly MapFeature[]): void {
    this.features = features;
    void this.loadMissingIcons();
    if (this.attached) this.rebuild();
  }

  getFeatures(): readonly MapFeature[] {
    return this.features;
  }

  // No zoom-delta early return: pan also shifts the viewport that label
  // de-confliction runs against, so it rebuilds too. `zoomEpsilon` is unused
  // until there is a label-only fast path.
  private scheduleRebuild(): void {
    if (this.destroyed || !this.attached) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.rebuild();
    }, this.options.debounceMs ?? DEFAULTS.debounceMs);
  }

  rebuild(): void {
    if (this.destroyed || !this.attached) return;
    if (!this.map.isStyleLoaded()) {
      this.pendingRebuild = true;
      return;
    }
    this.pendingRebuild = false;

    const zoom = this.map.getZoom();
    this.lastZoom = zoom;

    const canvas = this.map.getCanvas();
    const center = this.map.getCenter();

    // CSS pixels, not device pixels — see `getCanvas` above. The fallback is
    // wrong but tolerated for stubs that omit the client fields.
    const viewW = canvas.clientWidth ?? canvas.width;
    const viewH = canvas.clientHeight ?? canvas.height;

    const sources: BuiltSources = buildSources(this.features, {
      zoom,
      viewportPx: { width: viewW, height: viewH },
      center: [center.lng, center.lat],
      ...(this.options.obstacles ? { obstaclesPx: this.options.obstacles } : {}),
      resolveIcon: (iconId, color) => {
        const id = iconImageId(iconId, color);
        return this.readyIcons.has(id) ? id : null;
      },
      resolveArrowhead: (color) => ensureArrowhead(this.map, color),
      resolveChevron: (color) => ensureChevron(this.map, color),
      resolveAnchorDot: (fill, ring) => ensureAnchorDot(this.map, fill, ring),
    });

    this.lastSources = sources;
    for (const [id, data] of Object.entries(sources)) {
      this.map.getSource(id)?.setData(data);
    }
  }

  /** The sources produced by the last `rebuild()`, or null before the first. */
  getLastSources(): BuiltSources | null {
    return this.lastSources;
  }

  // One image per (icon, colour) pair, since the glyph is recoloured at
  // composite time.
  private async loadMissingIcons(): Promise<void> {
    const source = this.options.icons;
    if (!source) return;

    const wanted = new Map<string, { icon: string; color: string }>();
    for (const f of this.features) {
      if (f.kind !== "point") continue;
      const id = iconImageId(f.icon, f.iconColor);
      if (this.readyIcons.has(id) || this.pendingIcons.has(id)) continue;
      wanted.set(id, { icon: f.icon, color: f.iconColor });
    }
    if (wanted.size === 0) return;

    for (const id of wanted.keys()) this.pendingIcons.add(id);

    await Promise.all(
      [...wanted].map(async ([id, { icon, color }]) => {
        try {
          const svg = await source.resolve(icon);
          if (!svg) return;
          if (this.destroyed) return;
          if (!this.map.hasImage(id)) {
            const img = await eventIconImage(svg, {
              discFill: color,
              glyphColor: "#ffffff",
              discRing: "#ffffff",
            });
            if (this.destroyed) return;
            this.map.addImage(id, img, { pixelRatio: img.pixelRatio });
          }
          this.readyIcons.add(id);
        } catch {
          // One bad icon must not abort the batch. It stays out of readyIcons,
          // so its markers are skipped.
        } finally {
          this.pendingIcons.delete(id);
        }
      }),
    );

    if (!this.destroyed && this.attached) this.rebuild();
  }
}

/** Image id for an (icon, colour) pair. */
export const iconImageId = (iconId: string, color: string): string =>
  `lm:icon:${iconId}:${color}`;
