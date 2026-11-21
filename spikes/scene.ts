// Newsroom fixture exercising every feature kind at once, since the failures
// that matter are interactions. The features themselves live with the map
// templates, because the same scene is what New map offers as "Conflict
// tracker"; this file adds what only the headless render needs.

import type { MapFeature } from "@livemap/core";
import { findTemplate } from "../packages/api/src/templates.js";

const conflict = findTemplate("conflict-tracker")!;

export const SCENE_CENTER: [number, number] = [
  conflict.viewport.center[0],
  conflict.viewport.center[1],
];
export const SCENE_ZOOM = conflict.viewport.zoom;

export const scene: MapFeature[] = [...conflict.features];

// Kept as a re-export: the spike, the demo pages and the application all draw
// from the one set.
export { ICON_SVGS } from "../packages/app/src/icons.js";
