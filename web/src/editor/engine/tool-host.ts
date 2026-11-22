import type { ControllerEvents } from "@/editor/controller";
import type { MapFeature } from "@/model/types";
import type { FeatureRenderer } from "@/render/feature-renderer";
import type { Emitter } from "./emitter";
import type { Overrides } from "./overrides";
import { findSnap } from "./snap";
import type { ToolHost } from "./tool";
import type { Finished } from "./draw-tool";
import type { Pt } from "@/render/geo";

const SNAP_TOLERANCE_MOUSE = 10;
const SNAP_TOLERANCE_TOUCH = 18;

/** The parts of the controller a tool host is built from. */
export interface HostBridge {
  renderer: FeatureRenderer;
  events: Emitter<ControllerEvents>;
  overrides: Overrides;
  /** The document's feature, before any gesture in flight. */
  documentFeature(id: string): MapFeature | undefined;
  features(): readonly MapFeature[];
  selection(): ReadonlySet<string>;
  /** Replaces the selection; the bridge repaints and re-ranks labels. */
  setSelection(next: ReadonlySet<string>): void;
  snapping(): boolean;
  coarse(): boolean;
  drawDefaults(): Partial<MapFeature>;
  dir(): "ltr" | "rtl";
  reshape(id: string | null): void;
  leaveTool(): void;
  toolLocked(): boolean;
  crosshairScreen(): Pt;
  finished(finished: Finished): void;
  repaint(): void;
}

export function nextSelection(current: ReadonlySet<string>, ids: readonly string[], mode: "replace" | "add" | "toggle"): Set<string> {
  if (mode === "replace") return new Set(ids);
  if (mode === "add") return new Set([...current, ...ids]);
  const next = new Set(current);
  for (const id of ids) {
    if (next.has(id)) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** What the tools may ask for. Built from a bridge rather than the controller, so a tool cannot reach the rest of it. */
export function createToolHost(bridge: HostBridge): ToolHost {
  const { renderer, events, overrides } = bridge;
  return {
    renderer,
    feature: (id) => overrides.get(id) ?? bridge.documentFeature(id),
    selection: () => bridge.selection(),
    isSelectable: (id) => {
      const item = renderer.item(id);
      return item !== undefined && !item.hidden && !item.locked && item.inWindow;
    },
    topOrder: () => {
      let top: string | null = null;
      for (const feature of bridge.features()) if (top === null || feature.order > top) top = feature.order;
      return top;
    },
    snapAt: (p, options) => {
      if (!bridge.snapping()) return null;
      const tolerance = options.touch ? SNAP_TOLERANCE_TOUCH : SNAP_TOLERANCE_MOUSE;
      return findSnap(renderer, renderer.view(), p, { tolerance, exclude: options.exclude, extra: options.extra });
    },
    coarse: () => bridge.coarse(),
    drawDefaults: () => bridge.drawDefaults(),
    dir: () => bridge.dir(),
    update: (put) => {
      overrides.show(put);
      events.emit("change", { put, delete: [], gesture: "update" });
    },
    commit: (put, remove = []) => {
      overrides.hold(put);
      events.emit("change", { put, delete: remove, gesture: "commit" });
    },
    abandon: (originals) => {
      overrides.clear();
      if (originals.length > 0) events.emit("change", { put: originals, delete: [], gesture: "commit" });
    },
    select: (ids, mode) => {
      bridge.setSelection(nextSelection(bridge.selection(), ids, mode));
      events.emit("select", ids, mode);
    },
    reshape: (id) => {
      bridge.reshape(id);
      events.emit("reshape", id);
    },
    leaveTool: () => {
      bridge.leaveTool();
      events.emit("tool", "select");
    },
    toolLocked: () => bridge.toolLocked(),
    crosshair: (on) => events.emit("crosshair", on),
    moving: (on) => events.emit("moving", on),
    crosshairScreen: () => bridge.crosshairScreen(),
    finished: (finished) => bridge.finished(finished),
    reject: (detail) => events.emit("problem", { code: "shape_rejected", detail }),
    progress: (progress) => events.emit("draw", progress),
    repaint: () => bridge.repaint(),
  };
}
