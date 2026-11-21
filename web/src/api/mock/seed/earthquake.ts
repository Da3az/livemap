/**
 * The Kahramanmaraş earthquakes of 6 February 2023 and the aid operation that
 * followed, in Türkiye and north-west Syria. Epicentres are the USGS
 * locations; province outlines are simplified to a dozen points each.
 */
import type { IconId, LngLat, StylePreset } from "@/model/types";
import { corridor, en, fill, makeSettings, MapBuilder, preset, slot, stroke } from "./build";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

const PRESETS: StylePreset[] = [
  preset("eq-severe", en("Violent shaking (intensity IX and above)"), ["area"], {
    fill: fill(1, 0.26),
    stroke: stroke(1, 1),
  }),
  preset("eq-strong", en("Severe shaking (intensity VIII)"), ["area"], {
    fill: fill(3, 0.2),
    stroke: stroke(3, 1, "dashed"),
  }),
  preset("eq-province", en("Province under state of emergency"), ["area"], {
    fill: fill(5, 0.06, "hatch"),
    stroke: stroke(5, 1.5),
  }),
  preset("eq-nws", en("North-west Syria, worst-affected districts"), ["area"], {
    fill: fill(7, 0.14, "dots"),
    stroke: stroke(7, 1.5, "dashed"),
  }),
  preset("eq-fault", en("Surface rupture"), ["line"], { stroke: stroke(1, 3) }),
  preset("eq-epicentre", en("Epicentre, with magnitude"), ["point"], { iconColor: slot(1) }),
  preset("eq-route", en("Aid route"), ["arrow"], { stroke: stroke(4, 3.5) }),
  preset("eq-airport", en("Airport receiving aid flights"), ["point"], { iconColor: slot(2) }),
  preset("eq-crossing", en("Border crossing open to aid"), ["point"], { iconColor: slot(4) }),
  preset("eq-camp", en("Tent city or camp"), ["point"], { iconColor: slot(8) }),
  preset("eq-hospital", en("Field hospital"), ["point"], { iconColor: slot(6) }),
  preset("eq-closed", en("Closed or damaged"), ["point", "line"], { iconColor: slot(1), stroke: stroke(1, 3, "dotted") }),
];

const utc = (day: number, hour: number, minute = 0): string => new Date(Date.UTC(2023, 1, day, hour, minute)).toISOString();

/** The East Anatolian Fault from Antakya to Pütürge, and the Çardak fault. */
const MAIN_RUPTURE: LngLat[] = [
  [36.2, 36.15],
  [36.4, 36.6],
  [36.6, 37.05],
  [36.85, 37.25],
  [37.3, 37.5],
  [37.65, 37.78],
  [38.24, 38.03],
  [38.87, 38.2],
];
const SECOND_RUPTURE: LngLat[] = [
  [36.6, 38.0],
  [37.2, 38.02],
  [37.8, 38.1],
  [38.2, 38.3],
];

const PROVINCES: [string, LngLat[]][] = [
  [
    "Hatay",
    [
      [36.05, 36.92],
      [36.2, 36.98],
      [36.45, 36.98],
      [36.58, 36.83],
      [36.6, 36.55],
      [36.68, 36.3],
      [36.55, 36.2],
      [36.38, 36.05],
      [36.22, 35.95],
      [36.15, 35.82],
      [35.92, 35.92],
      [35.92, 36.08],
      [35.78, 36.32],
      [35.89, 36.41],
      [36.17, 36.59],
      [36.2, 36.75],
    ],
  ],
  [
    "Kahramanmaraş",
    [
      [36.25, 37.55],
      [36.35, 38.05],
      [36.75, 38.6],
      [37.3, 38.55],
      [37.7, 38.25],
      [37.45, 37.85],
      [37.65, 37.45],
      [37.3, 37.25],
      [36.95, 37.2],
      [36.6, 37.3],
    ],
  ],
  [
    "Gaziantep",
    [
      [36.55, 37.2],
      [36.95, 37.2],
      [37.3, 37.25],
      [37.65, 37.45],
      [37.9, 37.35],
      [38.05, 36.85],
      [37.6, 36.8],
      [37.35, 36.98],
      [36.9, 36.98],
      [36.7, 36.85],
      [36.5, 36.95],
    ],
  ],
  [
    "Adıyaman",
    [
      [37.45, 37.85],
      [37.7, 38.25],
      [38.3, 38.2],
      [39.0, 38.1],
      [39.25, 37.85],
      [38.8, 37.55],
      [38.2, 37.5],
      [37.9, 37.35],
      [37.65, 37.45],
    ],
  ],
  [
    "Malatya",
    [
      [37.3, 38.55],
      [37.7, 38.25],
      [38.3, 38.2],
      [39.0, 38.1],
      [39.15, 38.5],
      [38.75, 39.05],
      [38.0, 39.1],
      [37.55, 38.95],
    ],
  ],
];

