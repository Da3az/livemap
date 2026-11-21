/**
 * Cyclone Shaheen, Oman, 30 September – 4 October 2021. The densest seeded
 * map and the one with the long version history: thirteen publish steps and a
 * rollback, so the diff has added, removed and changed features to show.
 *
 * Positions follow the storm's published track to within the precision of a
 * newsroom graphic; warning areas and shelters are schematic.
 */
import type { LngLat, MapFeature, StylePreset } from "@/model/types";
import { ar, band, circle, corridor, fill, LABEL_PLAIN, makeSettings, MapBuilder, preset, slot, stroke, withPreset } from "./build";
import { PEOPLE, type SeedClock, type SeedMap, type SeedVersion } from "./people";

const PRESETS: StylePreset[] = [
  preset("sh-red", ar("تحذير أحمر"), ["area"], { fill: fill(1, 0.3), stroke: stroke(1, 1.5) }),
  preset("sh-orange", ar("تحذير برتقالي"), ["area"], { fill: fill(3, 0.32), stroke: stroke(3, 1.5) }),
  preset("sh-yellow", ar("تنبيه أصفر"), ["area"], { fill: fill(3, 0.14, "dots"), stroke: stroke(3, 1, "dashed") }),
  preset("sh-sea", ar("اضطراب البحر"), ["area"], { fill: fill(6, 0.18, "hatch"), stroke: stroke(6, 1, "dashed") }),
  preset("sh-cone", ar("مخروط التوقعات"), ["area"], { fill: fill(5, 0.12), stroke: stroke(5, 1, "dotted") }),
  preset("sh-track", ar("المسار المرصود"), ["line"], { stroke: stroke(5, 3) }),
  preset("sh-forecast", ar("المسار المتوقع"), ["line"], { stroke: stroke(5, 2, "dashed") }),
  preset("sh-position", ar("موقع مركز الإعصار"), ["point"], { iconColor: slot(5) }),
  preset("sh-shelter", ar("مركز إيواء"), ["point"], { iconColor: slot(4) }),
  preset("sh-flood", ar("فيضان أو جريان أودية"), ["point"], { iconColor: slot(2) }),
  preset("sh-road", ar("طريق مغلق"), ["line"], { stroke: stroke(1, 3, "dashed") }),
  preset("sh-evac", ar("حد منطقة الإخلاء"), ["frontline"], { stroke: stroke(1, 2.5) }),
  preset("sh-move", ar("اتجاه الإخلاء"), ["arrow"], { stroke: stroke(4, 3) }),
];

/** The Batinah coast and Muscat, north-west to south-east. */
const SHINAS: LngLat = [56.47, 24.74];
const LIWA: LngLat = [56.56, 24.53];
const SOHAR: LngLat = [56.73, 24.36];
const SAHAM: LngLat = [56.89, 24.17];
const KHABURAH: LngLat = [57.1, 23.98];
const SUWAIQ: LngLat = [57.44, 23.85];
const MUSANAAH: LngLat = [57.64, 23.77];
const BARKA: LngLat = [57.89, 23.7];
const SEEB: LngLat = [58.19, 23.68];
const QURUM: LngLat = [58.48, 23.62];
const MUTTRAH: LngLat = [58.59, 23.62];

const utc = (day: number, hour: number, minute = 0): string =>
  new Date(Date.UTC(2021, day >= 30 ? 8 : 9, day, hour, minute)).toISOString();

