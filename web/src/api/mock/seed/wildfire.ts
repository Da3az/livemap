/**
 * The north Evia wildfire, Greece, 3–11 August 2021. The burned area is drawn
 * as six successive perimeters that share one `lineageId`, each valid until
 * the next replaces it, so the timeline plays the fire's spread.
 *
 * Perimeters are schematic: drawn from the reported sequence of villages
 * reached, not from satellite mapping.
 */
import type { LngLat, StylePreset } from "@/model/types";
import { en, fill, makeSettings, MapBuilder, preset, slot, stroke } from "./build";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

const PRESETS: StylePreset[] = [
  preset("wf-burned", en("Burned area"), ["area"], { fill: fill(1, 0.3), stroke: stroke(1, 1.5) }),
  preset("wf-front", en("Active fire front"), ["frontline"], { stroke: stroke(1, 3) }),
  preset("wf-village", en("Village reached by the fire"), ["point"], { iconColor: slot(1) }),
  preset("wf-evac", en("Evacuation by sea"), ["arrow"], { stroke: stroke(2, 3, "dashed") }),
  preset("wf-port", en("Evacuation point"), ["point"], { iconColor: slot(2) }),
  preset("wf-shelter", en("Reception centre"), ["point"], { iconColor: slot(4) }),
  preset("wf-road", en("Road closed"), ["line"], { stroke: stroke(3, 3, "dotted") }),
];

/** Athens is UTC+3 in August; `hour` is local. */
const local = (day: number, hour: number): string => new Date(Date.UTC(2021, 7, day, hour - 3)).toISOString();

const PERIMETERS: { day: number; label: string; ring: LngLat[]; since: number }[] = [
  {
    day: 3,
    label: "3 August",
    since: 1,
    ring: [
      [23.3, 38.79],
      [23.34, 38.8],
      [23.37, 38.83],
      [23.34, 38.86],
      [23.29, 38.85],
      [23.27, 38.82],
    ],
  },
  {
    day: 4,
    label: "4 August",
    since: 1,
    ring: [
      [23.31, 38.785],
      [23.36, 38.79],
      [23.41, 38.83],
      [23.4, 38.88],
      [23.33, 38.9],
      [23.26, 38.88],
      [23.235, 38.83],
      [23.27, 38.805],
    ],
  },
  {
    day: 5,
    label: "5 August",
    since: 2,
    ring: [
      [23.31, 38.785],
      [23.37, 38.79],
      [23.425, 38.82],
      [23.435, 38.87],
      [23.42, 38.91],
      [23.34, 38.93],
      [23.25, 38.91],
      [23.2, 38.86],
      [23.225, 38.825],
      [23.27, 38.805],
    ],
  },
  {
    day: 7,
    label: "7 August",
    since: 3,
    ring: [
      [23.31, 38.785],
      [23.37, 38.79],
      [23.43, 38.82],
      [23.435, 38.87],
      [23.42, 38.93],
      [23.39, 38.975],
      [23.33, 39.015],
      [23.25, 38.99],
      [23.18, 38.93],
      [23.17, 38.87],
      [23.215, 38.83],
      [23.27, 38.805],
    ],
  },
  {
    day: 9,
    label: "9 August",
    since: 4,
    ring: [
      [23.31, 38.785],
      [23.37, 38.79],
      [23.43, 38.82],
      [23.435, 38.87],
      [23.42, 38.93],
      [23.385, 38.98],
      [23.34, 39.02],
      [23.26, 39.015],
      [23.2, 38.995],
      [23.17, 38.98],
      [23.12, 38.94],
      [23.11, 38.89],
      [23.15, 38.86],
      [23.215, 38.83],
      [23.27, 38.805],
    ],
  },
  {
    day: 11,
    label: "11 August",
    since: 5,
    ring: [
      [23.31, 38.785],
      [23.37, 38.787],
      [23.44, 38.815],
      [23.44, 38.87],
      [23.42, 38.93],
      [23.385, 38.98],
      [23.34, 39.022],
      [23.26, 39.017],
      [23.2, 38.997],
      [23.16, 38.985],
      [23.1, 38.945],
      [23.09, 38.89],
      [23.14, 38.86],
      [23.215, 38.83],
      [23.27, 38.805],
    ],
  },
];

