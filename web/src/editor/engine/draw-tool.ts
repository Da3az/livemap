import type { FeatureKind, LngLat, MapFeature } from "@/model/types";
import { keyBetween } from "@/model/order";
import { distance, geodesicArea, geodesicLength, lngLatToMerc, mercToLngLat, type Pt } from "@/render/geo";
import type { View } from "@/render/view";
import type { ChromePen } from "./chrome";
import { newAnnotation, newArea, newArrow, newFrontline, newLine, newPoint, type NewFeatureContext } from "./defaults";
import { minimumVertices } from "./edit";
import type { PointerSample } from "./input";
import type { Snap } from "./snap";
import type { Tool, ToolHost } from "./tool";

const CLOSE_DISTANCE_MOUSE = 10;
const CLOSE_DISTANCE_TOUCH = 18;
const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

/** Holds the pointer to 45° steps from `from`, measured on screen. */
function constrainAngle(from: Pt, to: Pt): Pt {
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  const length = (to.x - from.x) * Math.cos(angle) + (to.y - from.y) * Math.sin(angle);
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/**
 * Draws one feature kind. Points and annotations are placed with clicks;
 * the other four are built point by point and finished with a double-click,
 * Enter, a click on the last point, or (for an area) a click on the first.
 */
export class DrawTool implements Tool {
  private points: LngLat[] = [];
  private pointer: LngLat | null = null;
  private snap: Snap | null = null;
  private id = crypto.randomUUID();

  constructor(
    private readonly host: ToolHost,
    private readonly kind: FeatureKind,
  ) {}

  private get isPath(): boolean {
    return this.kind !== "point" && this.kind !== "annotation";
  }

  /* ---------------------------------------------------------------- pointer */

  down(): boolean {
    return false;
  }
  drag(): void {}
  dragEnd(): void {}
  dragCancel(): void {}
  longPress(): boolean {
    return false;
  }

  hover(sample: PointerSample): void {
    this.pointer = this.target(sample);
    this.refresh();
  }

  leave(): void {
    this.pointer = null;
    this.snap = null;
    this.refresh();
  }

  click(sample: PointerSample): void {
    const at = this.target(sample);
    if (this.kind === "point") {
      this.complete(newPoint(this.featureContext(), at));
      return;
    }
    if (this.kind === "annotation") {
      const anchor = this.points[0];
      if (anchor) this.complete(newAnnotation(this.featureContext(), anchor, at));
      else this.place(at);
      return;
    }
    if (this.closes(sample)) {
      this.finish();
      return;
    }
    this.place(at);
  }

  doubleClick(sample: PointerSample): void {
    if (!this.isPath) {
      this.click(sample);
      return;
    }
    if (!this.isNearLast(sample)) this.points = [...this.points, this.target(sample)];
    if (this.points.length >= minimumVertices(this.kind)) this.finish();
    else this.refresh();
  }

  /* --------------------------------------------------------------- commands */

  key(event: KeyboardEvent): boolean {
    if (event.key === "Enter") {
      this.finish();
      return true;
    }
    if (event.key === "Escape") {
      if (this.points.length > 0) this.cancel();
      else this.host.leaveTool();
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      if (this.points.length === 0) return false;
      this.points = this.points.slice(0, -1);
      this.refresh();
      return true;
    }
    return false;
  }

  cancel(): void {
    this.reset();
    this.refresh();
  }

  finish(): void {
    if (!this.isPath || this.points.length === 0) return;
    const minimum = minimumVertices(this.kind);
    if (this.points.length < minimum) {
      this.host.reject(`A shape of kind "${this.kind}" needs at least ${minimum} points; ${this.points.length} placed.`);
      return;
    }
    const feature = this.build(this.points);
    if (feature) this.complete(feature);
  }

  dispose(): void {
    this.reset();
    this.host.renderer.setDraft(null);
    this.host.progress(null);
  }

  cursor(): string {
    return "crosshair";
  }

  /* ------------------------------------------------------------------ paint */

  paint(pen: ChromePen, view: View): void {
    const screen = this.points.map((at) => view.project(lngLatToMerc(at)));
    const last = screen[screen.length - 1];
    const first = screen[0];
    const pointer = this.pointer ? view.project(lngLatToMerc(this.pointer)) : null;
    if (this.isPath && last && pointer) {
      pen.guide(this.kind === "area" && first && screen.length > 1 ? [last, pointer, first] : [last, pointer]);
    }
    const coarse = this.host.coarse();
    screen.forEach((at, index) => {
      const closable = this.kind === "area" && index === 0 && this.points.length >= 3;
      pen.handle(at, closable ? "start" : "vertex", coarse);
    });
    if (this.snap) pen.snap(this.snap.screen, this.snap.type);
  }

  /* ---------------------------------------------------------------- private */

  private featureContext(): NewFeatureContext {
    return { id: this.id, order: keyBetween(this.host.topOrder(), null), dir: this.host.dir(), defaults: this.host.drawDefaults() };
  }

  /** Where a pointer position lands: held to 45° with Shift, otherwise snapped when something is near. */
  private target(sample: PointerSample): LngLat {
    const view = this.host.renderer.view();
    const last = this.points[this.points.length - 1];
    if (sample.shift && last && this.isPath) {
      this.snap = null;
      return mercToLngLat(view.unproject(constrainAngle(view.project(lngLatToMerc(last)), sample)));
    }
    this.snap = this.host.snapAt(sample, { exclude: NO_EXCLUSIONS, extra: this.points, touch: sample.touch });
    return this.snap?.at ?? mercToLngLat(view.unproject(sample));
  }

  private screenDistance(sample: PointerSample, at: LngLat | undefined): number {
    if (!at) return Infinity;
    return distance(sample, this.host.renderer.view().project(lngLatToMerc(at)));
  }

  private isNearLast(sample: PointerSample): boolean {
    const reach = sample.touch ? CLOSE_DISTANCE_TOUCH : CLOSE_DISTANCE_MOUSE;
    return this.screenDistance(sample, this.points[this.points.length - 1]) <= reach;
  }

  /** A click on the first point closes an area; a click on the last point ends any path. */
  private closes(sample: PointerSample): boolean {
    if (this.points.length < minimumVertices(this.kind)) return false;
    const reach = sample.touch ? CLOSE_DISTANCE_TOUCH : CLOSE_DISTANCE_MOUSE;
    if (this.kind === "area" && this.screenDistance(sample, this.points[0]) <= reach) return true;
    return this.isNearLast(sample);
  }

  private place(at: LngLat): void {
    this.points = [...this.points, at];
    this.refresh();
  }

  private build(points: LngLat[]): MapFeature | null {
    const context = this.featureContext();
    const [first] = points;
    switch (this.kind) {
      case "area":
        return points.length >= 3 ? newArea(context, points) : null;
      case "line":
        return points.length >= 2 ? newLine(context, points) : null;
      case "arrow":
        return points.length >= 2 ? newArrow(context, points) : null;
      case "frontline":
        return points.length >= 2 ? newFrontline(context, points) : null;
      case "point":
        return first ? newPoint(context, first) : null;
      case "annotation":
        return first ? newAnnotation(context, first, points[1] ?? first) : null;
    }
  }

  private complete(feature: MapFeature): void {
    this.reset();
    this.host.renderer.setDraft(null);
    this.host.progress(null);
    this.host.commit([feature]);
    this.host.select([feature.id], "replace");
    this.host.repaint();
  }

  private reset(): void {
    this.points = [];
    this.snap = null;
    this.id = crypto.randomUUID();
  }

  /** Re-renders the preview and reports progress after any change to the points or the pointer. */
  private refresh(): void {
    const shown = this.pointer ? [...this.points, this.pointer] : this.points;
    /* An annotation shows nothing until its anchor is placed: the first click is not where the text goes. */
    const previewable = this.kind !== "annotation" || this.points.length > 0;
    this.host.renderer.setDraft(previewable ? this.build(shown) : null);
    this.host.repaint();
    if (this.points.length === 0) {
      this.host.progress(null);
      return;
    }
    this.host.progress({
      tool: this.kind,
      points: this.points.length,
      lengthMetres: this.isPath && this.kind !== "area" ? geodesicLength(shown) : null,
      areaSquareMetres: this.kind === "area" ? geodesicArea(shown) : null,
      canFinish: this.isPath && this.points.length >= minimumVertices(this.kind),
    });
  }
}