const CAMPS: [string, LngLat, number][] = [
  ["Kahramanmaraş stadium tent city", [36.93, 37.58], 2],
  ["Antakya", [36.16, 36.2], 2],
  ["Nurdağı", [36.74, 37.18], 2],
  ["İslahiye", [36.63, 37.02], 2],
  ["Adıyaman", [38.28, 37.76], 2],
  ["Malatya", [38.31, 38.35], 2],
  ["Elbistan", [37.19, 38.2], 3],
  ["Pazarcık", [37.29, 37.49], 3],
  ["Gölbaşı", [37.64, 37.78], 3],
  ["Osmaniye", [36.25, 37.07], 3],
  ["İskenderun", [36.17, 36.58], 3],
  ["Kırıkhan", [36.36, 36.5], 3],
  ["Samandağ", [35.98, 36.08], 4],
  ["Jindires", [36.69, 36.39], 3],
  ["Harim", [36.52, 36.21], 4],
  ["Salqin", [36.45, 36.14], 4],
  ["Atarib", [36.83, 36.14], 4],
];

const AIRPORTS: [string, LngLat, "open" | "closed", number][] = [
  ["Adana Şakirpaşa Airport", [35.28, 36.982], "open", 1],
  ["Incirlik Air Base", [35.426, 37.002], "open", 2],
  ["Gaziantep Oğuzeli Airport", [37.479, 36.947], "open", 1],
  ["Hatay Airport (runway split, closed until 12 February)", [36.282, 36.363], "closed", 1],
  ["Kahramanmaraş Airport", [36.953, 37.539], "open", 2],
  ["Malatya Erhaç Airport", [38.091, 38.435], "open", 2],
  ["Adıyaman Airport", [38.469, 37.731], "open", 2],
  ["Şanlıurfa GAP Airport", [38.896, 37.446], "open", 3],
  ["Elazığ Airport", [39.291, 38.607], "open", 3],
  ["Aleppo International Airport", [37.224, 36.181], "open", 3],
];

