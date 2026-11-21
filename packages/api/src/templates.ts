// Starting points offered by New map. Static data rather than rows: a template
// is copied into a tenant once and then belongs to it, so there is nothing to
// keep in sync and no cross-tenant table to put a policy on.
//
// Browser-safe on purpose — types only from core, no Node imports — because the
// headless spike bundles the conflict scene straight from this file.

import type { LabelStyle, MapFeature, TextDir, Viewport } from "@livemap/core";

export interface MapTemplate {
  readonly id: string;
  readonly title: string;
  readonly titleDir: TextDir;
  readonly uiDir: TextDir;
  readonly viewport: Viewport;
  readonly labelLangs: readonly string[];
  readonly features: readonly MapFeature[];
}

const LABEL: LabelStyle = {
  color: "#16130f",
  haloColor: "#ffffff",
  haloWidth: 1.6,
  size: 12,
};

// Exercises every feature kind at once, since the rendering failures that
// matter are interactions. Southern Levant at z8-z11, for Arabic basemap labels.
const CONFLICT: readonly MapFeature[] = [
  {
    id: "area-contested",
    kind: "area",
    at: "A",
    rings: [
      [
        [35.1, 32.35],
        [35.65, 32.42],
        [35.72, 32.1],
        [35.2, 32.02],
        [35.1, 32.35],
      ],
    ],
    fill: { color: "#E03C31", opacity: 0.28 },
    stroke: { color: "#E03C31", width: 2, opacity: 0.95 },
    label: { value: "Contested", dir: "ltr" },
    labelStyle: {
      color: "#7A1B14",
      haloColor: "#ffffff",
      haloWidth: 1.6,
      size: 12,
    },
  },
  {
    id: "area-held",
    kind: "area",
    at: "B",
    rings: [
      [
        [35.78, 32.45],
        [36.4, 32.5],
        [36.45, 32.08],
        [35.8, 32.02],
        [35.78, 32.45],
      ],
    ],
    fill: { color: "#1F7A4C", opacity: 0.24 },
    stroke: { color: "#1F7A4C", width: 2, opacity: 0.95 },
  },
  {
    id: "area-evac",
    kind: "area",
    at: "C",
    rings: [
      [
        [35.25, 31.78],
        [35.95, 31.84],
        [35.98, 31.52],
        [35.3, 31.48],
        [35.25, 31.78],
      ],
    ],
    fill: { color: "#E8A33D", opacity: 0.3 },
    // Dashed strokes take a separate layer; this exercises that filter path.
    stroke: { color: "#B8761A", width: 2, opacity: 1, dash: [2, 1.5] },
  },

  {
    id: "front-1",
    kind: "frontline",
    at: "D",
    path: [
      [35.72, 32.42],
      [35.75, 32.24],
      [35.77, 32.06],
      [35.82, 31.9],
    ],
    facing: "left",
    toothSpacing: 4000,
    toothSize: 2000,
    stroke: { color: "#111111", width: 2.5, opacity: 1 },
  },

  {
    id: "arrow-advance",
    kind: "arrow",
    at: "E",
    control: [
      [35.2, 31.62],
      [35.45, 31.8],
      [35.7, 31.88],
      [36.0, 32.12],
    ],
    curvature: 1,
    head: "single",
    chevrons: true,
    stroke: { color: "#E03C31", width: 5, opacity: 1 },
  },
  {
    id: "arrow-withdraw",
    kind: "arrow",
    at: "F",
    control: [
      [36.3, 32.38],
      [36.05, 32.46],
      [35.86, 32.52],
    ],
    curvature: 1,
    head: "double",
    chevrons: false,
    stroke: { color: "#2B5FD9", width: 3.5, opacity: 1 },
  },

  {
    id: "pt-strike",
    kind: "point",
    at: "G",
    at_: [35.46, 32.28],
    icon: "evt:strike",
    iconColor: "#E03C31",
    iconSize: 1,
  },
  {
    id: "pt-fire",
    kind: "point",
    at: "H",
    at_: [35.58, 32.08],
    icon: "evt:fire",
    iconColor: "#E8731A",
    iconSize: 1,
  },
  {
    id: "pt-displaced",
    kind: "point",
    at: "I",
    at_: [35.4, 31.68],
    icon: "evt:displaced",
    iconColor: "#2B5FD9",
    iconSize: 1,
  },
  {
    id: "pt-checkpoint",
    kind: "point",
    at: "J",
    at_: [35.76, 32.16],
    icon: "evt:checkpoint",
    iconColor: "#4A4A4A",
    iconSize: 0.9,
  },
  {
    id: "pt-aid",
    kind: "point",
    at: "K",
    at_: [35.62, 31.62],
    icon: "evt:aid",
    iconColor: "#1F7A4C",
    iconSize: 1,
  },

  {
    id: "note-advance",
    kind: "annotation",
    at: "L",
    anchor: [35.7, 31.88],
    offset: [84, -52],
    text: { value: "رتل مدرع يتقدم شمالاً", dir: "auto" },
    labelStyle: {
      color: "#111111",
      haloColor: "#ffffff",
      haloWidth: 1.6,
      size: 14,
    },
    leader: {
      color: "#111111",
      width: 1.2,
      dash: [2, 1.5],
      shape: "straight",
      anchorDot: true,
    },
  },
  {
    id: "note-hq",
    kind: "annotation",
    at: "M",
    anchor: [35.9, 32.3],
    offset: [70, 44],
    text: { value: "Brigade HQ relocated", dir: "auto" },
    labelStyle: {
      color: "#111111",
      haloColor: "#ffffff",
      haloWidth: 1.6,
      size: 13,
    },
    leader: {
      color: "#333333",
      width: 1.2,
      shape: "elbow",
      anchorDot: true,
    },
  },
  {
    // Placed to collide with note-advance at low zoom.
    id: "note-crossing",
    kind: "annotation",
    at: "N",
    anchor: [35.66, 31.84],
    offset: [96, -34],
    text: { value: "معبر النهر", dir: "auto" },
    labelStyle: {
      color: "#7A1B14",
      haloColor: "#ffffff",
      haloWidth: 1.6,
      size: 13,
    },
    leader: {
      color: "#7A1B14",
      width: 1.2,
      shape: "straight",
      anchorDot: true,
    },
  },
];

