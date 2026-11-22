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
/**
 * On touch a tap on the last point finishes the shape only when it comes this
 * long after that point was placed. Two quick taps are a double tap, and a
 * double tap must never finish a shape: a single tap can register as two
 * (mapbox-gl-draw issue #1212).
 */
const TOUCH_FINISH_DELAY_MS = 450;
/** Where a note's text box goes relative to its anchor, in CSS pixels: up, and toward the reading direction. */
const NOTE_OFFSET = { x: 56, y: -64 };
/** How close to the map's edge a note's box may start before it flips to the other side. */
const NOTE_EDGE = 140;
const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

/** Holds a point to 45° steps from `from`, measured on screen. */
export function constrainAngle(from: Pt, to: Pt): Pt {
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  const length = (to.x - from.x) * Math.cos(angle) + (to.y - from.y) * Math.sin(angle);
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/** What `finish` left behind, so an undo straight after it can reopen the shape. */
export interface Finished {
  kind: FeatureKind;
  featureId: string;
  points: LngLat[];
}

/**
 * Draws one feature kind.
 *
 * Lines, areas, front lines and arrows are built point by point: a click or
 * tap places a point; a double-click (never a double tap), Enter, a click on
 * the last point or, for an area, on the first finishes. An arrow can also be
 * drawn in one stroke: press, drag, release. Icons are placed with one click;
 * a note with one click (its text box at a default offset) or by pressing at
 * the point and releasing where the box goes.
 *
 * From the keyboard, a crosshair at the centre of the visible map stands in
 * for the pointer: the arrow keys move the map under it, Enter or Space places
 * a point there, and Enter on the last point finishes.
 */
export class DrawTool implements Tool {
  private points: LngLat[] = [];
  /** Points taken back with undo, newest last, for redo. Cleared by placing a new one. */
  private undone: LngLat[] = [];
  private pointer: LngLat | null = null;
  private snap: Snap | null = null;
  private id = crypto.randomUUID();
  /** When the last point was placed, for the touch double-tap guard. */
  private placedAt = 0;
  /** A press that may become a one-stroke arrow or note. */
  private stroke: { from: LngLat; to: LngLat } | null = null;
  private keyboard = false;

  constructor(
    private readonly host: ToolHost,
    readonly kind: FeatureKind,
    restore: LngLat[] = [],
  ) {
    if (restore.length > 0) {
      this.points = restore;
      this.placedAt = performance.now();
      queueMicrotask(() => this.refresh());
    }
  }

  private get isPath(): boolean {
    return this.kind !== "point" && this.kind !== "annotation";
  }

  /** Drawn in one stroke as well as by clicks. */
  private get strokes(): boolean {
    return (this.kind === "arrow" && this.points.length === 0) || (this.kind === "annotation" && this.points.length === 0);
  }

  /* ---------------------------------------------------------------- pointer */

  down(sample: PointerSample): boolean {
    this.setKeyboard(false);
    if (!this.strokes) return false;
    const at = this.target(sample);
    this.stroke = { from: at, to: at };
    return true;
  }

  drag(sample: PointerSample): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const view = this.host.renderer.view();
    const start = view.project(lngLatToMerc(stroke.from));
    const end = sample.shift ? constrainAngle(start, sample) : sample;
    stroke.to = mercToLngLat(view.unproject(end));
    this.host.renderer.setDraft(this.strokeFeature(stroke));
    this.host.repaint();
  }

  dragEnd(): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return;
    const feature = this.strokeFeature(stroke);
    if (feature) this.complete(feature, [stroke.from, stroke.to]);
  }

  dragCancel(): void {
    this.stroke = null;
    this.host.renderer.setDraft(null);
    this.host.repaint();
  }

  longPress(): boolean {
    return false;
  }

  hover(sample: PointerSample): void {
    this.setKeyboard(false);
    this.pointer = this.target(sample);
    this.refresh();
  }

  leave(): void {
    this.pointer = null;
    this.snap = null;
    this.refresh();
  }

  click(sample: PointerSample): void {
    /* A press that was offered as a stroke but never moved is a plain click. */
    this.stroke = null;
    this.setKeyboard(false);
    this.placeAt(this.target(sample), sample);
  }

  doubleClick(sample: PointerSample): void {
    /* A double tap never finishes a shape; each of its taps was already handled as a tap. */
    if (sample.touch || !this.isPath) return;
    if (!this.isNearLast(sample)) this.add(this.target(sample));
    if (this.points.length >= minimumVertices(this.kind)) this.finish();
    else this.refresh();
  }

  /* --------------------------------------------------------------- commands */

  key(event: KeyboardEvent): boolean {
    const keyboardPlacement = event.key === "Enter" || event.key === " ";
    if (keyboardPlacement && this.keyboard) {
      this.placeAtCrosshair();
      return true;
    }
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
      /* With nothing placed there is nothing to take back, and Delete must not fall through to delete the selection. */
      this.undoPoint();
      return true;
    }
    if (event.key === " ") {
      /* Space is the pan modifier where a drag draws; on its own it starts nothing here. */
      return this.kind === "arrow" || this.kind === "annotation";
    }
    if (event.key.startsWith("Arrow")) {
      /* The map moves under the crosshair; the controller pans once this declines the key. */
      this.setKeyboard(true);
      return false;
    }
    return false;
  }

  /** Take back the last point. Returns false when there was none. */
  undoPoint(): boolean {
    const last = this.points[this.points.length - 1];
    if (!last) return false;
    this.points = this.points.slice(0, -1);
    this.undone = [...this.undone, last];
    this.refresh();
    return true;
  }

  /** Put back the point undo last took. Returns false when there was none. */
  redoPoint(): boolean {
    const next = this.undone[this.undone.length - 1];
    if (!next) return false;
    this.undone = this.undone.slice(0, -1);
    this.points = [...this.points, next];
    this.refresh();
    return true;
  }

  /** Keyboard placement on or off; the controller reports it so the interface can show its buttons. */
  setKeyboard(on: boolean): void {
    if (on === this.keyboard) return;
    this.keyboard = on;
    this.host.crosshair(on);
    if (on) this.pointer = this.crosshairPoint();
    this.refresh();
  }

  /** Place a point, an icon or a note at a place given by other means than the pointer: a menu, say. */
  placeAtLngLat(at: LngLat): void {
    this.placeAt(at, null);
  }

  /** Place a point (or an icon, or a note) where the crosshair is. */
  placeAtCrosshair(): void {
    const at = this.crosshairPoint();
    if (at) this.placeAt(at, null);
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
    if (feature) this.complete(feature, this.points);
  }

  dispose(): void {
    this.reset();
    if (this.keyboard) this.host.crosshair(false);
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
    if (this.keyboard) {
      const centre = this.host.crosshairScreen();
      pen.crosshair(centre);
    }
  }

  /* ---------------------------------------------------------------- private */

  private crosshairPoint(): LngLat | null {
    const view = this.host.renderer.view();
    return mercToLngLat(view.unproject(this.host.crosshairScreen()));
  }

  /** One placement, from a click, a tap or the keyboard. `sample` is null for the keyboard. */
  private placeAt(at: LngLat, sample: PointerSample | null): void {
    if (this.kind === "point") {
      this.complete(newPoint(this.featureContext(), at), [at]);
      return;
    }
    if (this.kind === "annotation") {
      this.complete(newAnnotation(this.featureContext(), at, this.noteTextAt(at)), [at]);
      return;
    }
    if (this.closesAt(at, sample)) {
      this.finish();
      return;
    }
    this.add(at);
  }

  private add(at: LngLat): void {
    this.points = [...this.points, at];
    this.undone = [];
    this.placedAt = performance.now();
    this.refresh();
  }

  private featureContext(): NewFeatureContext {
    return { id: this.id, order: keyBetween(this.host.topOrder(), null), dir: this.host.dir(), defaults: this.host.drawDefaults() };
  }

  /** A note's text box: up and toward the reading direction, flipped when that would run off the map. */
  private noteTextAt(anchor: LngLat): LngLat {
    const view = this.host.renderer.view();
    const at = view.project(lngLatToMerc(anchor));
    const reading = this.host.dir() === "rtl" ? -1 : 1;
    let dx = NOTE_OFFSET.x * reading;
    if (at.x + dx > view.width - NOTE_EDGE || at.x + dx < NOTE_EDGE) dx = -dx;
    let dy = NOTE_OFFSET.y;
    if (at.y + dy < NOTE_EDGE / 2) dy = -dy;
    return mercToLngLat(view.unproject({ x: at.x + dx, y: at.y + dy }));
  }

  private strokeFeature(stroke: { from: LngLat; to: LngLat }): MapFeature | null {
    const context = this.featureContext();
    if (this.kind === "arrow") return newArrow(context, [stroke.from, stroke.to]);
    if (this.kind === "annotation") return newAnnotation(context, stroke.from, stroke.to);
    return null;
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

  private screenDistance(at: LngLat, other: LngLat | undefined): number {
    if (!other) return Infinity;
    const view = this.host.renderer.view();
    return distance(view.project(lngLatToMerc(at)), view.project(lngLatToMerc(other)));
  }

  private isNearLast(sample: PointerSample): boolean {
    const view = this.host.renderer.view();
    const reach = sample.touch ? CLOSE_DISTANCE_TOUCH : CLOSE_DISTANCE_MOUSE;
    return this.screenDistance(mercToLngLat(view.unproject(sample)), this.points[this.points.length - 1]) <= reach;
  }

  /**
   * A placement on the first point closes an area; on the last point it ends
   * any path. On touch, only once the double-tap window has passed.
   */
  private closesAt(at: LngLat, sample: PointerSample | null): boolean {
    if (this.points.length < minimumVertices(this.kind)) return false;
    const touch = sample?.touch === true;
    if (touch && performance.now() - this.placedAt < TOUCH_FINISH_DELAY_MS) return false;
    const reach = touch ? CLOSE_DISTANCE_TOUCH : CLOSE_DISTANCE_MOUSE;
    if (this.kind === "area" && this.screenDistance(at, this.points[0]) <= reach) return true;
    return this.screenDistance(at, this.points[this.points.length - 1]) <= reach;
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

  private complete(feature: MapFeature, points: LngLat[]): void {
    const finished: Finished = { kind: this.kind, featureId: feature.id, points: [...points] };
    this.reset();
    this.host.renderer.setDraft(null);
    this.host.progress(null);
    this.host.commit([feature]);
    this.host.select([feature.id], "replace");
    this.host.finished(finished);
    this.host.repaint();
    /* Every tool hands back to Select after a shape unless the person has locked it. */
    if (!this.host.toolLocked()) this.host.leaveTool();
  }

  private reset(): void {
    this.points = [];
    this.undone = [];
    this.snap = null;
    this.stroke = null;
    this.id = crypto.randomUUID();
  }

  /** Re-renders the preview and reports progress after any change to the points or the pointer. */
  private refresh(): void {
    if (this.keyboard) this.pointer = this.crosshairPoint();
    const shown = this.pointer ? [...this.points, this.pointer] : this.points;
    /* A note shows its box only once its anchor is known; a placed icon or note completes at once. */
    const previewable = this.isPath || (this.kind === "point" && this.pointer !== null);
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
