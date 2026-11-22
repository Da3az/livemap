import type { DrawProgress } from "@/editor/controller";
import type { LngLat, MapFeature } from "@/model/types";
import type { FeatureRenderer } from "@/render/feature-renderer";
import type { Pt } from "@/render/geo";
import type { View } from "@/render/view";
import type { ChromePen } from "./chrome";
import type { PointerHandler, PointerSample } from "./input";
import type { Snap } from "./snap";
import type { Finished } from "./draw-tool";

/** What a tool may ask of the controller. Tools hold gesture state only; the document is never theirs. */
export interface ToolHost {
  readonly renderer: FeatureRenderer;
  /** The feature as currently shown, including a gesture in flight. */
  feature(id: string): MapFeature | undefined;
  selection(): ReadonlySet<string>;
  /** Drawn, inside the time window and not locked. */
  isSelectable(id: string): boolean;
  /** The highest draw-order key in the document, or null when it is empty. */
  topOrder(): string | null;
  /** The snap target near a point, or null when snapping is off or nothing is close. */
  snapAt(p: Pt, options: { exclude: ReadonlySet<string>; extra: readonly LngLat[]; touch: boolean }): Snap | null;
  /** The last pointer was a finger or a pen: draw handles large. */
  coarse(): boolean;
  drawDefaults(): Partial<MapFeature>;
  dir(): "ltr" | "rtl";

  /** Show work in progress and report it as `gesture: "update"`. */
  update(put: MapFeature[]): void;
  /** Report the end of a gesture as one `gesture: "commit"`. */
  commit(put: MapFeature[], remove?: string[]): void;
  /** Drop a gesture in flight, restoring what it started from. */
  abandon(originals: MapFeature[]): void;
  select(ids: string[], mode: "replace" | "add" | "toggle"): void;
  /** Start or stop reshaping from inside the controller, and announce it. */
  reshape(id: string | null): void;
  /** Return to the select tool from inside the controller, and announce it. */
  leaveTool(): void;
  /** Keep the drawing tool after a shape instead of returning to Select. */
  toolLocked(): boolean;
  /** Keyboard placement started or stopped: the interface shows its buttons while it is on. */
  crosshair(on: boolean): void;
  /** A move by destination started (true) or ended (false). */
  moving(on: boolean): void;
  /** Where the crosshair sits: the centre of the map that panes and the dock leave visible, in CSS pixels. */
  crosshairScreen(): Pt;
  /** A shape was just finished, so an undo straight after can reopen it. */
  finished(finished: Finished): void;
  reject(detail: string): void;
  progress(progress: DrawProgress | null): void;
  repaint(): void;
}

export interface Tool extends PointerHandler {
  /** Returns true when the key was used. */
  key(event: KeyboardEvent): boolean;
  /**
   * Keys the tool must see even when focus has left the map: Delete on a
   * chosen vertex must remove that vertex, never fall through to the page's
   * own Delete and remove the whole feature.
   */
  capturesKey?(event: KeyboardEvent): boolean;
  cancel(): void;
  finish(): void;
  paint(pen: ChromePen, view: View): void;
  /** The CSS cursor for the pointer's position, or for no pointer at all. */
  cursor(sample: PointerSample | null): string;
  dispose(): void;
}