/** [number, time, position, what it was then, the publish step that added it] */
const POSITIONS: [string, string, LngLat, string, number][] = [
  ["1", utc(30, 18), [66.5, 22.0], "منخفض جوي عميق", 1],
  ["2", utc(1, 0), [65.0, 22.8], "عاصفة مدارية", 1],
  ["3", utc(1, 12), [63.3, 23.6], "عاصفة مدارية", 1],
  ["4", utc(2, 0), [62.0, 24.2], "عاصفة مدارية شديدة", 2],
  ["5", utc(2, 12), [60.8, 24.6], "إعصار مداري من الدرجة الأولى", 3],
  ["6", utc(3, 0), [59.6, 24.6], "إعصار مداري من الدرجة الأولى", 5],
  ["7", utc(3, 6), [58.9, 24.4], "إعصار مداري من الدرجة الأولى", 6],
  ["8", utc(3, 12), [58.2, 24.1], "إعصار مداري من الدرجة الأولى", 7],
  ["9", utc(3, 16, 30), [57.54, 23.81], "عبور اليابسة", 8],
  ["10", utc(4, 0), [56.6, 23.4], "عاصفة مدارية", 10],
  ["11", utc(4, 6), [55.9, 23.1], "منخفض جوي", 11],
];

const SHELTERS: [string, LngLat, number][] = [
  ["السيب", [58.17, 23.66], 4],
  ["بركاء", [57.88, 23.68], 4],
  ["المصنعة", [57.63, 23.74], 4],
  ["السويق", [57.43, 23.82], 4],
  ["الخابورة", [57.09, 23.95], 4],
  ["صحم", [56.88, 24.14], 4],
  ["صحار", [56.71, 24.33], 4],
  ["الرستاق", [57.42, 23.39], 6],
  ["نخل", [57.83, 23.39], 6],
  ["العامرات", [58.5, 23.52], 6],
  ["بوشر", [58.4, 23.56], 6],
  ["قريات", [58.91, 23.25], 6],
  ["لوى", [56.55, 24.5], 6],
  ["شناص", [56.46, 24.72], 6],
];

