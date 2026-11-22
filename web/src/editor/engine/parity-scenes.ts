import type { IconId, LngLat, MapFeature, MapSettings, PaletteSlot, Viewport } from "@/model/types";
import type { Box } from "@/render/geo";
import { base, FIXTURE_VIEWPORT, fixtureFeatures, fixtureSettings, ICONS } from "./fixtures";

/**
 * Fixed scenes for judging the feature renderer against a reference image:
 * every kind, fill pattern, dash, arrow style, tooth shape, marker, leader,
 * label treatment and direction, in both palettes, at a few views, one of
 * them pitched. Development only; nothing in the product imports this.
 */
export interface ParityScene {
  id: string;
  width: number;
  height: number;
  theme: "light" | "dark";
  viewport: Viewport;
  features: () => MapFeature[];
  settings: () => MapSettings;
  /** The reader's phone rules for notes. */
  narrow?: boolean;
  /** Furniture rectangles labels must avoid, in CSS pixels. */
  obstacles?: Box[];
  /** Selected features: their labels are placed first and never dropped. */
  priority?: string[];
}

const at = (column: number, row: number, dx = 0, dy = 0): LngLat => [56.45 + column * 0.32 + dx, 24.62 - row * 0.27 + dy];

function catalogue(): MapFeature[] {
  const out: MapFeature[] = [];
  let order = 0;
  const next = () => `c${String(order++).padStart(3, "0")}`;
  const slot = (n: number) => ((n % 8) + 1) as PaletteSlot;

  /* Row 0: areas, every pattern against every outline dash, one with a hole. */
  const patterns = ["none", "hatch", "cross", "dots"] as const;
  const dashes = ["solid", "dashed", "dotted", { custom: [10, 3, 2, 3] }] as const;
  patterns.forEach((pattern, index) => {
    const [x, y] = at(index * 2, 0);
    const ring: LngLat[] = [
      [x, y],
      [x + 0.5, y + 0.02],
      [x + 0.45, y - 0.2],
      [x + 0.05, y - 0.18],
      [x, y],
    ];
    const rings = index === 1 ? [ring, [[x + 0.15, y - 0.05], [x + 0.3, y - 0.05], [x + 0.3, y - 0.13], [x + 0.15, y - 0.13], [x + 0.15, y - 0.05]] as LngLat[]] : [ring];
    out.push({
      ...base(`area-${pattern}`, next(), `Area ${pattern}`),
      kind: "area",
      rings,
      fill: { color: { slot: slot(index) }, opacity: [0.4, 0.3, 0.2, 0.5][index] ?? 0.4, pattern },
      stroke: { color: { slot: slot(index) }, width: [1.5, 2, 3, 2.5][index] ?? 2, opacity: 1, dash: dashes[index] ?? "solid" },
      label: { value: pattern === "none" ? "Shelling reported" : `${pattern} fill`, dir: "ltr" },
      labelStyle: { color: "ink", size: 12, weight: 600, halo: true, box: index === 2 },
    });
  });
  /* A weak colour (ochre) with no stroke gets an outline; a translucent wide outline must not darken at its corners. */
  {
    const [x, y] = at(8, 0);
    out.push({
      ...base("area-weak", next(), "Weak, no stroke"),
      kind: "area",
      rings: [[[x, y], [x + 0.25, y - 0.03], [x + 0.2, y - 0.22], [x, y]]],
      fill: { color: { slot: 3 }, opacity: 0.6, pattern: "none" },
      stroke: { color: { slot: 3 }, width: 0, opacity: 1, dash: "solid" },
    });
    out.push({
      ...base("area-translucent", next(), "Translucent outline"),
      kind: "area",
      rings: [[[x - 0.1, y - 0.3], [x + 0.25, y - 0.32], [x + 0.32, y - 0.5], [x + 0.05, y - 0.44], [x - 0.1, y - 0.3]]],
      fill: { color: { slot: 5 }, opacity: 0.15, pattern: "none" },
      stroke: { color: { slot: 5 }, width: 7, opacity: 0.5, dash: "solid" },
    });
  }

  /* Row 1: lines, every dash at three widths; weak colours are cased. */
  const lineDashes = ["solid", "dashed", "dotted", { custom: [12, 4, 2, 4] }] as const;
  lineDashes.forEach((dash, index) => {
    [1, 3, 7].forEach((width, step) => {
      const [x, y] = at(index * 2, 1, 0, -step * 0.07);
      out.push({
        ...base(`line-${index}-${width}`, next(), `Line ${index} ${width}`),
        kind: "line",
        path: [
          [x, y],
          [x + 0.2, y + 0.04],
          [x + 0.32, y - 0.02],
          [x + 0.55, y + 0.03],
        ],
        stroke: { color: { slot: slot(index + step * 2) }, width, opacity: 1, dash },
      });
    });
  });
  {
    const [x, y] = at(8, 1);
    out.push({
      ...base("line-zigzag", next(), "Translucent zigzag"),
      kind: "line",
      path: [
        [x, y],
        [x + 0.08, y - 0.18],
        [x + 0.16, y],
        [x + 0.2, y - 0.2],
        [x + 0.3, y - 0.04],
      ],
      stroke: { color: { slot: 1 }, width: 10, opacity: 0.5, dash: "solid" },
      label: { value: "Supply route", dir: "ltr" },
      labelStyle: { color: { slot: 1 }, size: 11, weight: 400, halo: false, box: false },
    });
  }

  /* Rows 2-3: arrows. */
  const arrowCases: { head: "none" | "single" | "double"; tapered: boolean; dash: "solid" | "dashed" | "dotted"; curvature: number; points: number; bend?: "left" | "right"; width: number }[] = [
    { head: "single", tapered: false, dash: "solid", curvature: 1, points: 3, width: 3 },
    { head: "double", tapered: false, dash: "dashed", curvature: 0.7, points: 3, width: 3 },
    { head: "none", tapered: false, dash: "solid", curvature: 0, points: 3, width: 4 },
    { head: "single", tapered: true, dash: "solid", curvature: 1, points: 3, width: 3 },
    { head: "single", tapered: true, dash: "dashed", curvature: 0.6, points: 2, width: 2.5 },
    { head: "single", tapered: false, dash: "solid", curvature: 1, points: 2, bend: "left", width: 3 },
    { head: "single", tapered: false, dash: "solid", curvature: 0.5, points: 2, bend: "right", width: 3 },
    { head: "double", tapered: true, dash: "dotted", curvature: 1, points: 3, width: 4 },
    { head: "single", tapered: false, dash: "dotted", curvature: 1, points: 3, width: 3 },
    { head: "single", tapered: false, dash: "solid", curvature: 1, points: 4, width: 8 },
  ];
  arrowCases.forEach((arrow, index) => {
    const [x, y] = at((index % 5) * 2, 2 + Math.floor(index / 5));
    const control: LngLat[] =
      arrow.points === 2
        ? [
            [x, y],
            [x + 0.5, y - 0.12],
          ]
        : arrow.points === 3
          ? [
              [x, y],
              [x + 0.25, y + 0.08],
              [x + 0.52, y - 0.1],
            ]
          : [
              [x, y],
              [x + 0.15, y + 0.1],
              [x + 0.35, y - 0.12],
              [x + 0.55, y],
            ];
    out.push({
      ...base(`arrow-${index}`, next(), `Arrow ${index}`),
      kind: "arrow",
      control,
      curvature: arrow.curvature,
      ...(arrow.bend ? { bend: arrow.bend } : {}),
      head: arrow.head,
      tapered: arrow.tapered,
      stroke: { color: { slot: slot(index + 3) }, width: arrow.width, opacity: index === 9 ? 0.6 : 1, dash: arrow.dash },
      ...(index === 0 ? { label: { value: "Advance", dir: "ltr" as const } } : {}),
    });
  });

  /* Row 4: front lines, both tooth shapes facing both ways, one dashed and one turning sharply. */
  const fronts: { shape: "triangle" | "semicircle"; facing: "left" | "right"; dash: "solid" | "dashed" }[] = [
    { shape: "triangle", facing: "left", dash: "solid" },
    { shape: "triangle", facing: "right", dash: "solid" },
    { shape: "semicircle", facing: "left", dash: "solid" },
    { shape: "semicircle", facing: "right", dash: "dashed" },
    { shape: "triangle", facing: "left", dash: "dashed" },
  ];
  fronts.forEach((front, index) => {
    const [x, y] = at(index * 2, 4);
    out.push({
      ...base(`front-${index}`, next(), `Front ${index}`),
      kind: "frontline",
      path:
        index === 4
          ? [
              [x, y],
              [x + 0.25, y - 0.15],
              [x + 0.1, y - 0.2],
              [x + 0.5, y - 0.18],
            ]
          : [
              [x, y],
              [x + 0.2, y - 0.1],
              [x + 0.4, y - 0.05],
              [x + 0.55, y - 0.15],
            ],
      facing: front.facing,
      toothShape: front.shape,
      toothSpacing: 18 + index * 3,
      toothSize: 7 + index * 2,
      stroke: { color: { slot: slot(index * 3) }, width: 2 + (index % 2), opacity: 1, dash: front.dash },
      ...(index === 2 ? { label: { value: "خط التماس", dir: "rtl" as const } } : {}),
    });
  });

  /* Row 5: markers, every icon and number width at three sizes. */
  ICONS.forEach((icon: IconId, index) => {
    const [x, y] = at(index * 0.85, 5);
    out.push({
      ...base(`marker-${icon}`, next(), `Marker ${icon}`),
      kind: "point",
      at: [x, y],
      symbol: { icon },
      color: { slot: slot(index) },
      size: [16, 26, 40][index % 3] ?? 26,
    });
  });
  ["7", "42", "305"].forEach((number, index) => {
    const [x, y] = at(index * 1.4, 6, 0, 0.08);
    out.push({
      ...base(`number-${number}`, next(), `Number ${number}`),
      kind: "point",
      at: [x, y],
      symbol: { number },
      color: { slot: slot(index + 5) },
      size: [20, 28, 36][index] ?? 28,
      label: { value: ["Checkpoint", "نقطة تفتيش", "Crossing closed"][index] ?? "", dir: index === 1 ? "rtl" : "ltr" },
      labelStyle: { color: index === 2 ? { slot: 2 } : "ink", size: [11, 13, 12][index] ?? 12, weight: index === 1 ? 600 : 400, halo: index !== 2, box: index === 2 },
    });
  });

  /* Row 6: notes, every leader and treatment, in both directions. */
  const notes: { shape: "straight" | "elbow" | null; dot: boolean; box: boolean; halo: boolean; rtl: boolean }[] = [
    { shape: "straight", dot: true, box: false, halo: true, rtl: false },
    { shape: "elbow", dot: true, box: true, halo: false, rtl: false },
    { shape: "elbow", dot: false, box: false, halo: true, rtl: true },
    { shape: "straight", dot: false, box: true, halo: true, rtl: true },
    { shape: null, dot: false, box: false, halo: false, rtl: false },
  ];
  notes.forEach((note, index) => {
    const [x, y] = at(4.6 + index * 1.1, 6);
    out.push({
      ...base(`note-${index}`, next(), `Note ${index}`),
      kind: "annotation",
      anchor: [x, y],
      textAt: [x + (index % 2 === 0 ? 0.18 : -0.12), y - 0.14],
      text: note.rtl ? { value: "تقدّم القوات\nنحو المدينة", dir: "rtl" } : { value: index === 4 ? "Sea of Oman" : "Convoy stopped\nat 14:20", dir: "ltr" },
      labelStyle: { color: index === 4 ? { slot: 2 } : "ink", size: 12, weight: index === 1 ? 600 : 400, halo: note.halo, box: note.box },
      leader: note.shape ? { shape: note.shape, anchorDot: note.dot } : null,
    });
  });
  return out;
}

