/**
 * A deliberately heavy map: thousands of points scattered along the two
 * February 2023 ruptures, so the workspace has a map close to its feature
 * limit and the editor has something to strain against.
 *
 * The points are generated, not a catalogue. They follow the fault traces and
 * thin out over two weeks the way an aftershock sequence does, and the map's
 * note says they are illustrative.
 */
import type { LngLat, MapFeature, StylePreset } from "@/model/types";
import { en, makeSettings, MapBuilder, preset, slot } from "./build";
import { CARDAK_RUPTURE, EAST_ANATOLIAN_RUPTURE } from "./earthquake";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

/** 94% of the member workspace's 5,000-feature limit. */
export const AFTERSHOCK_COUNT = 4_700;

const PRESETS: StylePreset[] = [
  preset("af-3", en("Magnitude 3.0–3.9"), ["point"], { iconColor: slot(3) }),
  preset("af-4", en("Magnitude 4.0–4.9"), ["point"], { iconColor: slot(7) }),
  preset("af-5", en("Magnitude 5.0 and above"), ["point"], { iconColor: slot(1) }),
];

/** A small deterministic generator, so a reload rebuilds the same map. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function along(path: LngLat[], t: number): LngLat {
  const scaled = t * (path.length - 1);
  const i = Math.min(Math.floor(scaled), path.length - 2);
  const a = path[i];
  const b = path[i + 1];
  if (!a || !b) return [37, 37.5];
  const f = scaled - i;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

const START = Date.UTC(2023, 1, 6, 1, 17);
const FORTNIGHT = 14 * 24 * 60 * 60 * 1000;
const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function aftershocks(clock: SeedClock): SeedMap {
  const b = new MapBuilder("af", PRESETS, { by: PEOPLE.daniel.name, at: clock.ago(0, 1, 34) });
  const random = mulberry32(20230206);

  for (let i = 0; i < AFTERSHOCK_COUNT; i++) {
    const trace = random() < 0.72 ? EAST_ANATOLIAN_RUPTURE : CARDAK_RUPTURE;
    const [lng, lat] = along(trace, random());
    /* Two uniform draws summed and centred: a cheap bell shape about 12 km wide. */
    const spread = () => (random() + random() - 1) * 0.16;
    const at: LngLat = [Math.round((lng + spread()) * 1e4) / 1e4, Math.round((lat + spread() * 0.8) * 1e4) / 1e4];
    /* Most of the sequence falls in the first days. */
    const when = new Date(START + FORTNIGHT * random() ** 2.6);
    /* One tenth as many events per unit of magnitude. */
    const magnitude = Math.min(6.6, 3 - Math.log10(1 - random() * 0.9997));
    const band = magnitude >= 5 ? "af-5" : magnitude >= 4 ? "af-4" : "af-3";
    b.icon({
      name: en(`M${magnitude.toFixed(1)} · ${stamp.format(when)} UTC`),
      group: band,
      preset: band,
      from: when.toISOString(),
      at,
      icon: "pin",
      size: magnitude >= 5 ? 22 : magnitude >= 4 ? 14 : 9,
    });
  }

  const settings = makeSettings({
    center: [37.2, 37.6],
    zoom: 7.2,
    basemap: "dark",
    labelLanguage: "en",
    presets: PRESETS,
    groups: [
      ["af-5", en("Magnitude 5 and above")],
      ["af-4", en("Magnitude 4")],
      ["af-3", en("Magnitude 3")],
    ],
    legendTitle: en("Aftershocks"),
    titleBlock: {
      subtitle: en("Two weeks of aftershocks along the East Anatolian and Çardak faults, 6–20 February 2023"),
      source: en("Illustrative distribution generated for testing; not the AFAD catalogue"),
      credit: en("Graphic: Al Mashriq"),
      note: en("Positions and times are simulated"),
      asOf: new Date(START + FORTNIGHT).toISOString(),
    },
    timeline: { enabled: true, mode: "moving", speed: 43_200, windowMs: 86_400_000 },
  });

  const draft: MapFeature[] = b.build();
  return {
    id: "m_aftershocks",
    slug: "aftershock-sequence-february-2023",
    title: en("Aftershock sequence, 6–20 February 2023 (density test)"),
    uiDir: "ltr",
    createdBy: "daniel",
    settings,
    draft,
    rev: 212,
    updated: { at: clock.ago(0, 1, 34), by: "daniel" },
    versions: [],
    snapshot: () => draft,
  };
}