const FRONTS: { day: number; path: LngLat[]; facing: "left" | "right"; since: number }[] = [
  { day: 4, since: 1, facing: "left", path: [[23.41, 38.83], [23.4, 38.88], [23.33, 38.9], [23.26, 38.88]] },
  { day: 5, since: 2, facing: "left", path: [[23.435, 38.87], [23.42, 38.91], [23.34, 38.93], [23.25, 38.91], [23.2, 38.86]] },
  { day: 7, since: 3, facing: "left", path: [[23.42, 38.93], [23.39, 38.975], [23.33, 39.015], [23.25, 38.99], [23.18, 38.93]] },
  { day: 9, since: 4, facing: "left", path: [[23.2, 38.995], [23.17, 38.98], [23.12, 38.94], [23.11, 38.89], [23.15, 38.86]] },
];

const VILLAGES: [string, LngLat, number, number][] = [
  ["Limni", [23.317, 38.767], 3, 1],
  ["Rovies", [23.229, 38.81], 4, 1],
  ["Kechries", [23.36, 38.835], 4, 1],
  ["Kourkouloi", [23.355, 38.85], 5, 2],
  ["Agia Anna", [23.401, 38.868], 5, 2],
  ["Strofylia", [23.42, 38.82], 5, 2],
  ["Vasilika", [23.36, 38.98], 7, 3],
  ["Ellinika", [23.33, 39.01], 7, 3],
  ["Gouves", [23.25, 39.005], 8, 4],
  ["Pefki", [23.213, 38.995], 8, 4],
  ["Asminio", [23.17, 38.97], 9, 4],
  ["Kamatriades", [23.14, 38.92], 9, 4],
];