/** A dense spot at street zoom, for jitter and precision. */
function closeUp(): MapFeature[] {
  const c: LngLat = [57.44, 23.85];
  const d = 0.00012;
  return [
    {
      ...base("close-area", "a", "Compound"),
      kind: "area",
      rings: [[[c[0] - d, c[1] + d], [c[0] + d * 1.4, c[1] + d * 0.9], [c[0] + d, c[1] - d], [c[0] - d * 0.8, c[1] - d * 1.2], [c[0] - d, c[1] + d]]],
      fill: { color: { slot: 2 }, opacity: 0.3, pattern: "hatch" },
      stroke: { color: { slot: 2 }, width: 2, opacity: 1, dash: "dashed" },
      label: { value: "Compound", dir: "ltr" },
    },
    {
      ...base("close-road", "b", "Road"),
      kind: "line",
      path: [
        [c[0] - d * 3, c[1] - d * 0.2],
        [c[0], c[1] + d * 0.1],
        [c[0] + d * 3, c[1] - d * 0.3],
      ],
      stroke: { color: { slot: 1 }, width: 5, opacity: 1, dash: "solid" },
    },
    {
      ...base("close-long", "c", "A line hundreds of kilometres long"),
      kind: "line",
      path: [
        [c[0] - 3, c[1] - d * 2],
        [c[0] + 3, c[1] - d * 2.4],
      ],
      stroke: { color: { slot: 4 }, width: 3, opacity: 1, dash: "dotted" },
    },
    { ...base("close-point", "d", "Gate"), kind: "point", at: [c[0] + d * 0.5, c[1] + d * 0.4], symbol: { icon: "checkpoint" }, color: { slot: 1 }, size: 26, label: { value: "Gate", dir: "ltr" } },
  ];
}

