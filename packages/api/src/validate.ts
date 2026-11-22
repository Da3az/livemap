// What a JSON Schema cannot say about an edit. Each problem is a sentence a
// person can act on; the route answers it as 400 invalid_request.

import type { EditRequest, LngLat, MapFeature } from "@livemap/core";

function badPoint(point: LngLat): boolean {
  return Math.abs(point[1]) > 90;
}

function geometryProblem(feature: MapFeature): string | null {
  const points: LngLat[] = [];
  switch (feature.kind) {
    case "area":
      for (const [index, ring] of feature.rings.entries()) {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
          return `Area "${feature.id}": ring ${index + 1} is not closed; its last point must repeat its first.`;
        }
        points.push(...ring);
      }
      break;
    case "line":
    case "frontline":
      points.push(...feature.path);
      break;
    case "arrow":
      points.push(...feature.control);
      break;
    case "point":
      points.push(feature.at);
      break;
    case "annotation":
      points.push(feature.anchor, feature.textAt);
      break;
  }
  if (points.some(badPoint)) return `Feature "${feature.id}" has a latitude outside -90 to 90.`;
  if (feature.validFrom !== null && feature.validTo !== null && feature.validTo < feature.validFrom) {
    return `Feature "${feature.id}" ends before it starts.`;
  }
  return null;
}

/** The first problem with an edit's shape, or null. References to groups and presets are checked after the write. */
export function editProblem(edit: EditRequest): string | null {
  const seen = new Set<string>();
  for (const feature of edit.put) {
    if (seen.has(feature.id)) return `Feature "${feature.id}" appears twice in one save.`;
    seen.add(feature.id);
    const problem = geometryProblem(feature);
    if (problem) return problem;
  }
  const removed = new Set(edit.delete);
  for (const id of seen) if (removed.has(id)) return `Feature "${id}" is both saved and deleted in one save.`;
  if (edit.settings?.openingView && badPoint(edit.settings.openingView.center)) {
    return "The opening view's latitude is outside -90 to 90.";
  }
  for (const changes of [edit.settings?.groups, edit.settings?.presets]) {
    if (!changes) continue;
    const ids = changes.put.map((item) => item.id);
    if (new Set(ids).size !== ids.length) return "A group or preset appears twice in one save.";
  }
  return null;
}
