import type { MapFeature, MapSettings } from "@/model/types";
import { compareOrder } from "@/model/order";
import { sampleCurve } from "./curve";
import { boxOf, lngLatToMerc, type Box, type Pt } from "./geo";
import type { Palette } from "./palette";
import type { ScreenShape } from "./shapes";
import { resolveFeatureStyle, type FeatureStyle } from "./style";
import { fontFamilies, layoutText, type TextBlock } from "./text";

/** A feature's geometry in Web Mercator world units, converted once and reused for every frame. */
export type Geometry =
  | { kind: "area"; rings: Pt[][] }
  | { kind: "line"; path: Pt[] }
  | { kind: "arrow"; control: Pt[]; curve: Pt[] }
  | { kind: "frontline"; path: Pt[] }
  | { kind: "point"; at: Pt }
  | { kind: "annotation"; anchor: Pt; textAt: Pt };

export interface SceneItem {
  feature: MapFeature;
  /** Hidden itself or through its group. Never drawn. */
  hidden: boolean;
  /** Locked itself or through its group. Drawn, but not selectable from the map. */
  locked: boolean;
  /** Validity window in epoch milliseconds; open ends are infinite. */
  from: number;
  to: number;
  inWindow: boolean;
  style: FeatureStyle;
  geometry: Geometry;
  box: Box;
  /** The optional label, or an annotation's text. */
  text: TextBlock | null;
  /** Screen geometry for the view named by `shapeKey`; rebuilt when the view changes. */
  shape: ScreenShape | null;
  shapeKey: string;
}

export interface TimeWindow {
  from: number;
  to: number;
}

const LABEL_MAX_WIDTH = 180;
const ANNOTATION_MAX_WIDTH = 240;

function toGeometry(feature: MapFeature): Geometry {
  switch (feature.kind) {
    case "area":
      return { kind: "area", rings: feature.rings.map((ring) => ring.map(lngLatToMerc)) };
    case "line":
      return { kind: "line", path: feature.path.map(lngLatToMerc) };
    case "frontline":
      return { kind: "frontline", path: feature.path.map(lngLatToMerc) };
    case "arrow": {
      const control = feature.control.map(lngLatToMerc);
      return { kind: "arrow", control, curve: sampleCurve(control, feature.curvature, feature.bend) };
    }
    case "point":
      return { kind: "point", at: lngLatToMerc(feature.at) };
    case "annotation":
      return { kind: "annotation", anchor: lngLatToMerc(feature.anchor), textAt: lngLatToMerc(feature.textAt) };
  }
}

function geometryPoints(geometry: Geometry): Pt[] {
  switch (geometry.kind) {
    case "area":
      return geometry.rings.flat();
    case "line":
    case "frontline":
      return geometry.path;
    case "arrow":
      return geometry.curve;
    case "point":
      return [geometry.at];
    case "annotation":
      return [geometry.anchor, geometry.textAt];
  }
}

function parseTime(value: string | null, open: number): number {
  if (value === null) return open;
  const time = Date.parse(value);
  return Number.isNaN(time) ? open : time;
}

export function toTimeWindow(window: { from: string | null; to: string } | null): TimeWindow | null {
  if (!window) return null;
  return { from: parseTime(window.from, -Infinity), to: parseTime(window.to, Infinity) };
}

function isInWindow(item: Pick<SceneItem, "from" | "to">, window: TimeWindow | null): boolean {
  return window === null || (item.from <= window.to && item.to >= window.from);
}

function buildItem(feature: MapFeature, settings: MapSettings, palette: Palette, window: TimeWindow | null): SceneItem {
  const group = feature.groupId === null ? undefined : settings.groups.find((candidate) => candidate.id === feature.groupId);
  const style = resolveFeatureStyle(feature, settings, palette);
  const geometry = toGeometry(feature);
  const family = fontFamilies().ui;
  const text =
    feature.kind === "annotation"
      ? layoutText(feature.text, style.text, { family, align: "start", maxWidth: ANNOTATION_MAX_WIDTH })
      : feature.label
        ? layoutText(feature.label, style.text, { family, align: "center", maxWidth: LABEL_MAX_WIDTH })
        : null;
  const from = parseTime(feature.validFrom, -Infinity);
  const to = parseTime(feature.validTo, Infinity);
  return {
    feature,
    hidden: feature.hidden || group?.hidden === true,
    locked: feature.locked || group?.locked === true,
    from,
    to,
    inWindow: isInWindow({ from, to }, window),
    style,
    geometry,
    box: boxOf(geometryPoints(geometry)),
    text,
    shape: null,
    shapeKey: "",
  };
}

/**
 * The ordered list of things to draw. Items are rebuilt only for features
 * whose object identity changed, so a drag that replaces one feature per
 * pointer move converts one feature per move.
 */
export class Scene {
  /** Ascending draw order: the last item is on top. */
  items: SceneItem[] = [];
  private byId = new Map<string, SceneItem>();
  private epoch = "";

  rebuild(features: readonly MapFeature[], settings: MapSettings, palette: Palette, window: TimeWindow | null, epoch: string): void {
    const reusable = epoch === this.epoch ? this.byId : new Map<string, SceneItem>();
    const next = new Map<string, SceneItem>();
    for (const feature of features) {
      const previous = reusable.get(feature.id);
      const item = previous && previous.feature === feature ? previous : buildItem(feature, settings, palette, window);
      next.set(feature.id, item);
    }
    this.byId = next;
    this.epoch = epoch;
    this.items = [...next.values()].sort((a, b) => compareOrder(a.feature, b.feature));
  }

  get(id: string): SceneItem | undefined {
    return this.byId.get(id);
  }

  /** Re-evaluates every item against a window. Returns true when any item's visibility changed. */
  applyWindow(window: TimeWindow | null): boolean {
    let changed = false;
    for (const item of this.items) {
      const next = isInWindow(item, window);
      if (next !== item.inWindow) {
        item.inWindow = next;
        changed = true;
      }
    }
    return changed;
  }
}

/** One standalone item, for the shape being drawn and for legend swatches. */
export function buildSceneItem(feature: MapFeature, settings: MapSettings, palette: Palette): SceneItem {
  return buildItem(feature, settings, palette, null);
}