export function wildfire(clock: SeedClock): SeedMap {
  const b = new MapBuilder("wf", PRESETS, { by: PEOPLE.sarah.name, at: clock.ago(2, 1, 30) });

  PERIMETERS.forEach((perimeter, i) => {
    const next = PERIMETERS[i + 1];
    b.area({
      name: en(`Burned area by the evening of ${perimeter.label}`),
      ...(next ? {} : { label: en("About 51,000 hectares burned") }),
      group: "wf-perimeter",
      preset: "wf-burned",
      lineage: "wf-perimeter",
      from: local(perimeter.day, 20),
      ...(next ? { to: local(next.day, 20) } : {}),
      since: perimeter.since,
      ring: perimeter.ring,
    });
  });

  const roads: [string, LngLat[], number][] = [
    ["Limni–Rovies coast road", [[23.317, 38.769], [23.27, 38.795], [23.232, 38.812]], 1],
    ["Strofylia–Agia Anna road", [[23.42, 38.82], [23.415, 38.845], [23.401, 38.866]], 2],
    ["Istiaia–Vasilika road", [[23.15, 38.953], [23.25, 38.98], [23.36, 38.98]], 3],
  ];
  for (const [name, path, since] of roads) {
    b.line({ name: en(name), group: "wf-response", preset: "wf-road", from: local(4, 9), to: local(12, 9), since, path });
  }

  FRONTS.forEach((front, i) => {
    const next = FRONTS[i + 1];
    b.frontline({
      name: en(`Fire front, ${front.day} August`),
      group: "wf-perimeter",
      preset: "wf-front",
      lineage: "wf-front",
      from: local(front.day, 20),
      to: next ? local(next.day, 20) : local(11, 20),
      since: front.since,
      facing: front.facing,
      toothShape: "semicircle",
      path: front.path,
    });
  });

  const evacuations: [string, LngLat[], number, number][] = [
    ["Rovies beach to Loutra Aidipsou by ferry", [[23.225, 38.808], [23.14, 38.82], [23.055, 38.85]], 4, 1],
    ["Limni to Chalkida by coastguard boat", [[23.32, 38.762], [23.42, 38.66], [23.58, 38.5]], 4, 1],
    ["From Pefki by ferry and coastguard boat", [[23.211, 39.006], [23.19, 39.03], [23.15, 39.045]], 8, 4],
  ];
  for (const [name, control, day, since] of evacuations) {
    b.arrow({ name: en(name), group: "wf-response", preset: "wf-evac", from: local(day, 18), to: local(day + 1, 12), since, control });
  }
  b.arrow({
    name: en("Wind direction on 5 August"),
    label: en("Wind"),
    group: "wf-response",
    from: local(5, 6),
    to: local(6, 6),
    since: 2,
    control: [
      [23.52, 38.74],
      [23.47, 38.79],
    ],
    curvature: 0,
    tapered: true,
    stroke: stroke(6, 5, "solid", 0.8),
  });

  b.icon({
    name: en("Where the fire started, 3 August"),
    label: en("Start"),
    group: "wf-perimeter",
    from: local(3, 17),
    at: [23.32, 38.8],
    icon: "fire",
    color: 3,
    size: 28,
  });
  for (const [name, at, day, since] of VILLAGES) {
    b.icon({ name: en(name), group: "wf-villages", preset: "wf-village", from: local(day, 18), since, at, icon: "fire" });
  }
  const ports: [string, LngLat, number][] = [
    ["Limni harbour", [23.319, 38.764], 1],
    ["Rovies beach", [23.226, 38.807], 1],
    ["Pefki harbour", [23.211, 39.003], 4],
  ];
  for (const [name, at, since] of ports) {
    b.icon({ name: en(name), group: "wf-response", preset: "wf-port", since, at, icon: "port" });
  }
  const shelters: [string, LngLat, number][] = [
    ["Reception centre, Istiaia", [23.15, 38.953], 2],
    ["Reception centre, Loutra Aidipsou", [23.046, 38.855], 1],
    ["Reception centre, Mantoudi", [23.479, 38.797], 2],
  ];
  for (const [name, at, since] of shelters) {
    b.icon({ name: en(name), group: "wf-response", preset: "wf-shelter", since, at, icon: "shelter" });
  }

  b.note({
    name: en("Note: Limni evacuation"),
    group: "wf-notes",
    from: local(4, 18),
    anchor: [23.319, 38.764],
    textAt: [23.56, 38.68],
    text: en("4 August: residents and visitors taken off the beaches at Limni and Rovies by boat"),
  });
  b.note({
    name: en("Note: Pefki evacuation"),
    group: "wf-notes",
    since: 4,
    from: local(8, 18),
    anchor: [23.211, 39.003],
    textAt: [23.42, 39.08],
    text: en("8 August: ferries carried residents and visitors from Pefki as the fire reached the village"),
    leader: "elbow",
  });
  b.note({
    name: en("Note: Istiaia"),
    group: "wf-notes",
    since: 4,
    from: local(9, 12),
    anchor: [23.15, 38.953],
    textAt: [22.93, 39.0],
    text: en("Istiaia, the largest town in the north, was not reached"),
  });

  const settings = makeSettings({
    center: [23.3, 38.89],
    zoom: 10.2,
    basemap: "bright",
    labelLanguage: "en",
    presets: PRESETS,
    groups: [
      ["wf-notes", en("Notes")],
      ["wf-villages", en("Villages reached")],
      ["wf-response", en("Evacuation and response")],
      ["wf-perimeter", en("Fire perimeter by day")],
    ],
    legendTitle: en("Key"),
    titleBlock: {
      subtitle: en("How the fire that began near Limni on 3 August 2021 crossed the island in eight days"),
      source: en("Sources: Hellenic Fire Service, Copernicus EMS, local authorities"),
      credit: en("Graphic: Al Mashriq"),
      note: en("Perimeters are schematic and locations approximate"),
      asOf: local(11, 20),
    },
    timeline: { enabled: true, mode: "moving", speed: 21_600, windowMs: 86_400_000 },
    embed: { cooperativeGestures: true, scaleBar: true },
  });

  return {
    id: "m_wildfire",
    slug: "evia-wildfire-perimeter",
    title: en("North Evia wildfire: the perimeter day by day"),
    uiDir: "ltr",
    createdBy: "sarah",
    settings,
    draft: b.build(),
    rev: 47,
    updated: { at: clock.ago(0, 5, 48), by: "sarah" },
    versions: [
      { kind: "publish", step: 1, by: "sarah", rev: 9, at: clock.ago(6, 3, 0) },
      { kind: "publish", step: 2, by: "sarah", rev: 17, at: clock.ago(5, 4, 10) },
      { kind: "publish", step: 3, by: "daniel", rev: 26, at: clock.ago(4, 2, 0) },
      { kind: "publish", step: 4, by: "sarah", rev: 38, at: clock.ago(2, 1, 30) },
    ],
    snapshot: (step) => b.build(step),
  };
}
