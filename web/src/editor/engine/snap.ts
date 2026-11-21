import type { LngLat } from "@/model/types";
import type { FeatureRenderer } from "@/render/feature-renderer";
import { boxContains, closestOnSegment, distance, lngLatToMerc, mercToLngLat, padBox, segments, type Pt } from "@/render/geo";
import type { SceneItem } from "@/render/scene";
import { worldWrap } from "@/render/shapes";
import type { View } from "@/render/view";
import { vertexParts } from "./edit";

export interface Snap {
  at: LngLat;
  screen: Pt;
  type: "vertex" | "edge";
}

interface SnapOptions {
  tolerance: number;
  /** Features that must not attract the pointer: the one being reshaped. */
  exclude: ReadonlySet<string>;
  /** Extra vertices to snap to: the earlier points of the shape being drawn. */
  extra: readonly LngLat[];
}

/** The polylines a pointer can slide along: outlines, paths, and an arrow's drawn curve. */
function edgesOf(item: SceneItem): Pt[][] {
  const { geometry } = item;
  switch (geometry.kind) {
    case "area":
      return geometry.rings;
    case "line":
    case "frontline":
      return [geometry.path];
    case "arrow":
      return [geometry.curve];
    default:
      return [];
  }
}

/**
 * The nearest vertex within tolerance, else the nearest edge. A vertex snap
 * returns the other feature's stored coordinate exactly, so two areas that
 * share a border share the same numbers and leave no sliver between them.
 */
export function findSnap(renderer: FeatureRenderer, view: View, p: Pt, options: SnapOptions): Snap | null {
  const best: { vertex: Snap | null; edge: Snap | null } = { vertex: null, edge: null };
  let vertexDistance = options.tolerance;
  let edgeDistance = options.tolerance;

  const offerVertex = (at: LngLat, screen: Pt) => {
    const d = distance(p, screen);
    if (d <= vertexDistance) {
      vertexDistance = d;
      best.vertex = { at, screen, type: "vertex" };
    }
  };

  for (const at of options.extra) offerVertex(at, view.project(lngLatToMerc(at)));

  for (const item of renderer.visibleItems()) {
    if (options.exclude.has(item.feature.id)) continue;
    const shape = renderer.shape(item.feature.id, view);
    if (!shape || !boxContains(padBox(shape.box, options.tolerance), p)) continue;
    const wrap = worldWrap(item, view);
    for (const part of vertexParts(item.feature)) {
      for (const at of part) offerVertex(at, view.project(lngLatToMerc(at), wrap));
    }
    for (const line of edgesOf(item)) {
      for (const [a, b] of segments(line)) {
        const screen = closestOnSegment(p, view.project(a, wrap), view.project(b, wrap));
        const d = distance(p, screen);
        if (d <= edgeDistance) {
          edgeDistance = d;
          const merc = view.unproject(screen);
          best.edge = { at: mercToLngLat({ x: merc.x - wrap, y: merc.y }), screen, type: "edge" };
        }
      }
    }
  }
  return best.vertex ?? best.edge;
}
