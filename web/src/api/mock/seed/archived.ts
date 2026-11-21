/**
 * Two finished maps that were archived: the Beirut port explosion of 4 August
 * 2020 and the stadiums of the 2022 World Cup in Qatar. Both stay published;
 * archiving only takes a map out of the working list.
 */
import type { LngLat, StylePreset } from "@/model/types";
import { ar, circle, en, fill, makeSettings, MapBuilder, preset, slot, stroke } from "./build";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

const BEIRUT_PRESETS: StylePreset[] = [
  preset("bt-heavy", en("Heavy structural damage"), ["area"], { fill: fill(1, 0.28), stroke: stroke(1, 1) }),
  preset("bt-moderate", en("Moderate damage"), ["area"], { fill: fill(3, 0.2), stroke: stroke(3, 1, "dashed") }),
  preset("bt-glass", en("Broken windows reported"), ["area"], { fill: fill(3, 0.08, "dots"), stroke: stroke(3, 1, "dotted") }),
  preset("bt-place", en("Neighbourhood"), ["point"], { iconColor: slot(5) }),
];

const WAREHOUSE: LngLat = [35.519, 33.9013];

export function beirut(clock: SeedClock): SeedMap {
  const b = new MapBuilder("bt", BEIRUT_PRESETS, { by: PEOPLE.daniel.name, at: clock.ago(41, 3, 0) });
  const blast = new Date(Date.UTC(2020, 7, 4, 15, 8)).toISOString();

  b.area({ name: en("Within 10 km"), group: "bt-damage", preset: "bt-glass", from: blast, ring: circle(WAREHOUSE, 10, 56) });
  b.area({ name: en("Within 3 km"), group: "bt-damage", preset: "bt-moderate", from: blast, ring: circle(WAREHOUSE, 3, 48) });
  b.area({ name: en("Within 1 km"), group: "bt-damage", preset: "bt-heavy", from: blast, ring: circle(WAREHOUSE, 1, 40) });
  b.icon({ name: en("Warehouse 12, Port of Beirut"), label: en("Warehouse 12"), group: "bt-damage", from: blast, at: WAREHOUSE, icon: "explosion", color: 1, size: 28 });
  const places: [string, LngLat][] = [
    ["Karantina", [35.532, 33.901]],
    ["Mar Mikhael", [35.527, 33.898]],
    ["Gemmayzeh", [35.516, 33.895]],
    ["Achrafieh", [35.52, 33.888]],
    ["Downtown", [35.505, 33.896]],
    ["Bourj Hammoud", [35.54, 33.893]],
  ];
  for (const [name, at] of places) {
    b.icon({ name: en(name), label: en(name), group: "bt-places", preset: "bt-place", at, icon: "pin", size: 14 });
  }
  b.icon({ name: en("Beirut–Rafic Hariri International Airport"), group: "bt-places", at: [35.488, 33.821], icon: "airport", color: 2 });
  b.note({
    name: en("Note: the explosion"),
    group: "bt-places",
    from: blast,
    since: 2,
    anchor: WAREHOUSE,
    textAt: [35.47, 33.925],
    text: en("18:08 on 4 August 2020: 2,750 tonnes of ammonium nitrate detonate in the port"),
  });

  return {
    id: "m_beirut",
    slug: "beirut-port-explosion",
    title: en("Beirut port explosion: how far the damage reached"),
    uiDir: "ltr",
    createdBy: "daniel",
    archived: true,
    settings: makeSettings({
      center: [35.515, 33.893],
      zoom: 12.2,
      basemap: "positron",
      labelLanguage: "en",
      presets: BEIRUT_PRESETS,
      groups: [
        ["bt-places", en("Places")],
        ["bt-damage", en("Damage rings")],
      ],
      legendTitle: en("Key"),
      titleBlock: {
        subtitle: en("Distance from Warehouse 12 and the damage reported at each range"),
        source: en("Sources: Lebanese Red Cross, UN-Habitat rapid assessment"),
        credit: en("Graphic: Al Mashriq"),
        note: en("Rings show distance, not a damage survey"),
        asOf: new Date(Date.UTC(2020, 7, 7, 12)).toISOString(),
      },
      embed: { static: true },
    }),
    draft: b.build(),
    rev: 21,
    updated: { at: clock.ago(41, 3, 0), by: "daniel" },
    versions: [
      { kind: "publish", step: 1, by: "daniel", rev: 16, at: clock.ago(44, 5, 0) },
      { kind: "publish", step: 2, by: "layla", rev: 21, at: clock.ago(41, 3, 0) },
    ],
    snapshot: (step) => b.build(step),
  };
}