// A forecast track: the path is one curved arrow, and the uncertainty widens
// along it as two nested areas.
const STORM: readonly MapFeature[] = [
  {
    id: "cone-outer",
    kind: "area",
    at: "A",
    rings: [
      [
        [-78.4, 24.6],
        [-74.6, 26.2],
        [-73.2, 31.4],
        [-76.0, 35.4],
        [-81.6, 34.6],
        [-82.4, 29.6],
        [-80.6, 25.6],
        [-78.4, 24.6],
      ],
    ],
    fill: { color: "#2F6FB2", opacity: 0.14 },
    stroke: { color: "#2F6FB2", width: 1, opacity: 0.7, dash: [4, 3] },
    label: { value: "5-day uncertainty", dir: "ltr" },
    labelStyle: LABEL,
  },
  {
    id: "cone-inner",
    kind: "area",
    at: "B",
    rings: [
      [
        [-78.2, 25.2],
        [-76.2, 26.2],
        [-75.6, 29.4],
        [-77.2, 31.6],
        [-79.8, 31.0],
        [-80.2, 27.8],
        [-78.2, 25.2],
      ],
    ],
    fill: { color: "#2F6FB2", opacity: 0.24 },
    stroke: { color: "#2F6FB2", width: 1.5, opacity: 0.9 },
    label: { value: "3-day uncertainty", dir: "ltr" },
    labelStyle: LABEL,
  },
  {
    id: "warning-coast",
    kind: "line",
    at: "C",
    path: [
      [-80.1, 26.7],
      [-80.6, 28.4],
      [-81.3, 30.2],
      [-81.0, 31.9],
    ],
    stroke: { color: "#E03C31", width: 4, opacity: 0.95 },
    label: { value: "Hurricane warning", dir: "ltr" },
    labelStyle: LABEL,
  },
  {
    id: "track",
    kind: "arrow",
    at: "D",
    control: [
      [-72.4, 21.6],
      [-75.6, 23.8],
      [-77.8, 26.6],
      [-78.6, 29.6],
      [-78.0, 33.0],
    ],
    curvature: 0.8,
    head: "single",
    stroke: { color: "#16130f", width: 3, opacity: 1 },
    chevrons: true,
  },
  {
    id: "shelter-1",
    kind: "point",
    at: "E",
    at_: [-81.4, 28.5],
    icon: "evt:aid",
    iconColor: "#1F7A4C",
    iconSize: 1,
    disc: { fill: "#ffffff", ring: "#1F7A4C" },
    label: { value: "Shelter", dir: "ltr" },
    labelStyle: LABEL,
  },
  {
    id: "evacuation-1",
    kind: "point",
    at: "F",
    at_: [-80.2, 25.8],
    icon: "evt:displaced",
    iconColor: "#B2412F",
    iconSize: 1,
    disc: { fill: "#ffffff", ring: "#B2412F" },
    label: { value: "Evacuation zone", dir: "ltr" },
    labelStyle: LABEL,
  },
  {
    id: "note-position",
    kind: "annotation",
    at: "G",
    anchor: [-78.6, 29.6],
    offset: [90, -40],
    text: { value: "Expected position, Thursday 06:00", dir: "ltr" },
    labelStyle: LABEL,
    leader: { color: "#16130f", width: 1, shape: "elbow", anchorDot: true },
  },
];

