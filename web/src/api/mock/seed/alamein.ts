/**
 * The Second Battle of El Alamein, 23 October – 4 November 1942. A historical
 * map built the way the conflict-tracker template is meant to be used: two
 * control areas, a contested belt, a claimed advance in hatch, and a front
 * line drawn as successive states sharing one `lineageId`.
 */
import type { LngLat, StylePreset } from "@/model/types";
import { corridor, en, fill, makeSettings, MapBuilder, preset, slot, stroke } from "./build";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

const PRESETS: StylePreset[] = [
  preset("al-a", en("Side A control: Eighth Army"), ["area"], { fill: fill(2, 0.24), stroke: stroke(2, 1) }),
  preset("al-b", en("Side B control: Panzer Army Africa"), ["area"], { fill: fill(1, 0.24), stroke: stroke(1, 1) }),
  preset("al-contested", en("Contested: the minefield belt"), ["area"], { fill: fill(3, 0.3, "cross"), stroke: stroke(3, 1, "dashed") }),
  preset("al-claimed", en("Claimed advance"), ["area"], { fill: fill(2, 0.2, "hatch"), stroke: stroke(2, 1, "dashed") }),
  preset("al-front", en("Front line"), ["frontline"], { stroke: stroke(1, 2.5) }),
  preset("al-attack", en("Attack"), ["arrow"], { stroke: stroke(2, 4) }),
  preset("al-retreat", en("Withdrawal"), ["arrow"], { stroke: stroke(1, 3, "dashed") }),
  preset("al-place", en("Named position"), ["point"], { iconColor: slot(5) }),
];

/** Egypt kept UTC+2 through the battle; `hour` is local. */
const local = (month: 10 | 11, day: number, hour: number): string => new Date(Date.UTC(1942, month - 1, day, hour - 2)).toISOString();

const FRONT_23_OCT: LngLat[] = [
  [28.86, 30.9],
  [28.88, 30.8],
  [28.87, 30.7],
  [28.83, 30.6],
  [28.78, 30.5],
  [28.72, 30.42],
];
const FRONT_2_NOV: LngLat[] = [
  [28.79, 30.94],
  [28.76, 30.85],
  [28.81, 30.75],
  [28.83, 30.6],
  [28.78, 30.5],
  [28.72, 30.42],
];
const FRONT_4_NOV: LngLat[] = [
  [28.66, 30.99],
  [28.62, 30.86],
  [28.68, 30.72],
  [28.72, 30.58],
  [28.7, 30.48],
  [28.66, 30.4],
];