const STADIUM_PRESETS: StylePreset[] = [
  preset("qs-stadium", ar("ملعب، مرقّم بحسب السعة"), ["point"], { iconColor: slot(5) }),
  preset("qs-metro", ar("خط المترو الأحمر"), ["line"], { stroke: stroke(1, 3) }),
  preset("qs-hub", ar("مطار"), ["point"], { iconColor: slot(2) }),
];

export function stadiums(clock: SeedClock): SeedMap {
  const b = new MapBuilder("qs", STADIUM_PRESETS, { by: PEOPLE.youssef.name, at: clock.ago(96, 4, 0) });

  b.line({
    name: ar("الخط الأحمر: لوسيل – الوكرة"),
    group: "qs-transport",
    preset: "qs-metro",
    path: [
      [51.49, 25.42],
      [51.515, 25.36],
      [51.53, 25.3],
      [51.545, 25.265],
      [51.57, 25.2],
      [51.598, 25.165],
    ],
  });
  const grounds: [string, string, LngLat][] = [
    ["1", "استاد لوسيل (88,966 متفرجًا)", [51.49, 25.421]],
    ["2", "استاد البيت، الخور (68,895)", [51.488, 25.652]],
    ["3", "استاد خليفة الدولي (45,857)", [51.448, 25.264]],
    ["4", "استاد أحمد بن علي، الريان (45,032)", [51.342, 25.33]],
    ["5", "استاد المدينة التعليمية (44,667)", [51.424, 25.311]],
    ["6", "استاد الثمامة (44,400)", [51.532, 25.235]],
    ["7", "استاد الجنوب، الوكرة (44,325)", [51.574, 25.16]],
    ["8", "استاد 974 (44,089)", [51.567, 25.289]],
  ];
  for (const [number, name, at] of grounds) {
    b.number({ name: ar(name), group: "qs-stadiums", preset: "qs-stadium", at, number });
  }
  b.icon({ name: ar("مطار حمد الدولي"), label: ar("مطار حمد الدولي"), group: "qs-transport", preset: "qs-hub", at: [51.608, 25.273], icon: "airport" });
  b.note({
    name: ar("ملاحظة: المسافات"),
    group: "qs-stadiums",
    anchor: [51.488, 25.652],
    textAt: [51.2, 25.6],
    text: ar("أبعد ملعبين عن بعضهما: البيت والجنوب، نحو 55 كم"),
  });

  return {
    id: "m_stadiums",
    slug: "qatar-2022-stadiums",
    title: ar("كأس العالم 2022: الملاعب الثمانية في قطر"),
    uiDir: "rtl",
    createdBy: "youssef",
    archived: true,
    settings: makeSettings({
      center: [51.47, 25.38],
      zoom: 9.6,
      basemap: "bright",
      labelLanguage: "ar",
      presets: STADIUM_PRESETS,
      groups: [
        ["qs-stadiums", ar("الملاعب")],
        ["qs-transport", ar("النقل")],
      ],
      legendTitle: ar("مفتاح الخريطة"),
      titleBlock: {
        subtitle: ar("ثمانية ملاعب ضمن دائرة نصف قطرها نحو 30 كم حول الدوحة"),
        source: ar("المصدر: الاتحاد الدولي لكرة القدم"),
        credit: ar("إعداد: قسم الغرافيك، المشرق"),
        note: null,
        asOf: null,
      },
    }),
    draft: b.build(),
    rev: 12,
    updated: { at: clock.ago(96, 4, 0), by: "youssef" },
    versions: [{ kind: "publish", step: 1, by: "omar", rev: 12, at: clock.ago(96, 4, 0) }],
    snapshot: (step) => b.build(step),
  };
}