export function earthquake(clock: SeedClock): SeedMap {
  const b = new MapBuilder("eq", PRESETS, { by: PEOPLE.daniel.name, at: clock.ago(1, 4, 20) });

  b.area({
    name: en("Severe shaking around both ruptures"),
    group: "eq-shaking",
    preset: "eq-strong",
    from: utc(6, 1, 17),
    ring: corridor([...MAIN_RUPTURE], 45),
  });
  b.area({
    name: en("Violent shaking along the main rupture"),
    group: "eq-shaking",
    preset: "eq-severe",
    from: utc(6, 1, 17),
    ring: corridor([...MAIN_RUPTURE], 18),
  });
  b.area({
    name: en("Violent shaking along the Çardak fault"),
    group: "eq-shaking",
    preset: "eq-severe",
    from: utc(6, 10, 24),
    ring: corridor(SECOND_RUPTURE, 16),
  });

  for (const [name, ring] of PROVINCES) {
    b.area({ name: en(`${name} province`), label: en(name), group: "eq-provinces", preset: "eq-province", ring, locked: true });
  }
  b.area({
    name: en("North-west Syria: Harim, Afrin and Jindires districts"),
    label: en("North-west Syria"),
    group: "eq-provinces",
    preset: "eq-nws",
    since: 2,
    ring: [
      [36.38, 36.05],
      [36.55, 36.2],
      [36.68, 36.3],
      [36.6, 36.55],
      [36.95, 36.6],
      [37.15, 36.35],
      [37.05, 36.05],
      [36.75, 35.85],
      [36.45, 35.85],
    ],
  });

  b.line({
    name: en("East Anatolian Fault rupture, about 300 km"),
    group: "eq-shaking",
    preset: "eq-fault",
    from: utc(6, 1, 17),
    path: MAIN_RUPTURE,
  });
  b.line({
    name: en("Çardak fault rupture, about 125 km"),
    group: "eq-shaking",
    preset: "eq-fault",
    from: utc(6, 10, 24),
    path: SECOND_RUPTURE,
  });
  b.line({
    name: en("Gaziantep–Osmaniye motorway, closed at Nurdağı"),
    group: "eq-access",
    preset: "eq-closed",
    from: utc(6, 2),
    to: utc(9, 12),
    since: 2,
    path: [
      [36.3, 37.1],
      [36.6, 37.14],
      [36.78, 37.17],
      [37.05, 37.1],
    ],
  });

  const routes: [string, LngLat[], number][] = [
    ["Adana to Kahramanmaraş via Osmaniye", [[35.32, 37.0], [36.25, 37.1], [36.75, 37.35], [36.93, 37.55]], 2],
    ["Adana to Antakya via İskenderun", [[35.32, 36.96], [36.0, 36.9], [36.2, 36.6], [36.17, 36.24]], 2],
    ["Mersin port to Adana", [[34.64, 36.8], [34.95, 36.9], [35.25, 36.97]], 3],
    ["Malatya airport to Adıyaman", [[38.09, 38.42], [38.2, 38.1], [38.27, 37.8]], 3],
    ["Gaziantep to Bab al-Salam and Azaz", [[37.38, 37.05], [37.2, 36.85], [37.08, 36.64], [37.05, 36.58]], 4],
    ["Bab al-Hawa to Idlib", [[36.69, 36.23], [36.7, 36.1], [36.63, 35.94]], 3],
    ["Al-Rai crossing to al-Bab", [[37.45, 36.61], [37.48, 36.5], [37.52, 36.37]], 4],
  ];
  for (const [name, control, since] of routes) {
    b.arrow({ name: en(name), group: "eq-access", preset: "eq-route", from: utc(7, 6), since, control });
  }

  const epicentres: [string, string, LngLat, string][] = [
    ["7.8", "Magnitude 7.8, Pazarcık, 04:17 local time", [37.014, 37.226], utc(6, 1, 17)],
    ["6.7", "Magnitude 6.7 aftershock, Nurdağı, 04:28", [36.893, 37.189], utc(6, 1, 28)],
    ["7.5", "Magnitude 7.5, Elbistan, 13:24", [37.196, 38.011], utc(6, 10, 24)],
    ["6.3", "Magnitude 6.3, Defne, Hatay, 20 February", [36.02, 36.11], utc(20, 17, 4)],
  ];
  epicentres.forEach(([number, name, at, from], i) => {
    b.number({ name: en(name), group: "eq-shaking", preset: "eq-epicentre", from, at, number, size: 30, since: i === 3 ? 4 : 1 });
  });

  for (const [name, at, state, since] of AIRPORTS) {
    b.icon({
      name: en(name),
      group: "eq-access",
      preset: state === "open" ? "eq-airport" : "eq-closed",
      at,
      icon: "airport",
      since,
    });
  }
  const access: [string, LngLat, IconId, string, number][] = [
    ["İskenderun port (container fire, closed)", [36.18, 36.6], "port", "eq-closed", 2],
    ["Mersin port", [34.64, 36.8], "port", "eq-airport", 3],
    ["Bab al-Hawa / Cilvegözü", [36.692, 36.231], "checkpoint", "eq-crossing", 3],
    ["Bab al-Salam / Öncüpınar", [37.083, 36.633], "checkpoint", "eq-crossing", 4],
    ["Al-Rai / Çobanbey", [37.447, 36.609], "checkpoint", "eq-crossing", 4],
  ];
  for (const [name, at, icon, presetId, since] of access) {
    b.icon({ name: en(name), group: "eq-access", preset: presetId, at, icon, since, from: utc(6, 2) });
  }

  for (const [name, at, since] of CAMPS) {
    b.icon({ name: en(name), group: "eq-camps", preset: "eq-camp", at, icon: "camp", since, from: utc(7, 0) });
  }
  const hospitals: [string, LngLat][] = [
    ["Field hospital, İskenderun", [36.15, 36.6]],
    ["Field hospital, Antakya", [36.14, 36.22]],
    ["Field hospital, Türkoğlu", [36.85, 37.39]],
  ];
  for (const [name, at] of hospitals) {
    b.icon({ name: en(name), group: "eq-camps", preset: "eq-hospital", at, icon: "hospital", since: 3, from: utc(8, 0) });
  }

  b.note({
    name: en("Note: first earthquake"),
    group: "eq-notes",
    from: utc(6, 1, 17),
    anchor: [37.014, 37.226],
    textAt: [38.4, 36.75],
    text: en("04:17 on 6 February: magnitude 7.8, 17.9 km deep"),
  });
  b.note({
    name: en("Note: second earthquake"),
    group: "eq-notes",
    from: utc(6, 10, 24),
    anchor: [37.196, 38.011],
    textAt: [35.7, 38.75],
    text: en("13:24 the same day: magnitude 7.5, about 95 km to the north"),
  });
  b.note({
    name: en("Note: Hatay airport"),
    group: "eq-notes",
    since: 2,
    from: utc(6, 2),
    anchor: [36.282, 36.363],
    textAt: [35.1, 36.25],
    text: en("Hatay airport's only runway split; flights resumed 12 February"),
    leader: "elbow",
  });
  b.note({
    name: en("Note: cross-border aid"),
    group: "eq-notes",
    since: 3,
    from: utc(9, 9),
    anchor: [36.692, 36.231],
    textAt: [37.6, 35.75],
    text: en("First UN convoy crossed at Bab al-Hawa on 9 February; two more crossings opened on 13 February"),
  });

  const settings = makeSettings({
    center: [37.0, 37.3],
    zoom: 7,
    basemap: "positron",
    labelLanguage: "en",
    presets: PRESETS,
    groups: [
      ["eq-notes", en("Notes")],
      ["eq-camps", en("Camps and field hospitals")],
      ["eq-access", en("Access: airports, ports, crossings, routes")],
      ["eq-shaking", en("Earthquakes and shaking")],
      ["eq-provinces", en("Affected provinces")],
    ],
    legendTitle: en("Key"),
    titleBlock: {
      subtitle: en("Where the ground broke on 6 February 2023, and how aid reached the eleven provinces and north-west Syria"),
      source: en("Sources: USGS, AFAD, UN OCHA"),
      credit: en("Graphic: Al Mashriq"),
      note: en("Province outlines are simplified. Camp locations are approximate."),
      asOf: utc(20, 18),
    },
    timeline: { enabled: true, mode: "cumulative", speed: 14_400, windowMs: 86_400_000 },
  });

  return {
    id: "m_earthquake",
    slug: "turkiye-syria-earthquakes-aid",
    title: en("Türkiye–Syria earthquakes: epicentres, damage and aid routes"),
    uiDir: "ltr",
    createdBy: "daniel",
    settings,
    draft: b.build(),
    rev: 58,
    updated: { at: clock.ago(1, 4, 20), by: "daniel" },
    versions: [
      { kind: "publish", step: 1, by: "daniel", rev: 14, at: clock.ago(4, 6, 0) },
      { kind: "publish", step: 2, by: "sarah", rev: 29, at: clock.ago(3, 2, 30) },
      { kind: "publish", step: 3, by: "daniel", rev: 44, at: clock.ago(2, 5, 45) },
      { kind: "publish", step: 4, by: "daniel", rev: 58, at: clock.ago(1, 4, 20) },
    ],
    snapshot: (step) => b.build(step),
  };
}

/** The main rupture, for the aftershock map that scatters along it. */
export const EAST_ANATOLIAN_RUPTURE: LngLat[] = MAIN_RUPTURE;
export const CARDAK_RUPTURE: LngLat[] = SECOND_RUPTURE;
