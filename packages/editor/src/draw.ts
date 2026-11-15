// terra-draw only captures geometry. On finish we convert to a `MapFeature`,
// hand it to the store and delete terra-draw's own copy — one source of truth,
// and its per-mode styling never reaches the published map.

import {
  TerraDraw,
  TerraDrawPointMode,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { LngLat, MapFeature } from "@livemap/core";
import { newId, type EditorStore } from "./store.js";

export type ToolId =
  | "select"
  | "area"
  | "line"
  | "arrow"
  | "frontline"
  | "point"
  | "annotation";

export interface ToolDefaults {
  color: string;
  strokeWidth: number;
  fillOpacity: number;
  icon: string;
  dashed: boolean;
  arrowHead: "none" | "single" | "double";
  chevrons: boolean;
  curvature: number;
  facing: "left" | "right";
  textDir: "ltr" | "rtl" | "auto";
}

export const DEFAULTS: ToolDefaults = {
  color: "#E03C31",
  strokeWidth: 4,
  fillOpacity: 0.28,
  icon: "evt:strike",
  dashed: false,
  arrowHead: "single",
  chevrons: true,
  curvature: 1,
  facing: "left",
  textDir: "auto",
};

/** terra-draw mode name per tool. `select` has no capture mode. */
const MODE_FOR: Record<Exclude<ToolId, "select">, string> = {
  area: "polygon",
  line: "linestring",
  arrow: "linestring",
  frontline: "linestring",
  point: "point",
  annotation: "point",
};

export class DrawController {
  private readonly draw: TerraDraw;
  private tool: ToolId = "select";
  private onToolDone: (() => void) | null = null;
  private suppressClick = false;

  constructor(
    map: unknown,
    private readonly store: EditorStore,
    private readonly defaults: ToolDefaults,
  ) {
    this.draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map: map as never }),
      modes: [
        new TerraDrawSelectMode({
          flags: {
            // Only geometry we actually let the user reshape in place.
            polygon: { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
            linestring: { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
            point: { feature: { draggable: true } },
          },
        }),
        new TerraDrawPolygonMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPointMode(),
      ],
    });

    this.draw.start();
    this.draw.setMode("static");

    this.draw.on("finish", (id, ctx) => {
      if (ctx.action !== "draw") return;
      this.capture(id);
    });
  }

  private capture(id: string | number): void {
    const snapshot = this.draw.getSnapshot() as GeoJSONStoreFeatures[];
    const drawn = snapshot.find((f) => f.id === id);
    if (!drawn) return;

    const feature = this.toFeature(drawn);
    // Clear unconditionally: an orphan left behind renders as a stray un-styled shape.
    this.draw.removeFeatures([id]);

    if (feature) this.store.add(feature);

    // The finishing click is still propagating; after the switch to select
    // below, the map's click handler would re-select whatever is under the
    // cursor and drop the new feature's selection. Suppress exactly one.
    this.suppressClick = true;

    // One shape per tool activation.
    this.setTool("select");
    this.onToolDone?.();
  }

  private toFeature(drawn: GeoJSONStoreFeatures): MapFeature | null {
    const d = this.defaults;
    const at = this.store.topOrderKey();
    const stroke = {
      color: d.color,
      width: d.strokeWidth,
      opacity: 1,
      ...(d.dashed ? { dash: [2, 1.5] as const } : {}),
    };

    const geom = drawn.geometry;

    if (this.tool === "area" && geom.type === "Polygon") {
      return {
        id: newId("area"),
        kind: "area",
        at,
        rings: geom.coordinates.map((r) => r.map((p) => [p[0]!, p[1]!] as LngLat)),
        fill: { color: d.color, opacity: d.fillOpacity },
        stroke,
      };
    }

    if (geom.type === "LineString") {
      const path = geom.coordinates.map((p) => [p[0]!, p[1]!] as LngLat);
      // Two coincident clicks yield a degenerate line that renders as nothing.
      if (path.length < 2) return null;

      if (this.tool === "arrow") {
        return {
          id: newId("arrow"),
          kind: "arrow",
          at,
          control: path,
          curvature: d.curvature,
          head: d.arrowHead,
          chevrons: d.chevrons,
          stroke,
        };
      }
      if (this.tool === "frontline") {
        return {
          id: newId("frontline"),
          kind: "frontline",
          at,
          path,
          facing: d.facing,
          // Metres, authored. The renderer re-derives these per view in px.
          toothSpacing: 4000,
          toothSize: 2000,
          stroke: { ...stroke, color: d.color },
        };
      }
      return { id: newId("line"), kind: "line", at, path, stroke };
    }

    if (geom.type === "Point") {
      const pos = [geom.coordinates[0]!, geom.coordinates[1]!] as LngLat;

      if (this.tool === "annotation") {
        return {
          id: newId("note"),
          kind: "annotation",
          at,
          anchor: pos,
          // Screen-pixel offset, not geographic — see leader.ts.
          offset: [72, -48],
          text: { value: "New annotation", dir: d.textDir },
          labelStyle: {
            color: "#16130f",
            haloColor: "#ffffff",
            haloWidth: 1.6,
            size: 14,
          },
          leader: {
            color: "#16130f",
            width: 1.2,
            dash: [2, 1.5],
            shape: "straight",
            anchorDot: true,
          },
        };
      }

      return {
        id: newId("point"),
        kind: "point",
        at,
        at_: pos,
        icon: d.icon,
        iconColor: d.color,
        iconSize: 1,
      };
    }

    return null;
  }

  setTool(tool: ToolId): void {
    this.tool = tool;
    if (tool === "select") {
      // "static", not "select": terra-draw's select mode only sees its own
      // features, and ours live in the renderer. We do selection ourselves.
      this.draw.setMode("static");
      return;
    }
    this.draw.setMode(MODE_FOR[tool]);
  }

  get currentTool(): ToolId {
    return this.tool;
  }

  /** True once, immediately after a shape is finished. Reading it clears it. */
  consumeSuppressedClick(): boolean {
    if (!this.suppressClick) return false;
    this.suppressClick = false;
    return true;
  }

  onFinish(fn: () => void): void {
    this.onToolDone = fn;
  }

  /** Abandon an in-progress shape, e.g. on Escape. */
  cancel(): void {
    const ids = (this.draw.getSnapshot() as GeoJSONStoreFeatures[]).map((f) => f.id!);
    if (ids.length) this.draw.removeFeatures(ids);
    this.setTool("select");
    this.onToolDone?.();
  }

  destroy(): void {
    this.draw.stop();
  }
}