export function shaheen(clock: SeedClock): SeedMap {
  const b = new MapBuilder("sh", PRESETS, { by: PEOPLE.omar.name, at: clock.ago(0, 3, 10) });

  /* ---- warnings and sea state, at the bottom of the stack ---- */
  b.area({
    name: ar("اضطراب البحر في بحر عُمان"),
    label: ar("ارتفاع الموج 8–12 مترًا"),
    group: "sh-warnings",
    preset: "sh-sea",
    from: utc(2, 0),
    to: utc(4, 6),
    since: 2,
    ring: [
      [56.9, 24.5],
      [57.6, 24.15],
      [58.3, 23.95],
      [59.0, 23.9],
      [59.6, 24.3],
      [59.9, 24.9],
      [59.2, 25.15],
      [58.2, 25.1],
      [57.3, 25.0],
    ],
  });
  const interior = b.area({
    name: ar("الداخلية والظاهرة والبريمي"),
    label: ar("أمطار غزيرة متوقعة"),
    group: "sh-warnings",
    preset: "sh-yellow",
    from: utc(2, 6),
    to: utc(4, 12),
    since: 2,
    until: 12,
    ring: [
      [56.2, 24.45],
      [56.55, 24.1],
      [56.95, 23.7],
      [57.3, 23.55],
      [57.75, 23.4],
      [58.0, 23.05],
      [57.6, 22.75],
      [57.0, 22.8],
      [56.4, 23.0],
      [55.95, 23.5],
      [55.85, 24.05],
    ],
  });
  b.revise(interior, 10, withPreset(PRESETS, "sh-orange"));
  b.area({
    name: ar("شمال الباطنة"),
    label: ar("شمال الباطنة"),
    group: "sh-warnings",
    preset: "sh-orange",
    from: utc(2, 12),
    to: utc(4, 12),
    since: 3,
    ring: band([SHINAS, LIWA, SOHAR, SAHAM, KHABURAH], [0.02, 0.04], [-0.15, -0.28]),
  });
  const southBatinah = b.area({
    name: ar("جنوب الباطنة ومسقط"),
    label: ar("جنوب الباطنة ومسقط"),
    group: "sh-warnings",
    preset: "sh-orange",
    from: utc(2, 12),
    to: utc(4, 12),
    since: 3,
    ring: band([KHABURAH, SUWAIQ, MUSANAAH, BARKA, SEEB, QURUM, MUTTRAH], [0.02, 0.04], [-0.15, -0.28]),
  });
  b.revise(southBatinah, 5, withPreset(PRESETS, "sh-red"));
  b.revise(southBatinah, 12, withPreset(PRESETS, "sh-orange"));
  b.area({
    name: ar("رياح بقوة الإعصار عند العبور"),
    group: "sh-warnings",
    from: utc(3, 14),
    to: utc(3, 22),
    since: 8,
    ring: circle([57.54, 23.81], 45),
    fill: fill(1, 0.1, "cross"),
    stroke: stroke(1, 1.5, "dotted"),
  });
  b.area({
    name: ar("أمطار تجاوزت 300 ملم"),
    label: ar("أكثر من 300 ملم"),
    group: "sh-warnings",
    from: utc(3, 18),
    since: 11,
    ring: [
      [56.92, 24.05],
      [57.18, 23.96],
      [57.4, 23.84],
      [57.36, 23.66],
      [57.12, 23.68],
      [56.9, 23.82],
    ],
    fill: fill(2, 0.22, "dots"),
    stroke: stroke(2, 1.5),
  });
  b.area({
    name: ar("أمطار 150–300 ملم"),
    group: "sh-warnings",
    from: utc(3, 18),
    since: 11,
    ring: [
      [56.6, 24.3],
      [57.0, 24.12],
      [57.5, 23.86],
      [57.95, 23.72],
      [57.9, 23.4],
      [57.4, 23.42],
      [56.95, 23.58],
      [56.6, 23.9],
    ],
    fill: fill(2, 0.1),
    stroke: stroke(2, 1, "dashed"),
  });

  /* ---- forecast cones and tracks, one per advisory ---- */
  const advisories: { from: string; to: string; path: LngLat[]; km: [number, number]; since: number; label: string }[] = [
    {
      from: utc(1, 0),
      to: utc(2, 0),
      since: 1,
      label: "نشرة 1 أكتوبر",
      km: [12, 95],
      path: [
        [65.0, 22.8],
        [63.3, 23.6],
        [61.5, 24.2],
        [59.5, 24.5],
        [57.8, 24.2],
      ],
    },
    {
      from: utc(2, 0),
      to: utc(3, 0),
      since: 2,
      label: "نشرة 2 أكتوبر",
      km: [12, 75],
      path: [
        [62.0, 24.2],
        [60.6, 24.6],
        [59.2, 24.5],
        [58.0, 24.1],
        [56.9, 23.5],
      ],
    },
    {
      from: utc(3, 0),
      to: utc(3, 16, 30),
      since: 5,
      label: "نشرة 3 أكتوبر",
      km: [10, 50],
      path: [
        [59.6, 24.6],
        [58.6, 24.3],
        [57.6, 23.8],
        [56.6, 23.4],
        [55.8, 23.0],
      ],
    },
  ];
  for (const advisory of advisories) {
    const [startKm, endKm] = advisory.km;
    b.area({
      name: ar(`مخروط التوقعات — ${advisory.label}`),
      group: "sh-forecast",
      preset: "sh-cone",
      lineage: "sh-cone",
      from: advisory.from,
      to: advisory.to,
      since: advisory.since,
      ring: corridor(advisory.path, (t) => startKm + (endKm - startKm) * t, true),
    });
    b.line({
      name: ar(`المسار المتوقع — ${advisory.label}`),
      group: "sh-forecast",
      preset: "sh-forecast",
      lineage: "sh-forecast-track",
      from: advisory.from,
      to: advisory.to,
      since: advisory.since,
      path: advisory.path,
    });
  }

  /* ---- the observed track grows with every publish ---- */
  const track = b.line({
    name: ar("المسار المرصود"),
    group: "sh-track",
    preset: "sh-track",
    from: utc(30, 18),
    locked: true,
    path: POSITIONS.filter((p) => p[4] <= 1).map((p) => p[2]),
  });
  for (const step of [2, 3, 5, 6, 7, 8, 10, 11]) {
    const path = POSITIONS.filter((p) => p[4] <= step).map((p) => p[2]);
    b.revise(track, step, (f) => (f.kind === "line" ? { ...f, path } : f));
  }

  /* ---- closed roads ---- */
  const roads: [string, LngLat[], number, number?][] = [
    ["طريق الباطنة الساحلي: المصنعة – الخابورة", [[57.64, 23.75], [57.44, 23.83], [57.27, 23.9], [57.1, 23.96]], 7],
    ["شارع السلطان قابوس عند القرم", [[58.38, 23.6], [58.45, 23.61], [58.5, 23.6]], 7, 13],
    ["طريق الباطنة السريع: بركاء – الخابورة", [[57.85, 23.62], [57.55, 23.7], [57.3, 23.78], [57.05, 23.9]], 10],
    ["طريق الرستاق – المصنعة", [[57.42, 23.39], [57.5, 23.55], [57.6, 23.72]], 10],
    ["طريق وادي الحواسنة", [[57.1, 23.96], [57.02, 23.85], [56.95, 23.76]], 10],
  ];
  for (const [name, path, since, until] of roads) {
    b.line({ name: ar(name), group: "sh-damage", preset: "sh-road", from: utc(3, 14), since, until, path });
  }

  /* ---- evacuation ---- */
  b.frontline({
    name: ar("حد منطقة الإخلاء الساحلية"),
    label: ar("منطقة الإخلاء"),
    group: "sh-evacuation",
    preset: "sh-evac",
    from: utc(3, 4),
    to: utc(4, 6),
    since: 5,
    facing: "left",
    path: [
      [56.87, 24.13],
      [57.08, 23.94],
      [57.42, 23.81],
      [57.62, 23.73],
      [57.87, 23.66],
    ],
  });
  const moves: [string, LngLat[]][] = [
    ["الإخلاء من السويق نحو الرستاق", [[57.44, 23.8], [57.46, 23.62], [57.43, 23.44]]],
    ["الإخلاء من المصنعة نحو نخل", [[57.66, 23.72], [57.76, 23.58], [57.82, 23.43]]],
    ["الإخلاء من الخابورة نحو الداخل", [[57.08, 23.92], [56.96, 23.8], [56.9, 23.68]]],
  ];
  for (const [name, control] of moves) {
    b.arrow({ name: ar(name), group: "sh-evacuation", preset: "sh-move", from: utc(3, 4), to: utc(4, 6), since: 5, control });
  }
  b.arrow({
    name: ar("اتجاه حركة الإعصار"),
    group: "sh-track",
    from: utc(3, 16, 30),
    since: 8,
    control: [
      [57.35, 23.74],
      [56.95, 23.57],
      [56.55, 23.38],
    ],
    tapered: true,
    stroke: stroke(5, 5, "solid", 0.7),
  });

  /* ---- numbered positions ---- */
  for (const [number, time, at, status, since] of POSITIONS) {
    b.number({
      name: ar(`الموقع ${number}: ${status}`),
      group: "sh-track",
      preset: "sh-position",
      from: time,
      since,
      at,
      number,
    });
  }

  /* ---- shelters; version 9 lost the whole group by mistake ---- */
  for (const [town, at, since] of SHELTERS) {
    b.icon({
      name: ar(`مركز إيواء ${town}`),
      group: "sh-shelters",
      preset: "sh-shelter",
      from: utc(2, 14),
      since,
      skip: [9],
      at,
      icon: "shelter",
    });
  }

  /* ---- flooding ---- */
  const floods: [string, LngLat, number][] = [
    ["جريان وادي الحواسنة", [57.05, 23.87], 7],
    ["غمر الأحياء الساحلية في السويق", [57.46, 23.84], 7],
    ["غمر منخفضات القرم", [58.47, 23.61], 10],
    ["جريان أودية الرستاق", [57.4, 23.42], 10],
    ["غمر مزارع المصنعة", [57.6, 23.75], 10],
    ["غمر طريق الخابورة الداخلي", [57.12, 23.95], 10],
  ];
  for (const [name, at, since] of floods) {
    b.icon({ name: ar(name), group: "sh-damage", preset: "sh-flood", from: utc(3, 15), since, at, icon: "flood" });
  }

  /* ---- transport and hospitals ---- */
  b.icon({
    name: ar("مطار مسقط الدولي"),
    label: ar("مطار مسقط: تعليق الرحلات"),
    group: "sh-damage",
    from: utc(3, 4),
    to: utc(4, 4),
    since: 4,
    at: [58.284, 23.593],
    icon: "airport",
    color: 1,
  });
  b.icon({ name: ar("مطار صحار"), group: "sh-damage", since: 4, at: [56.626, 24.386], icon: "airport", color: 3 });
  b.icon({ name: ar("ميناء صحار"), group: "sh-damage", since: 3, at: [56.62, 24.5], icon: "port", color: 3 });
  b.icon({ name: ar("ميناء السلطان قابوس"), group: "sh-damage", since: 3, at: [58.567, 23.628], icon: "port", color: 3 });
  b.icon({ name: ar("ميناء السويق"), group: "sh-damage", since: 3, at: [57.45, 23.86], icon: "port", color: 1 });
  b.icon({ name: ar("مستشفى الرستاق"), group: "sh-shelters", since: 8, at: [57.44, 23.4], icon: "hospital", color: 4 });
  b.icon({ name: ar("مستشفى صحار"), group: "sh-shelters", since: 8, at: [56.74, 24.32], icon: "hospital", color: 4 });

  /* ---- notes ---- */
  b.note({
    name: ar("ملاحظة: شدة الرياح"),
    group: "sh-notes",
    from: utc(3, 6),
    since: 6,
    anchor: [58.9, 24.4],
    textAt: [59.5, 25.35],
    text: ar("رياح مستمرة حتى 120 كم/س حول المركز"),
  });
  b.note({
    name: ar("ملاحظة: تعليق الرحلات"),
    group: "sh-notes",
    from: utc(3, 4),
    since: 7,
    anchor: [58.284, 23.593],
    textAt: [58.75, 23.2],
    text: ar("تعليق الرحلات في مطار مسقط الدولي"),
    leader: "elbow",
  });
  const landfall = b.note({
    name: ar("ملاحظة: عبور اليابسة"),
    group: "sh-notes",
    from: utc(3, 16, 30),
    since: 8,
    anchor: [57.54, 23.81],
    textAt: [57.2, 24.55],
    text: ar("عبر مركز الإعصار الساحل بين المصنعة والسويق نحو الساعة 8:30 مساء الأحد 3 أكتوبر"),
  });
  b.revise(landfall, 9, (f) =>
    f.kind === "annotation" ? { ...f, text: ar("عبر مركز الإعصار الساحل قرب السويق مساء الأحد") } : f,
  );
  b.revise(landfall, 10, (f) =>
    f.kind === "annotation"
      ? { ...f, text: ar("عبر مركز الإعصار الساحل بين المصنعة والسويق نحو الساعة 8:30 مساء الأحد 3 أكتوبر") }
      : f,
  );
  b.note({
    name: ar("ملاحظة: أمطار الخابورة"),
    group: "sh-notes",
    from: utc(4, 0),
    since: 10,
    anchor: [57.1, 23.98],
    textAt: [56.2, 24.95],
    text: ar("الخابورة: 369 ملم من الأمطار خلال 24 ساعة"),
  });
  b.note({
    name: ar("ملاحظة: الساحل الإيراني"),
    group: "sh-notes",
    from: utc(2, 12),
    since: 11,
    anchor: [60.64, 25.29],
    textAt: [61.3, 25.9],
    text: ar("أمطار ورياح شديدة على ساحل مكران قرب تشابهار"),
    style: { ...LABEL_PLAIN, weight: 400 },
  });

  /* ---- only in the draft: not yet published ---- */
  b.icon({
    name: ar("مركز إيواء عبري"),
    group: "sh-shelters",
    preset: "sh-shelter",
    from: utc(3, 20),
    since: 14,
    at: [56.52, 23.23],
    icon: "shelter",
    by: PEOPLE.maryam.name,
    when: clock.ago(0, 0, 12),
  });
  b.note({
    name: ar("مسودة: حصيلة الأضرار (بانتظار التأكيد)"),
    group: "sh-notes",
    since: 14,
    hidden: true,
    anchor: [57.44, 23.85],
    textAt: [58.1, 24.75],
    text: ar("حصيلة الأضرار في السويق والخابورة — بانتظار تأكيد المصدر"),
    by: PEOPLE.maryam.name,
  });

  const settings = makeSettings({
    center: [58.9, 24.0],
    zoom: 6.4,
    basemap: "positron",
    labelLanguage: "ar",
    presets: PRESETS,
    groups: [
      ["sh-notes", ar("ملاحظات")],
      ["sh-shelters", ar("الإيواء والمستشفيات")],
      ["sh-track", ar("مسار الإعصار")],
      ["sh-evacuation", ar("الإخلاء")],
      ["sh-damage", ar("الأضرار والطرق")],
      ["sh-forecast", ar("التوقعات")],
      ["sh-warnings", ar("التحذيرات")],
    ],
    legendTitle: ar("مفتاح الخريطة"),
    titleBlock: {
      subtitle: ar("مسار الإعصار المداري والتحذيرات ومراكز الإيواء في سلطنة عُمان، 30 سبتمبر – 4 أكتوبر 2021"),
      source: ar("المصدر: هيئة الطيران المدني العُمانية، المركز الوطني للإنذار المبكر"),
      credit: ar("إعداد: قسم الغرافيك، المشرق"),
      note: ar("المواقع وحدود مناطق التحذير تقريبية"),
      asOf: utc(4, 6),
    },
    timeline: { enabled: true, mode: "cumulative", speed: 7200, windowMs: 21_600_000 },
  });

  const publish = (step: number, by: SeedVersion["by"], rev: number, d: number, h: number, m = 0): SeedVersion => ({
    kind: "publish",
    step,
    by,
    rev,
    at: clock.ago(d, h, m),
  });

  const draft: MapFeature[] = b.build();

  return {
    id: "m_shaheen",
    slug: "cyclone-shaheen",
    title: ar("إعصار شاهين: المسار والتحذيرات ومراكز الإيواء"),
    uiDir: "rtl",
    createdBy: "omar",
    settings,
    draft,
    rev: 97,
    updated: { at: clock.ago(0, 0, 12), by: "maryam" },
    versions: [
      publish(1, "omar", 6, 5, 7, 40),
      publish(2, "omar", 11, 5, 2, 15),
      publish(3, "layla", 19, 4, 19, 5),
      publish(4, "maryam", 27, 4, 9, 30),
      publish(5, "omar", 34, 3, 22, 50),
      publish(6, "omar", 41, 3, 17, 20),
      publish(7, "daniel", 52, 3, 11, 45),
      publish(8, "omar", 60, 3, 6, 10),
      publish(9, "daniel", 63, 3, 5, 25),
      { kind: "rollback", toVersion: 8, by: "layla", at: clock.ago(3, 5, 12) },
      publish(10, "omar", 71, 2, 20, 30),
      publish(11, "maryam", 80, 2, 3, 15),
      publish(12, "sarah", 86, 1, 8, 0),
      publish(13, "omar", 93, 0, 3, 10),
    ],
    snapshot: (step) => b.build(step),
  };
}
