// One-way flow: input mutates the store, the store emits, renderer and UI re-read.

import { Map as MapLibreMap } from "maplibre-gl";
import type { MapDoc } from "@livemap/core";
import { OverlayRenderer, type IconSource } from "@livemap/renderer";
import { LAYER_IDS } from "@livemap/renderer";
import { EditorStore } from "./store.js";
import { DrawController, DEFAULTS, type ToolDefaults, type ToolId } from "./draw.js";
import { EditorUI } from "./ui.js";

export interface EditorConfig {
  readonly root: HTMLElement;
  readonly mapContainer: HTMLElement;
  readonly apiBase: string;
  readonly mapId: string;
  readonly style: string | object;
  readonly icons: IconSource;
  /** Opened by the Preview button. Ignored when `onPreview` is given. */
  readonly previewUrl?: string;
  readonly onPreview?: () => void;
  /**
   * How requests are sent. A host that authenticates with a bearer token
   * passes a fetch that adds it; the default is the page's own, which only
   * reaches an API that needs no credentials.
   */
  readonly fetchImpl?: typeof fetch;
  /** Called when the document is loaded and again whenever it is published. */
  readonly onDocument?: (doc: MapDoc) => void;
}

/** Our layers, in the order a click should test them: topmost first. */
const PICKABLE_LAYERS: readonly string[] = [
  LAYER_IDS.labels,
  LAYER_IDS.markers,
  LAYER_IDS.lines,
  LAYER_IDS.linesDashed,
  LAYER_IDS.teeth,
  LAYER_IDS.areaStroke,
  LAYER_IDS.areaStrokeDashed,
  LAYER_IDS.areaFill,
];

export class EditorApp {
  private readonly map: MapLibreMap;
  private readonly renderer: OverlayRenderer;
  private readonly store: EditorStore;
  /**
   * Built in `start()`, not the constructor: terra-draw's adapter adds sources
   * as soon as it starts, and MapLibre throws "Style is not done loading" if
   * that happens before the style resolves.
   */
  private drawer!: DrawController;
  private ui!: EditorUI;
  private readonly defaults: ToolDefaults = { ...DEFAULTS };
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private destroyed = false;

  constructor(private readonly config: EditorConfig) {
    this.map = new MapLibreMap({
      container: config.mapContainer,
      style: config.style as never,
      center: [35.75, 32.1],
      zoom: 9.2,
      attributionControl: { compact: true },
    });

    this.store = new EditorStore(config.apiBase, config.mapId, config.fetchImpl);
    this.renderer = new OverlayRenderer(this.map as never, {
      icons: config.icons,
    });
  }

  async start(): Promise<void> {
    // `load` is not enough: a style reports loaded while sources still resolve.
    // `isStyleLoaded()` is the real guard; `idle` re-fires, so it can retry.
    await new Promise<void>((resolve) => {
      const ready = () => {
        if (!this.map.isStyleLoaded()) return;
        this.map.off("styledata", ready);
        this.map.off("idle", ready);
        resolve();
      };
      if (this.map.isStyleLoaded()) return resolve();
      this.map.on("styledata", ready);
      this.map.on("idle", ready);
    });

    // The host navigated away while the style was still loading.
    if (this.destroyed) return;

    this.drawer = new DrawController(this.map, this.store, this.defaults);
    this.ui = new EditorUI(
      this.config.root,
      this.store,
      this.drawer,
      this.defaults,
      {
        onSave: () => void this.save(),
        onPublish: () => void this.publish(),
        onPreview: () => {
          if (this.config.onPreview) this.config.onPreview();
          else if (this.config.previewUrl) {
            window.open(this.config.previewUrl, "_blank", "noopener");
          }
        },
        onToggleDir: () => this.toggleDir(),
      },
    );

    this.store.subscribe(() => {
      this.renderer.setFeatures(this.store.list());
      this.ui.render();
    });
    this.drawer.onFinish(() => this.ui.render());

    this.renderer.attach();
    this.wireSelection();
    this.wireKeyboard();

    try {
      await this.store.load();
      const doc = this.store.document;
      if (doc) {
        this.map.jumpTo({
          center: doc.viewport.center as [number, number],
          zoom: doc.viewport.zoom,
          bearing: doc.viewport.bearing,
          pitch: doc.viewport.pitch,
        });
        this.setDir(doc.uiDir === "rtl" ? "rtl" : "ltr");
        this.config.onDocument?.(doc);
      }
    } catch (e) {
      this.ui.setMessage(`Could not load the map: ${String(e)}`, "error");
    }

    this.renderer.setFeatures(this.store.list());
    this.ui.render();
  }

