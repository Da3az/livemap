import type { BasemapStyleId } from "@/model/types";

/**
 * What each OpenFreeMap style draws, for the picker's small diagrams. The
 * colours are the styles' own (read from their style JSON on 2026-11-21),
 * so they are basemap data, not interface tokens. The renderer then tints
 * land and water with the map palette and mutes everything else halfway
 * toward the land, except on Fiord; the diagrams apply the same muting.
 *
 * Layer counts from the same JSON: Positron 55 layers, 19 road lines with 4
 * casings, 5 land-cover fills; Bright 119, 57 road lines with 21 casings, 15
 * land-cover fills; Liberty 111, 58 road lines with 22 casings, 12 land-cover
 * fills and extruded buildings (which the renderer leaves out); Dark 47.
 */
export interface BasemapLook {
  id: BasemapStyleId;
  /** Drawn with the dark interface tokens for land and water. */
  dark: boolean;
  /** Land and water come from the palette tokens rather than the style. */
  tinted: boolean;
  /** Fiord keeps its own; null where the palette's tokens are used. */
  land: string | null;
  water: string | null;
  major: { fill: string; casing: string | null; width: number };
  minor: { fill: string; width: number };
  /** Woods and parks, where the style shades them. */
  green: string | null;
}

export const BASEMAP_LOOKS: readonly BasemapLook[] = [
  {
    id: "positron",
    dark: false,
    tinted: true,
    land: null,
    water: null,
    major: { fill: "#ffffff", casing: "#d5d5d5", width: 4.0 },
    minor: { fill: "#e0e0e0", width: 1.8 },
    green: "#dce0dc",
  },
  {
    id: "bright",
    dark: false,
    tinted: true,
    land: null,
    water: null,
    major: { fill: "#ffcc88", casing: "#e9ac77", width: 5.4 },
    minor: { fill: "#ffeeaa", width: 3.2 },
    green: "#66aa44",
  },
  {
    id: "liberty",
    dark: false,
    tinted: true,
    land: null,
    water: null,
    major: { fill: "#ffcc88", casing: "#e9ac77", width: 5.4 },
    minor: { fill: "#ffffff", width: 2.9 },
    green: "#a5e48a",
  },
  {
    id: "dark",
    dark: true,
    tinted: true,
    land: null,
    water: null,
    major: { fill: "#121212", casing: "#3c3c3c", width: 4.0 },
    minor: { fill: "#181818", width: 1.8 },
    green: "#202020",
  },
  {
    id: "fiord",
    dark: true,
    tinted: false,
    land: "#45516e",
    water: "#38435c",
    major: { fill: "#3c4357", casing: "#5b6887", width: 4.0 },
    minor: { fill: "#5b6887", width: 1.8 },
    green: "#4c5e6b",
  },
];