const FIXTURE_Z10: Viewport = { center: [57.3, 23.86], zoom: 10, bearing: 0, pitch: 0 };
const CATALOGUE_VIEW: Viewport = { center: [57.95, 23.75], zoom: 8.1, bearing: 0, pitch: 0 };

export const PARITY_SCENES: ParityScene[] = [
  { id: "fixture-light", width: 1000, height: 700, theme: "light", viewport: FIXTURE_VIEWPORT, features: fixtureFeatures, settings: () => fixtureSettings("ltr") },
  { id: "fixture-dark", width: 1000, height: 700, theme: "dark", viewport: FIXTURE_VIEWPORT, features: fixtureFeatures, settings: () => fixtureSettings("ltr") },
  { id: "fixture-rtl", width: 1000, height: 700, theme: "light", viewport: FIXTURE_VIEWPORT, features: fixtureFeatures, settings: () => fixtureSettings("rtl") },
  { id: "fixture-z10", width: 1000, height: 700, theme: "light", viewport: FIXTURE_Z10, features: fixtureFeatures, settings: () => fixtureSettings("ltr") },
  { id: "fixture-bearing", width: 900, height: 700, theme: "light", viewport: { ...FIXTURE_VIEWPORT, zoom: 8.5, bearing: 35 }, features: fixtureFeatures, settings: () => fixtureSettings("ltr") },
  { id: "fixture-pitch", width: 900, height: 700, theme: "light", viewport: { ...FIXTURE_VIEWPORT, zoom: 8.6, pitch: 50, bearing: -15 }, features: fixtureFeatures, settings: () => fixtureSettings("ltr") },
  {
    id: "fixture-obstacles",
    width: 1000,
    height: 700,
    theme: "light",
    viewport: { ...FIXTURE_VIEWPORT, zoom: 8.4 },
    features: fixtureFeatures,
    settings: () => fixtureSettings("ltr"),
    obstacles: [
      { minX: 0, minY: 0, maxX: 420, maxY: 150 },
      { minX: 760, minY: 520, maxX: 1000, maxY: 700 },
    ],
    priority: ["point-1"],
  },
  { id: "catalogue-light", width: 1200, height: 800, theme: "light", viewport: CATALOGUE_VIEW, features: catalogue, settings: () => fixtureSettings("ltr") },
  { id: "catalogue-dark", width: 1200, height: 800, theme: "dark", viewport: CATALOGUE_VIEW, features: catalogue, settings: () => fixtureSettings("ltr") },
  {
    id: "reader-narrow",
    width: 390,
    height: 640,
    theme: "light",
    viewport: { center: [57.35, 23.95], zoom: 8.6, bearing: 0, pitch: 0 },
    features: fixtureFeatures,
    settings: () => fixtureSettings("ltr"),
    narrow: true,
    obstacles: [{ minX: 0, minY: 560, maxX: 200, maxY: 640 }],
  },
  { id: "close-up", width: 800, height: 600, theme: "light", viewport: { center: [57.44, 23.85], zoom: 19.5, bearing: 0, pitch: 0 }, features: closeUp, settings: () => fixtureSettings("ltr") },
];
