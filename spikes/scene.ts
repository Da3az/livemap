// Newsroom fixture exercising every feature kind at once, since the failures
// that matter are interactions. Southern Levant at z8-z11, for Arabic basemap labels.

import type { MapFeature } from "@livemap/core";

export const SCENE_CENTER: [number, number] = [35.75, 32.1];
export const SCENE_ZOOM = 9.2;

export const scene: MapFeature[] = [
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

// Stand-ins for the OCHA set. `#000000` because that is how OCHA ships, and
// the recolour path is what is under test. Inline keeps the spike network-free.
export const ICON_SVGS: Record<string, string> = {
  "evt:strike": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 1l2.2 6.3L20 5l-3.2 5.4L23 12l-6.2 1.6L20 19l-5.8-2.3L12 23l-2.2-6.3L4 19l3.2-5.4L1 12l6.2-1.6L4 5l5.8 2.3z" fill="#000000"/></svg>`,
  "evt:fire": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2c1.5 4-2 5.5-2 9a4 4 0 008 0c0-2-1-3.5-2-5 .5 3-1 4-2 4s-2-1.5-2-3c0-2 1-3.5 2-5z" fill="#000000"/><path d="M8 12c-1 1.5-2 3-2 5a6 6 0 0012 0c0-1-.3-2-.8-3 .3 3.5-2.2 6-5.2 6s-5-2-4-8z" fill="#000000"/></svg>`,
  "evt:displaced": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="8" cy="4" r="2.2" fill="#000000"/><path d="M6 7h4l1.5 5-1.6.6L9 10v12H7V14H5V9z" fill="#000000"/><circle cx="16" cy="5" r="1.8" fill="#000000"/><path d="M14.5 8h3l1.5 4-1.4.6L17 11v11h-1.8v-7h-1.6v-6z" fill="#000000"/></svg>`,
  "evt:checkpoint": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="10" width="20" height="4" fill="#000000"/><rect x="4" y="4" width="3" height="16" fill="#000000"/><rect x="17" y="4" width="3" height="16" fill="#000000"/></svg>`,
  "evt:aid": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="9.5" y="3" width="5" height="18" fill="#000000"/><rect x="3" y="9.5" width="18" height="5" fill="#000000"/></svg>`,
};
