import type { FeatureKind, LngLat, MapFeature } from "@/model/types";
import { lngLatToMerc, mercToLngLat, type Pt } from "@/render/geo";

/**
 * Pure geometry edits. Each returns a new feature and leaves its input alone,
 * so a gesture can always fall back to the feature it started from.
 */

/** Addresses one vertex: `part` is the ring of an area (0 is the outline) and 0 for every other kind. */
export interface VertexRef {
  part: number;
  index: number;
}

export function sameVertex(a: VertexRef | null, b: VertexRef | null): boolean {
  return a !== null && b !== null && a.part === b.part && a.index === b.index;
}

function openRing(ring: readonly LngLat[]): LngLat[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = ring.length > 1 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
  return closed ? ring.slice(0, -1) : [...ring];
}

function closeRing(ring: readonly LngLat[]): LngLat[] {
  const first = ring[0];
  return first ? [...ring, first] : [];
}

/**
 * The editable vertices of a feature. Area rings come back open (without the
 * repeated closing vertex); an annotation is its anchor followed by its text position.
 */
export function vertexParts(feature: MapFeature): LngLat[][] {
  switch (feature.kind) {
    case "area":
      return feature.rings.map(openRing);
    case "line":
    case "frontline":
      return [[...feature.path]];
    case "arrow":
      return [[...feature.control]];
    case "point":
      return [[feature.at]];
    case "annotation":
      return [[feature.anchor, feature.textAt]];
  }
}

function withParts(feature: MapFeature, parts: LngLat[][]): MapFeature {
  const [first = []] = parts;
  const [a, b] = first;
  switch (feature.kind) {
    case "area":
      return { ...feature, rings: parts.map(closeRing) };
    case "line":
    case "frontline":
      return { ...feature, path: first };
    case "arrow":
      return { ...feature, control: first };
    case "point":
      return a ? { ...feature, at: a } : feature;
    case "annotation":
      return a && b ? { ...feature, anchor: a, textAt: b } : feature;
  }
}

/** Whether vertices can be added to and removed from this kind. */
export function hasFreeVertices(kind: FeatureKind): boolean {
  return kind !== "point" && kind !== "annotation";
}

export function minimumVertices(kind: FeatureKind): number {
  return kind === "area" ? 3 : kind === "point" ? 1 : 2;
}

export function moveVertex(feature: MapFeature, ref: VertexRef, to: LngLat): MapFeature {
  const parts = vertexParts(feature).map((part, partIndex) =>
    partIndex === ref.part ? part.map((vertex, index) => (index === ref.index ? to : vertex)) : part,
  );
  return withParts(feature, parts);
}

/** Inserts a vertex so that it takes position `ref.index` within its part. */
export function insertVertex(feature: MapFeature, ref: VertexRef, at: LngLat): MapFeature {
  if (!hasFreeVertices(feature.kind)) return feature;
  const parts = vertexParts(feature).map((part, partIndex) =>
    partIndex === ref.part ? [...part.slice(0, ref.index), at, ...part.slice(ref.index)] : part,
  );
  return withParts(feature, parts);
}

/**
 * Removes a vertex. Returns null when the shape would stop being one: fewer
 * than two points on a path, fewer than three on an outline. A hole that
 * would drop below three vertices is removed whole instead.
 */
export function deleteVertex(feature: MapFeature, ref: VertexRef): MapFeature | null {
  if (!hasFreeVertices(feature.kind)) return null;
  const parts = vertexParts(feature);
  const part = parts[ref.part];
  if (!part) return null;
  if (part.length <= minimumVertices(feature.kind)) {
    if (feature.kind === "area" && ref.part > 0) return withParts(feature, parts.filter((_, index) => index !== ref.part));
    return null;
  }
  const next = parts.map((current, partIndex) => (partIndex === ref.part ? current.filter((_, index) => index !== ref.index) : current));
  return withParts(feature, next);
}

/** Moves a whole feature by a mercator offset, which keeps its on-screen shape while it is dragged. */
export function translateFeature(feature: MapFeature, offset: Pt): MapFeature {
  const shift = (at: LngLat): LngLat => {
    const merc = lngLatToMerc(at);
    return mercToLngLat({ x: merc.x + offset.x, y: merc.y + offset.y });
  };
  return withParts(
    feature,
    vertexParts(feature).map((part) => part.map(shift)),
  );
}

/** Every coordinate of a feature, for fitting the view to it. */
export function allCoordinates(feature: MapFeature): LngLat[] {
  return vertexParts(feature).flat();
}
