/**
 * The Ever Given grounding in the Suez Canal, 23–29 March 2021. Carries the
 * workspace's longest title, and a draft that has moved on since it went live.
 */
import type { LngLat, StylePreset } from "@/model/types";
import { circle, en, fill, makeSettings, MapBuilder, preset, slot, stroke } from "./build";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

const PRESETS: StylePreset[] = [
  preset("sz-canal", en("Suez Canal"), ["line"], { stroke: stroke(2, 3) }),
  preset("sz-queue", en("Ships waiting at anchor"), ["area"], { fill: fill(3, 0.3, "dots"), stroke: stroke(3, 1.5, "dashed") }),
  preset("sz-cape", en("Diversion around the Cape of Good Hope"), ["arrow"], { stroke: stroke(1, 3, "dashed") }),
  preset("sz-normal", en("Usual route through the canal"), ["arrow"], { stroke: stroke(4, 3) }),
  preset("sz-port", en("Port"), ["point"], { iconColor: slot(2) }),
];

const utc = (day: number, hour: number, minute = 0): string => new Date(Date.UTC(2021, 2, day, hour, minute)).toISOString();

const CANAL: LngLat[] = [
  [32.31, 31.25],
  [32.31, 30.85],
  [32.3, 30.6],
  [32.34, 30.45],
  [32.4, 30.33],
  [32.52, 30.22],
  [32.58, 30.05],
  [32.57, 29.95],
];

export function suez(clock: SeedClock): SeedMap {
  const b = new MapBuilder("sz", PRESETS, { by: PEOPLE.layla.name, at: clock.ago(3, 5, 0) });

  const queues: [string, LngLat, number][] = [
    ["Anchorage off Port Said", [32.4, 31.47], 16],
    ["Great Bitter Lake", [32.38, 30.33], 7],
    ["Anchorage in the Gulf of Suez", [32.6, 29.74], 14],
  ];
  for (const [name, at, km] of queues) {
    b.area({ name: en(name), group: "sz-canal", preset: "sz-queue", from: utc(23, 8), to: utc(31, 0), ring: circle(at, km, 28) });
  }
  b.line({ name: en("Suez Canal, 193 km"), group: "sz-canal", preset: "sz-canal", path: CANAL, locked: true });
  b.arrow({
    name: en("Asia to Europe through the canal"),
    group: "sz-routes",
    preset: "sz-normal",
    control: [
      [60, 14],
      [50.5, 12.5],
      [43.3, 12.6],
      [38, 20],
      [34.8, 26.5],
      [33.2, 28.5],
      [32.56, 29.9],
      [32.33, 30.6],
      [32.31, 31.3],
      [28, 33.5],
      [19, 35],
      [11.5, 37.7],
      [3, 37.6],
      [-6, 36],
      [-10, 37.5],
      [-10.5, 43.5],
      [-6, 48.6],
      [1, 50.4],
      [3.5, 51.8],
    ],
    curvature: 0.8,
  });
  b.arrow({
    name: en("Diversion around the Cape, about nine days longer"),
    group: "sz-routes",
    preset: "sz-cape",
    from: utc(25, 0),
    since: 2,
    control: [
      [60, 13],
      [52, -4],
      [42, -22],
      [28, -36],
      [16, -36],
      [4, -15],
      [-17, 8],
      [-19, 24],
      [-12, 42],
      [-6.5, 48.4],
      [1, 50.3],
      [3.4, 51.7],
    ],
    curvature: 0.8,
  });
  b.icon({
    name: en("Ever Given aground at kilometre 151"),
    label: en("Ever Given"),
    group: "sz-canal",
    from: utc(23, 5, 40),
    to: utc(29, 13, 5),
    at: [32.5802, 30.0176],
    icon: "pin",
    color: 1,
    size: 28,
  });
  const ports: [string, LngLat][] = [
    ["Port Said", [32.302, 31.265]],
    ["Ismailia", [32.272, 30.596]],
    ["Suez (Port Tawfik)", [32.56, 29.935]],
    ["Rotterdam, the ship's destination", [4.05, 51.95]],
  ];
  for (const [name, at] of ports) {
    b.icon({ name: en(name), group: "sz-routes", preset: "sz-port", at, icon: "port" });
  }
  b.note({
    name: en("Note: the grounding"),
    group: "sz-notes",
    from: utc(23, 5, 40),
    anchor: [32.5802, 30.0176],
    textAt: [33.3, 30.35],
    text: en("23 March, 07:40: the 400-metre container ship wedges across the single-lane southern section"),
  });
  b.note({
    name: en("Note: refloated"),
    group: "sz-notes",
    from: utc(29, 13, 5),
    since: 2,
    anchor: [32.38, 30.33],
    textAt: [31.4, 30.15],
    text: en("29 March, 15:05: refloated and towed to the Great Bitter Lake for inspection"),
    leader: "elbow",
  });
  b.note({
    name: en("Note: the queue"),
    group: "sz-notes",
    from: utc(29, 0),
    since: 3,
    anchor: [32.6, 29.74],
    textAt: [33.4, 29.3],
    text: en("More than 400 ships were waiting at both ends and in the lakes when traffic resumed"),
    by: PEOPLE.sarah.name,
    when: clock.ago(3, 5, 0),
  });

  const settings = makeSettings({
    center: [32.45, 30.55],
    zoom: 7.4,
    basemap: "liberty",
    labelLanguage: "en",
    presets: PRESETS,
    groups: [
      ["sz-notes", en("Notes")],
      ["sz-routes", en("Routes and ports")],
      ["sz-canal", en("The canal")],
    ],
    legendTitle: en("Key"),
    titleBlock: {
      subtitle: en("Six days that held up about 12% of world trade"),
      source: en("Sources: Suez Canal Authority, Lloyd's List"),
      credit: en("Graphic: Al Mashriq"),
      note: null,
      asOf: utc(29, 16),
    },
    timeline: { enabled: true, mode: "cumulative", speed: 14_400, windowMs: 86_400_000 },
    embed: { zoomButtons: true, scaleBar: false },
  });

  return {
    id: "m_suez",
    slug: "suez-canal-ever-given",
    title: en(
      "Suez Canal blockage, March 2021: where the Ever Given ran aground, the queue of ships waiting at both ends, and the long way round the Cape of Good Hope",
    ),
    uiDir: "ltr",
    createdBy: "layla",
    settings,
    draft: b.build(),
    rev: 26,
    updated: { at: clock.ago(3, 5, 0), by: "sarah" },
    versions: [
      { kind: "publish", step: 1, by: "layla", rev: 11, at: clock.ago(8, 4, 0) },
      { kind: "publish", step: 2, by: "layla", rev: 19, at: clock.ago(7, 2, 20) },
    ],
    snapshot: (step) => b.build(step),
  };
}