  private wireSelection(): void {
    this.map.on("click", (e) => {
      // While a draw tool is active a click is a vertex, and the click that
      // completed a shape must not also re-select.
      if (this.drawer.currentTool !== "select") return;
      if (this.drawer.consumeSuppressedClick()) return;

      const present = PICKABLE_LAYERS.filter((id) => this.map.getLayer(id));
      const hits = this.map.queryRenderedFeatures(e.point, { layers: present });

      // `properties.id` is the owning feature; the GeoJSON feature id is
      // per-geometry (one arrow is a shaft plus a head plus chevrons).
      const id = hits[0]?.properties?.["id"];
      this.store.select(typeof id === "string" ? id : null);
    });

    this.map.on("mousemove", (e) => {
      if (this.drawer.currentTool !== "select") return;
      const present = PICKABLE_LAYERS.filter((id) => this.map.getLayer(id));
      const hits = this.map.queryRenderedFeatures(e.point, { layers: present });
      this.map.getCanvas().style.cursor = hits.length ? "pointer" : "";
    });
  }

  private wireKeyboard(): void {
    const toolKeys: Record<string, ToolId> = {
      v: "select",
      a: "area",
      l: "line",
      r: "arrow",
      f: "frontline",
      i: "point",
      n: "annotation",
    };

    this.onKeyDown = (e) => {
      const target = e.target as HTMLElement | null;
      // Never steal keys from a text field: typing "a" in an annotation must
      // not switch to the area tool.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) this.store.redo();
        else this.store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void this.save();
        return;
      }
      if (e.key === "Escape") {
        this.drawer.cancel();
        this.store.select(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const sel = this.store.selectedId;
        if (sel) {
          e.preventDefault();
          this.store.markDeleted(sel);
          this.store.remove(sel);
        }
        return;
      }

      if (!mod) {
        const tool = toolKeys[e.key.toLowerCase()];
        if (tool) {
          this.drawer.setTool(tool);
          this.ui.render();
        }
      }
    };
    window.addEventListener("keydown", this.onKeyDown);
  }

  /** True while there are edits the server has not seen. */
  get hasUnsavedChanges(): boolean {
    return this.store.isDirty;
  }

  /**
   * Releases everything that outlives the DOM node: the window-level key
   * handler, the draw controller, and the map with its WebGL context. Inside
   * a single-page host the editor is torn down on every navigation, and
   * without this "A" typed on another page would still select the area tool.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.onKeyDown) window.removeEventListener("keydown", this.onKeyDown);
    // `drawer` is assigned in start(); a host can tear down before that.
    (this.drawer as DrawController | undefined)?.destroy();
    this.map.remove();
  }

  // Setting `dir` is the whole mirroring mechanism: editor.css is written in
  // logical properties only, so there are no `[dir]` physical overrides to flip.
  //
  // On the editor's own root and nowhere else. It used to be set on <html> as
  // well, which mirrored whatever page the editor was mounted in — and put the
  // page's own left-to-right text into a right-to-left context, where its
  // punctuation jumped to the wrong end of the line.
  private setDir(dir: "ltr" | "rtl"): void {
    this.config.root.dir = dir;
  }

  private toggleDir(): void {
    const next = this.config.root.dir === "rtl" ? "ltr" : "rtl";
    this.setDir(next);
  }

  private async save(): Promise<void> {
    const r = await this.store.save();
    this.ui.setMessage(
      r.ok ? `Saved at rev ${r.rev}.` : (r.error ?? "Save failed."),
      r.ok ? "info" : "error",
    );
  }

  private async publish(): Promise<void> {
    this.ui.setMessage("Publishing…");
    const r = await this.store.publish();
    if (!r.ok) {
      this.ui.setMessage(r.error ?? "Publish failed.", "error");
      return;
    }
    const doc = this.store.document;
    if (doc) this.config.onDocument?.(doc);
    this.ui.setMessage(
      r.status === "unchanged"
        ? `Nothing changed — still v${r.version}. Readers keep their cached copy.`
        : `Published v${r.version} · etag ${String(r.etag).slice(0, 8)}…`,
    );
  }
}
