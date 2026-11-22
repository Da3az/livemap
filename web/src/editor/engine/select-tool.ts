import type { LngLat, MapFeature } from "@/model/types";
import { curveMidpoints } from "@/render/curve";
import { distance, lngLatToMerc, mercToLngLat, type Box, type Pt } from "@/render/geo";
import { worldWrap } from "@/render/shapes";
import type { View } from "@/render/view";
import type { ChromePen } from "./chrome";
import { deleteVertex, hasFreeVertices, insertVertex, moveVertex, sameVertex, translateFeature, vertexParts, type VertexRef } from "./edit";
import type { PointerSample } from "./input";
import type { Snap } from "./snap";
import type { Tool, ToolHost } from "./tool";

const HIT_TOLERANCE_MOUSE = 4;
const HIT_TOLERANCE_TOUCH = 12;
const HANDLE_REACH_MOUSE = 9;
const HANDLE_REACH_TOUCH = 22;
/** A vertex does not move until the pointer has gone this far, so a click that chooses it cannot nudge it. */
const VERTEX_DEADZONE_MOUSE = 6;
const VERTEX_DEADZONE_TOUCH = 12;
/** A second double-click this soon after one is the same gesture reported again. */
const DOUBLE_CLICK_REPEAT_MS = 400;
/** Arrow-key nudges this close together are one move, and one undo step. */
const NUDGE_SETTLE_MS = 600;

/** The screen direction of an arrow key: geographic, so never mirrored for right-to-left. */
export function arrowDirection(key: string): Pt | null {
  if (key === "ArrowLeft") return { x: -1, y: 0 };
  if (key === "ArrowRight") return { x: 1, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -1 };
  if (key === "ArrowDown") return { x: 0, y: 1 };
  return null;
}

interface Handle {
  type: "vertex" | "midpoint";
  /** For a vertex, the vertex itself; for a midpoint, the position a new vertex would take. */
  ref: VertexRef;
  at: Pt;
}

type Gesture =
  | { type: "move"; originals: MapFeature[]; reported: boolean }
  | { type: "vertex"; original: MapFeature; base: MapFeature; ref: VertexRef; inserted: boolean; reported: boolean }
  | { type: "marquee"; from: Pt; to: Pt };

