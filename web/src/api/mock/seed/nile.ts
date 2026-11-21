/**
 * Dams on the Nile from the Ethiopian highlands to Aswan. An infrastructure
 * explainer: published once and untouched since.
 */
import type { LngLat, StylePreset } from "@/model/types";
import { en, makeSettings, MapBuilder, preset, slot, stroke } from "./build";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

const PRESETS: StylePreset[] = [
  preset("nl-blue", en("Blue Nile"), ["line"], { stroke: stroke(2, 3) }),
  preset("nl-white", en("White Nile"), ["line"], { stroke: stroke(6, 3) }),
  preset("nl-main", en("Main Nile"), ["line"], { stroke: stroke(2, 4.5) }),
  preset("nl-dam", en("Dam, numbered upstream to downstream"), ["point"], { iconColor: slot(1) }),
  preset("nl-city", en("City"), ["point"], { iconColor: slot(5) }),
];

const KHARTOUM: LngLat = [32.53, 15.6];

export function nile(clock: SeedClock): SeedMap {
  const b = new MapBuilder("nl", PRESETS, { by: PEOPLE.layla.name, at: clock.ago(9, 6, 0) });

  b.line({
    name: en("Blue Nile"),
    label: en("Blue Nile"),
    group: "nl-rivers",
    preset: "nl-blue",
    path: [[35.09, 11.22], [34.39, 11.8], [33.95, 12.7], [33.63, 13.55], [33.52, 14.4], [33.0, 15.1], KHARTOUM],
  });
  b.line({
    name: en("White Nile"),
    label: en("White Nile"),
    group: "nl-rivers",
    preset: "nl-white",
    path: [[32.7, 13.15], [32.5, 14.2], [32.48, 15.24], KHARTOUM],
  });
  b.line({
    name: en("Main Nile"),
    group: "nl-rivers",
    preset: "nl-main",
    path: [
      KHARTOUM,
      [33.4, 16.7],
      [33.98, 17.7],
      [33.32, 19.53],
      [32.05, 18.67],
      [30.48, 19.17],
      [30.6, 20.6],
      [31.35, 21.8],
      [32.6, 23.0],
      [32.88, 23.97],
    ],
  });
  const dams: [string, string, LngLat][] = [
    ["1", "Grand Ethiopian Renaissance Dam", [35.093, 11.215]],
    ["2", "Roseires Dam", [34.387, 11.798]],
    ["3", "Sennar Dam", [33.63, 13.55]],
    ["4", "Jebel Aulia Dam", [32.48, 15.24]],
    ["5", "Merowe Dam", [32.05, 18.669]],
    ["6", "Aswan High Dam", [32.878, 23.97]],
  ];
  for (const [number, name, at] of dams) {
    b.number({ name: en(name), label: en(name), group: "nl-dams", preset: "nl-dam", at, number });
  }
  const cities: [string, LngLat][] = [
    ["Khartoum", KHARTOUM],
    ["Wad Madani", [33.52, 14.4]],
    ["Atbara", [33.98, 17.7]],
    ["Dongola", [30.48, 19.17]],
    ["Aswan", [32.9, 24.09]],
  ];
  for (const [name, at] of cities) {
    b.icon({ name: en(name), group: "nl-cities", preset: "nl-city", at, icon: "pin", size: 16 });
  }
  b.note({
    name: en("Note: the confluence"),
    group: "nl-cities",
    anchor: KHARTOUM,
    textAt: [29.6, 16.3],
    text: en("The Blue and White Nile meet at Khartoum"),
  });

  const settings = makeSettings({
    center: [33.2, 17.4],
    zoom: 4.9,
    basemap: "fiord",
    labelLanguage: "en",
    presets: PRESETS,
    groups: [
      ["nl-dams", en("Dams")],
      ["nl-cities", en("Cities")],
      ["nl-rivers", en("Rivers")],
    ],
    legendTitle: en("Key"),
    titleBlock: {
      subtitle: en("Six dams between the Ethiopian highlands and Lake Nasser"),
      source: en("Sources: Nile Basin Initiative, national water ministries"),
      credit: en("Graphic: Al Mashriq"),
      note: en("River courses are simplified"),
      asOf: null,
    },
    embed: { static: false, cooperativeGestures: true, theme: "dark" },
  });

  return {
    id: "m_nile",
    slug: "nile-dams",
    title: en("Dams on the Nile, from the Renaissance Dam to Aswan"),
    uiDir: "ltr",
    createdBy: "layla",
    settings,
    draft: b.build(),
    rev: 15,
    updated: { at: clock.ago(9, 6, 0), by: "layla" },
    versions: [{ kind: "publish", step: 1, by: "layla", rev: 15, at: clock.ago(9, 6, 0) }],
    snapshot: (step) => b.build(step),
  };
}