export function alamein(clock: SeedClock): SeedMap {
  const b = new MapBuilder("al", PRESETS, { by: PEOPLE.sarah.name, at: clock.ago(12, 2, 0) });

  b.area({
    name: en("Held by the Eighth Army on 23 October"),
    group: "al-control",
    preset: "al-a",
    from: local(10, 23, 0),
    ring: [[28.86, 30.9], [28.95, 30.855], [29.05, 30.825], [29.2, 30.82], [29.45, 30.9], [29.45, 30.5], [29.1, 30.38], ...[...FRONT_23_OCT].reverse().slice(0, 5)],
  });
  b.area({
    name: en("Held by Panzer Army Africa on 23 October"),
    group: "al-control",
    preset: "al-b",
    from: local(10, 23, 0),
    to: local(11, 4, 18),
    ring: [[28.86, 30.9], [28.73, 30.97], [28.45, 31.03], [28.2, 31.06], [28.2, 30.55], [28.45, 30.4], ...[...FRONT_23_OCT].reverse().slice(0, 5)],
  });
  b.area({
    name: en("Minefield belt, up to 8 km deep"),
    group: "al-control",
    preset: "al-contested",
    from: local(10, 23, 0),
    to: local(11, 2, 1),
    ring: corridor(FRONT_23_OCT, 3.5),
  });
  b.area({
    name: en("Ground gained by 2 November"),
    group: "al-control",
    preset: "al-claimed",
    from: local(11, 2, 1),
    to: local(11, 4, 18),
    ring: [[28.86, 30.9], [28.79, 30.94], [28.76, 30.85], [28.81, 30.75], [28.87, 30.7], [28.88, 30.8]],
  });

  const fronts: [string, LngLat[], string, string | undefined][] = [
    ["Front line, 23 October", FRONT_23_OCT, local(10, 23, 0), local(11, 2, 1)],
    ["Front line, 2 November", FRONT_2_NOV, local(11, 2, 1), local(11, 4, 18)],
    ["Front line, 4 November", FRONT_4_NOV, local(11, 4, 18), undefined],
  ];
  for (const [name, path, from, to] of fronts) {
    b.frontline({ name: en(name), group: "al-front", preset: "al-front", lineage: "al-front", from, ...(to ? { to } : {}), facing: "right", path });
  }

  const moves: [string, string, LngLat[], string][] = [
    ["Operation Lightfoot: XXX Corps, night of 23 October", "al-attack", [[28.95, 30.82], [28.89, 30.83], [28.82, 30.83]], local(10, 23, 21)],
    ["XIII Corps feint in the south", "al-attack", [[28.88, 30.5], [28.82, 30.48], [28.76, 30.47]], local(10, 23, 21)],
    ["Operation Supercharge, 2 November", "al-attack", [[28.82, 30.9], [28.76, 30.89], [28.69, 30.87]], local(11, 2, 1)],
    ["Axis withdrawal toward Fuka, 4 November", "al-retreat", [[28.6, 30.93], [28.4, 31.0], [28.15, 31.04]], local(11, 4, 18)],
  ];
  for (const [name, presetId, control, from] of moves) {
    b.arrow({ name: en(name), group: "al-front", preset: presetId, from, control, tapered: presetId === "al-attack" });
  }

  const places: [string, LngLat][] = [
    ["El Alamein station", [28.955, 30.83]],
    ["Tel el Eisa", [28.87, 30.88]],
    ["Kidney Ridge", [28.8, 30.84]],
    ["Miteiriya Ridge", [28.85, 30.77]],
    ["Ruweisat Ridge", [28.98, 30.72]],
    ["Alam el Halfa", [29.17, 30.67]],
    ["Qaret el Himeimat", [28.72, 30.43]],
    ["Tel el Aqqaqir", [28.68, 30.87]],
    ["Sidi Abd el Rahman", [28.73, 30.97]],
    ["El Daba", [28.45, 31.03]],
  ];
  for (const [name, at] of places) {
    b.icon({ name: en(name), label: en(name), group: "al-places", preset: "al-place", at, icon: "pin", size: 14 });
  }
  b.note({
    name: en("Note: the depression"),
    group: "al-places",
    anchor: [28.6, 30.36],
    textAt: [28.6, 30.36],
    text: en("Qattara Depression: impassable to vehicles, so neither flank could be turned"),
    leader: null,
  });

  const settings = makeSettings({
    center: [28.8, 30.72],
    zoom: 9.3,
    basemap: "positron",
    labelLanguage: "en",
    presets: PRESETS,
    groups: [
      ["al-places", en("Places")],
      ["al-front", en("Front line and movements")],
      ["al-control", en("Control")],
    ],
    legendTitle: en("Key"),
    titleBlock: {
      subtitle: en("Thirteen days on a 60 km front between the sea and the Qattara Depression"),
      source: en("Source: British official history, The Mediterranean and Middle East, vol. IV"),
      credit: en("Graphic: Al Mashriq"),
      note: en("Historical map. Lines and positions are approximate."),
      asOf: local(11, 4, 18),
    },
    timeline: { enabled: true, mode: "moving", speed: 43_200, windowMs: 172_800_000 },
  });

  const draft = b.build();
  return {
    id: "m_alamein",
    slug: "second-battle-of-el-alamein",
    title: en("Historical: the Second Battle of El Alamein, 23 October – 4 November 1942"),
    uiDir: "ltr",
    createdBy: "sarah",
    settings,
    draft,
    rev: 34,
    updated: { at: clock.ago(12, 2, 0), by: "sarah" },
    versions: [],
    snapshot: () => draft,
  };
}
