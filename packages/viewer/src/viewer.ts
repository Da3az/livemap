// Read-only viewer. Never touches the database: it fetches a pointer
// (`latest.json`) and an immutable version artifact (`v/N.json`) from a CDN.

import type { MapVersion } from "@livemap/core";
import { labelExpression } from "@livemap/core";
import { OverlayRenderer, type IconSource, type MapLike } from "@livemap/renderer";
import { UpdatePoller, type PointerDoc, LANE_NORMAL_MS } from "./poll.js";

export interface ViewerOptions {
  /**
   * Base URL for the map's artifacts. The pointer is `${base}/latest.json`,
   * versions are `${base}/v/N.json`.
   */
  readonly baseUrl: string;
  /** Resolve a basemap style id to a style URL or inline style object. */
  readonly resolveStyle: (styleId: string) => string | object;
  readonly icons?: IconSource;
  /** Poll for updates. Off by default — most embeds are static snapshots. */
  readonly poll?: boolean;
  readonly pollIntervalMs?: number;
  readonly interactive?: boolean;
  readonly onVersion?: (version: MapVersion) => void;
  readonly onError?: (error: unknown) => void;
  readonly fetchImpl?: typeof fetch;
}

/** Keeps the viewer from hard-depending on maplibre-gl; tests pass a stub. */
export interface MapFactory {
  create(options: {
    container: HTMLElement;
    style: string | object;
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
    interactive: boolean;
  }): MapLike & {
    once(event: string, handler: () => void): void;
    jumpTo(options: {
      center: [number, number];
      zoom: number;
      bearing: number;
      pitch: number;
    }): void;
    remove(): void;
    setLayoutProperty?(layer: string, prop: string, value: unknown): void;
  };
}

export class MapViewer {
  private readonly container: HTMLElement;
  private readonly options: ViewerOptions;
  private readonly factory: MapFactory;
  private map: ReturnType<MapFactory["create"]> | null = null;
  private renderer: OverlayRenderer | null = null;
  private poller: UpdatePoller | null = null;
  private current: MapVersion | null = null;
  private destroyed = false;

  constructor(
    container: HTMLElement,
    factory: MapFactory,
    options: ViewerOptions,
  ) {
    this.container = container;
    this.factory = factory;
    this.options = options;
  }

  get version(): MapVersion | null {
    return this.current;
  }

  /** Fetch the current version and render it. */
  async load(): Promise<void> {
    const pointer = await this.fetchPointer();
    await this.loadVersion(pointer.href);

    if (this.options.poll) {
      this.poller = new UpdatePoller({
        pointerUrl: this.pointerUrl(),
        intervalMs: this.options.pollIntervalMs ?? LANE_NORMAL_MS,
        onUpdate: (p) => this.loadVersion(p.href),
        ...(this.options.onError ? { onError: this.options.onError } : {}),
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      });
      this.poller.start();
    }
  }

  private pointerUrl(): string {
    return `${this.options.baseUrl.replace(/\/$/, "")}/latest.json`;
  }

  private async fetchPointer(): Promise<PointerDoc> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const res = await doFetch(this.pointerUrl(), { credentials: "omit" });
    if (!res.ok) throw new Error(`pointer fetch failed: ${res.status}`);
    return (await res.json()) as PointerDoc;
  }

  private async loadVersion(href: string): Promise<void> {
    if (this.destroyed) return;
    const doFetch = this.options.fetchImpl ?? fetch;
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/${href.replace(/^\//, "")}`;

    const res = await doFetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`version fetch failed: ${res.status}`);
    const version = (await res.json()) as MapVersion;
    if (this.destroyed) return;

    this.current = version;
    this.render(version);
    this.options.onVersion?.(version);
  }

  private render(version: MapVersion): void {
    // Direction goes on the container, not just the labels, so a legend or
    // attribution mirrors too via CSS logical properties.
    this.container.dir = version.uiDir === "auto" ? "auto" : version.uiDir;

    if (!this.map) {
      this.map = this.factory.create({
        container: this.container,
        style: this.options.resolveStyle(version.basemap.styleId),
        center: [version.viewport.center[0], version.viewport.center[1]],
        zoom: version.viewport.zoom,
        bearing: version.viewport.bearing,
        pitch: version.viewport.pitch,
        interactive: this.options.interactive ?? false,
      });

      const attach = () => {
        if (this.destroyed || !this.map) return;
        this.renderer = new OverlayRenderer(this.map, {
          ...(this.options.icons ? { icons: this.options.icons } : {}),
        });
        this.renderer.attach();
        this.renderer.setFeatures(version.features);
        this.applyBasemapLanguage(version);
      };

      // `load` may already have fired for a synchronous stub map.
      if (this.map.isStyleLoaded()) attach();
      else this.map.once("load", attach);
      return;
    }

    // Jump rather than animate: a reader watching a live event should not have
    // the ground slide under them because an editor nudged the viewport.
    this.map.jumpTo({
      center: [version.viewport.center[0], version.viewport.center[1]],
      zoom: version.viewport.zoom,
      bearing: version.viewport.bearing,
      pitch: version.viewport.pitch,
    });
    this.renderer?.setFeatures(version.features);
    this.applyBasemapLanguage(version);
  }

  private applyBasemapLanguage(version: MapVersion): void {
    const map = this.map;
    if (!map?.setLayoutProperty) return;
    const expr = labelExpression(version.basemap.labelLangs);
    for (const layerId of BASEMAP_LABEL_LAYERS) {
      if (!map.getLayer(layerId)) continue;
      try {
        map.setLayoutProperty(layerId, "text-field", expr);
      } catch {
        // A style we do not control may lack the layer or reject the
        // expression. Default-language labels beat blanking the whole map.
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.poller?.destroy();
    this.poller = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.map?.remove();
    this.map = null;
  }
}

// Listed explicitly rather than scanning every symbol layer: overwriting
// `text-field` on a non-place label, such as a road shield, corrupts it.
const BASEMAP_LABEL_LAYERS: readonly string[] = [
  "place_label_city",
  "place_label_town",
  "place_label_village",
  "place_label_other",
  "place_country",
  "place_state",
  "country_label",
  "state_label",
  "settlement_label",
  "settlement_subdivision_label",
  "water_name",
  "waterway_name",
];