function boxBetween(a: Pt, b: Pt): Box {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

/**
 * Selecting, moving and reshaping. A drag only moves features that are
 * already selected, so dragging across a large area pans the map instead of
 * shifting the area by accident.
 */
export class SelectTool implements Tool {
  private reshapingId: string | null = null;
  private activeVertex: VertexRef | null = null;
  private gesture: Gesture | null = null;
  private snap: Snap | null = null;
  private lastDoubleClick = 0;
  /** A burst of arrow-key nudges in progress: what it started from, and the timer that ends it. */
  private nudging: { originals: MapFeature[]; moved: MapFeature[]; timer: number } | null = null;

  constructor(private readonly host: ToolHost) {}

  setReshaping(id: string | null): void {
    if (id === this.reshapingId) return;
    this.reshapingId = id;
    this.activeVertex = null;
    this.host.repaint();
  }

  getReshaping(): string | null {
    return this.reshapingId;
  }

  /* ---------------------------------------------------------------- pointer */

  down(sample: PointerSample): boolean {
    const handle = this.handleAt(sample);
    const reshaped = this.reshaped();
    if (handle && reshaped) {
      if (handle.type === "vertex") {
        this.activeVertex = handle.ref;
        this.gesture = { type: "vertex", original: reshaped, base: reshaped, ref: handle.ref, inserted: false, reported: false };
      } else {
        const at = mercToLngLat(this.host.renderer.view().unproject(handle.at));
        const base = insertVertex(reshaped, handle.ref, at);
        this.activeVertex = handle.ref;
        this.gesture = { type: "vertex", original: reshaped, base, ref: handle.ref, inserted: true, reported: false };
      }
      this.host.repaint();
      return true;
    }
    if (sample.shift && !sample.touch) {
      this.gesture = { type: "marquee", from: sample, to: sample };
      return true;
    }
    const hit = this.topSelectable(sample);
    if (hit !== null && this.host.selection().has(hit) && !sample.ctrl) {
      const originals = [...this.host.selection()].filter((id) => this.host.isSelectable(id)).flatMap((id) => this.host.feature(id) ?? []);
      this.gesture = { type: "move", originals, reported: false };
      return true;
    }
    return false;
  }

  longPress(sample: PointerSample): boolean {
    this.gesture = { type: "marquee", from: sample, to: sample };
    return true;
  }

  drag(sample: PointerSample, start: PointerSample): void {
    const gesture = this.gesture;
    if (!gesture) return;
    const view = this.host.renderer.view();
    if (gesture.type === "marquee") {
      gesture.to = sample;
      this.host.repaint();
      return;
    }
    if (gesture.type === "move") {
      const from = view.unproject(start);
      const to = view.unproject(sample);
      gesture.reported = true;
      this.host.update(gesture.originals.map((feature) => translateFeature(feature, { x: to.x - from.x, y: to.y - from.y })));
      return;
    }
    if (!gesture.reported && !gesture.inserted && distance(sample, start) < (sample.touch ? VERTEX_DEADZONE_TOUCH : VERTEX_DEADZONE_MOUSE)) return;
    this.snap = this.host.snapAt(sample, { exclude: new Set([gesture.original.id]), extra: [], touch: sample.touch });
    const at: LngLat = this.snap?.at ?? mercToLngLat(view.unproject(sample));
    gesture.reported = true;
    this.host.update([moveVertex(gesture.base, gesture.ref, at)]);
  }

  dragEnd(sample: PointerSample): void {
    const gesture = this.gesture;
    this.gesture = null;
    this.snap = null;
    if (!gesture) return;
    if (gesture.type === "marquee") {
      const ids = this.host.renderer.queryBox(boxBetween(gesture.from, gesture.to)).filter((id) => this.host.isSelectable(id));
      this.host.select(ids, sample.ctrl ? "add" : "replace");
    } else if (gesture.type === "move") {
      const moved = gesture.originals.flatMap((feature) => this.host.feature(feature.id) ?? []);
      if (gesture.reported) this.host.commit(moved);
    } else {
      const current = this.host.feature(gesture.original.id);
      if (current && gesture.reported) this.host.commit([current]);
    }
    this.host.repaint();
  }

  dragCancel(): void {
    this.cancel();
  }

  click(sample: PointerSample): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture?.type === "vertex") {
      /* A press on a midpoint without a drag still adds the vertex. */
      if (gesture.inserted) this.host.commit([gesture.base]);
      this.host.repaint();
      return;
    }
    const hit = this.topSelectable(sample);
    if (hit !== null) {
      const mode = sample.ctrl ? "toggle" : sample.shift ? "add" : "replace";
      /* Choosing another feature ends work on the one being reshaped. */
      if (mode === "replace" && this.reshapingId !== null && hit !== this.reshapingId) this.host.reshape(null);
      this.host.select([hit], mode);
      return;
    }
    if (sample.shift || sample.ctrl) return;
    if (this.reshapingId !== null) this.host.reshape(null);
    this.host.select([], "replace");
  }

  doubleClick(sample: PointerSample): void {
    this.gesture = null;
    const now = performance.now();
    if (now - this.lastDoubleClick < DOUBLE_CLICK_REPEAT_MS) return;
    this.lastDoubleClick = now;
    const handle = this.handleAt(sample);
    if (handle?.type === "vertex") {
      this.removeVertex(handle.ref);
      return;
    }
    const hit = this.topSelectable(sample);
    if (hit === null) return;
    this.host.select([hit], "replace");
    this.host.reshape(hit);
  }

  hover(): void {}
  leave(): void {}

  /* --------------------------------------------------------------- commands */

  key(event: KeyboardEvent): boolean {
    const direction = arrowDirection(event.key);
    if (direction) return this.nudge(direction, event.shiftKey ? 10 : 1);
    if (event.key === "Escape") {
      if (this.gesture) this.cancel();
      else if (this.reshapingId !== null) this.host.reshape(null);
      else if (this.host.selection().size > 0) this.host.select([], "replace");
      else return false;
      return true;
    }
    if (event.key === "Enter" && this.reshapingId !== null) {
      this.host.reshape(null);
      return true;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.reshapingId !== null && this.activeVertex) {
        this.removeVertex(this.activeVertex);
        return true;
      }
      const removable = [...this.host.selection()].filter((id) => this.host.isSelectable(id));
      if (removable.length === 0) return false;
      this.host.commit([], removable);
      this.host.select([], "replace");
      return true;
    }
    return false;
  }

  capturesKey(event: KeyboardEvent): boolean {
    return (event.key === "Delete" || event.key === "Backspace") && this.reshapingId !== null && this.activeVertex !== null;
  }

  cancel(): void {
    this.settleNudge();
    const gesture = this.gesture;
    this.gesture = null;
    this.snap = null;
    if (gesture?.type === "move") this.host.abandon(gesture.reported ? gesture.originals : []);
    if (gesture?.type === "vertex") this.host.abandon(gesture.reported ? [gesture.original] : []);
    this.host.repaint();
  }

  finish(): void {
    if (this.reshapingId !== null) this.host.reshape(null);
  }

  dispose(): void {
    this.cancel();
  }

  cursor(sample: PointerSample | null): string {
    if (this.gesture?.type === "move" || this.gesture?.type === "vertex") return "grabbing";
    if (!sample) return "";
    if (this.handleAt(sample)) return "pointer";
    const hit = this.topSelectable(sample);
    if (hit === null) return "";
    return this.host.selection().has(hit) ? "move" : "pointer";
  }

  /* ------------------------------------------------------------------ paint */

  paint(pen: ChromePen, view: View): void {
    for (const id of this.host.selection()) {
      const shape = this.host.renderer.shape(id, view);
      if (shape) pen.outline(shape);
    }
    const coarse = this.host.coarse();
    for (const handle of this.handles(view)) {
      if (handle.type === "midpoint") pen.handle(handle.at, "midpoint", coarse);
    }
    for (const handle of this.handles(view)) {
      if (handle.type === "vertex") pen.handle(handle.at, sameVertex(handle.ref, this.activeVertex) ? "vertex-active" : "vertex", coarse);
    }
    if (this.snap) pen.snap(this.snap.screen, this.snap.type);
    if (this.gesture?.type === "marquee") pen.marquee(boxBetween(this.gesture.from, this.gesture.to));
  }

  /* ---------------------------------------------------------------- private */

  /** The feature being reshaped, as currently shown, or null when it is gone or locked. */
  private reshaped(): MapFeature | null {
    if (this.reshapingId === null || !this.host.isSelectable(this.reshapingId)) return null;
    return this.host.feature(this.reshapingId) ?? null;
  }

  private topSelectable(sample: PointerSample): string | null {
    const tolerance = sample.touch ? HIT_TOLERANCE_TOUCH : HIT_TOLERANCE_MOUSE;
    return this.host.renderer.hitTest(sample, tolerance).find((id) => this.host.isSelectable(id)) ?? null;
  }

  private handles(view: View): Handle[] {
    const feature = this.reshaped();
    const item = feature ? this.host.renderer.item(feature.id) : undefined;
    if (!feature || !item) return [];
    const wrap = worldWrap(item, view);
    const handles: Handle[] = [];
    vertexParts(feature).forEach((part, partIndex) => {
      const merc = part.map(lngLatToMerc);
      merc.forEach((point, index) => handles.push({ type: "vertex", ref: { part: partIndex, index }, at: view.project(point, wrap) }));
      if (!hasFreeVertices(feature.kind)) return;
      const middles =
        feature.kind === "arrow"
          ? curveMidpoints(merc, feature.curvature, feature.bend)
          : merc.flatMap((point, index) => {
              const next = merc[index + 1] ?? (feature.kind === "area" ? merc[0] : undefined);
              return next ? [{ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }] : [];
            });
      middles.forEach((point, index) => handles.push({ type: "midpoint", ref: { part: partIndex, index: index + 1 }, at: view.project(point, wrap) }));
    });
    return handles;
  }

  /** The handle under the pointer; a vertex wins over a midpoint at the same distance. */
  private handleAt(sample: PointerSample): Handle | null {
    const reach = sample.touch ? HANDLE_REACH_TOUCH : HANDLE_REACH_MOUSE;
    let best: Handle | null = null;
    let bestScore = Infinity;
    for (const handle of this.handles(this.host.renderer.view())) {
      const d = distance(sample, handle.at);
      if (d > reach) continue;
      const score = d + (handle.type === "midpoint" ? reach : 0);
      if (score < bestScore) {
        bestScore = score;
        best = handle;
      }
    }
    return best;
  }

  /**
   * Arrow keys move the selection by screen pixels. Nothing selected (or only
   * locked features) leaves the key to pan the map. A burst of presses is
   * shown as it goes and recorded as one step once the keys go quiet.
   */
  private nudge(direction: Pt, pixels: number): boolean {
    const ids = [...this.host.selection()].filter((id) => this.host.isSelectable(id));
    if (ids.length === 0 || this.gesture) return false;
    if (!this.nudging) {
      const originals = ids.flatMap((id) => this.host.feature(id) ?? []);
      this.nudging = { originals, moved: originals, timer: 0 };
    }
    const nudging = this.nudging;
    const view = this.host.renderer.view();
    const centre = { x: view.width / 2, y: view.height / 2 };
    const from = view.unproject(centre);
    const to = view.unproject({ x: centre.x + direction.x * pixels, y: centre.y + direction.y * pixels });
    nudging.moved = nudging.moved.map((feature) => translateFeature(feature, { x: to.x - from.x, y: to.y - from.y }));
    this.host.update(nudging.moved);
    window.clearTimeout(nudging.timer);
    nudging.timer = window.setTimeout(() => this.settleNudge(), NUDGE_SETTLE_MS);
    return true;
  }

  private settleNudge(): void {
    const nudging = this.nudging;
    if (!nudging) return;
    this.nudging = null;
    window.clearTimeout(nudging.timer);
    this.host.commit(nudging.moved);
  }

  private removeVertex(ref: VertexRef): void {
    const feature = this.reshaped();
    if (!feature) return;
    const next = deleteVertex(feature, ref);
    this.activeVertex = null;
    if (next) this.host.commit([next]);
    else this.host.reject(`This ${feature.kind} cannot lose another point.`);
    this.host.repaint();
  }
}