// Regions coloured by outcome with the figures as annotations — the shape of a
// results night, on invented boundaries so that nothing in it reads as a claim
// about a real vote.
const RESULTS: readonly MapFeature[] = [
  {
    id: "region-north",
    kind: "area",
    at: "A",
    rings: [
      [
        [9.0, 47.6],
        [11.4, 47.7],
        [11.6, 46.6],
        [9.2, 46.5],
        [9.0, 47.6],
      ],
    ],
    fill: { color: "#2F6FB2", opacity: 0.38 },
    stroke: { color: "#ffffff", width: 1.5, opacity: 1 },
    label: { value: "North", dir: "ltr" },
    labelStyle: LABEL,
  },
  {
    id: "region-east",
    kind: "area",
    at: "B",
    rings: [
      [
        [11.4, 47.7],
        [13.6, 47.5],
        [13.4, 45.9],
        [11.6, 46.6],
        [11.4, 47.7],
      ],
    ],
    fill: { color: "#B2412F", opacity: 0.38 },
    stroke: { color: "#ffffff", width: 1.5, opacity: 1 },
    label: { value: "East", dir: "ltr" },
    labelStyle: LABEL,
  },
  {
    id: "region-south",
    kind: "area",
    at: "C",
    rings: [
      [
        [9.2, 46.5],
        [11.6, 46.6],
        [13.4, 45.9],
        [12.6, 44.9],
        [9.8, 45.1],
        [9.2, 46.5],
      ],
    ],
    fill: { color: "#2F6FB2", opacity: 0.2 },
    stroke: { color: "#ffffff", width: 1.5, opacity: 1 },
    label: { value: "South", dir: "ltr" },
    labelStyle: LABEL,
  },
  {
    id: "result-north",
    kind: "annotation",
    at: "D",
    anchor: [10.2, 47.1],
    offset: [0, 22],
    text: { value: "58% — declared", dir: "ltr" },
    labelStyle: LABEL,
    leader: null,
  },
  {
    id: "result-east",
    kind: "annotation",
    at: "E",
    anchor: [12.5, 46.9],
    offset: [0, 22],
    text: { value: "61% — declared", dir: "ltr" },
    labelStyle: LABEL,
    leader: null,
  },
  {
    id: "result-south",
    kind: "annotation",
    at: "F",
    anchor: [11.2, 45.8],
    offset: [0, 22],
    text: { value: "51% — counting", dir: "ltr" },
    labelStyle: LABEL,
    leader: null,
  },
  {
    id: "note-recount",
    kind: "annotation",
    at: "G",
    anchor: [12.6, 44.9],
    offset: [80, 30],
    text: { value: "Recount requested", dir: "ltr" },
    labelStyle: LABEL,
    leader: { color: "#16130f", width: 1, shape: "straight", anchorDot: true },
  },
];

export const TEMPLATES: readonly MapTemplate[] = [
  {
    id: "conflict-tracker",
    title: "Conflict tracker",
    titleDir: "ltr",
    uiDir: "rtl",
    viewport: { center: [35.75, 32.1], zoom: 9.2, bearing: 0, pitch: 0 },
    labelLangs: ["ar", "en"],
    features: CONFLICT,
  },
  {
    id: "storm-track",
    title: "Storm track",
    titleDir: "ltr",
    uiDir: "ltr",
    viewport: { center: [-78.2, 29.2], zoom: 5.2, bearing: 0, pitch: 0 },
    labelLangs: ["en"],
    features: STORM,
  },
  {
    id: "regional-results",
    title: "Regional results",
    titleDir: "ltr",
    uiDir: "ltr",
    viewport: { center: [11.3, 46.3], zoom: 6.6, bearing: 0, pitch: 0 },
    labelLangs: ["en"],
    features: RESULTS,
  },
];

export function findTemplate(id: string): MapTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/** What a map with no template opens on. */
export const BLANK_VIEWPORT: Viewport = {
  center: [20, 25],
  zoom: 2.2,
  bearing: 0,
  pitch: 0,
};
