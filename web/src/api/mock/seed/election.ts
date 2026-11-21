/**
 * A results map by governorate, built on Jordan's twelve governorates. The
 * lists and every number are invented for a newsroom training exercise and
 * the map says so in its title block. Outlines are simplified and share
 * their corner points so neighbours meet without slivers.
 */
import type { LngLat, StylePreset } from "@/model/types";
import { ar, fill, LABEL_PLAIN, makeSettings, MapBuilder, preset, slot, stroke, withPreset } from "./build";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

const PRESETS: StylePreset[] = [
  preset("el-palm", ar("قائمة النخيل"), ["area"], { fill: fill(4, 0.45), stroke: stroke(4, 1) }),
  preset("el-olive", ar("قائمة الزيتون"), ["area"], { fill: fill(2, 0.45), stroke: stroke(2, 1) }),
  preset("el-wheat", ar("قائمة السنابل"), ["area"], { fill: fill(3, 0.5), stroke: stroke(3, 1) }),
  preset("el-indep", ar("مستقلون"), ["area"], { fill: fill(5, 0.4), stroke: stroke(5, 1) }),
  preset("el-pending", ar("فرز غير مكتمل"), ["area"], { fill: fill(7, 0.2, "hatch"), stroke: stroke(7, 1, "dashed") }),
  preset("el-seats", ar("عدد المقاعد"), ["point"], { iconColor: slot(5) }),
];

type Result = "el-palm" | "el-olive" | "el-wheat" | "el-indep";

/** [name, outline, capital, seats, leading list, the publish step that called it] */
const GOVERNORATES: [string, LngLat[], LngLat, number, Result, number][] = [
  [
    "إربد",
    [
      [35.56, 32.3],
      [35.57, 32.65],
      [35.68, 32.72],
      [35.9, 32.72],
      [36.08, 32.52],
      [36.05, 32.4],
      [35.88, 32.42],
      [35.72, 32.42],
      [35.62, 32.3],
    ],
    [35.85, 32.556],
    20,
    "el-olive",
    2,
  ],
  [
    "عجلون",
    [
      [35.62, 32.3],
      [35.72, 32.42],
      [35.88, 32.42],
      [35.86, 32.28],
      [35.74, 32.22],
    ],
    [35.752, 32.333],
    4,
    "el-palm",
    1,
  ],
  [
    "جرش",
    [
      [35.88, 32.42],
      [36.05, 32.4],
      [36.06, 32.24],
      [35.96, 32.14],
      [35.82, 32.14],
      [35.74, 32.22],
      [35.86, 32.28],
    ],
    [35.899, 32.281],
    4,
    "el-palm",
    1,
  ],
  [
    "المفرق",
    [
      [36.08, 32.52],
      [36.4, 32.38],
      [36.84, 32.31],
      [38.79, 33.38],
      [39.2, 32.16],
      [37.6, 31.68],
      [37.2, 32.0],
      [36.6, 32.1],
      [36.3, 32.16],
      [36.06, 32.24],
      [36.05, 32.4],
    ],
    [36.208, 32.343],
    8,
    "el-indep",
    2,
  ],
  [
    "الزرقاء",
    [
      [36.06, 32.24],
      [36.3, 32.16],
      [36.6, 32.1],
      [37.2, 32.0],
      [37.6, 31.68],
      [37.0, 31.5],
      [36.6, 31.62],
      [36.25, 31.8],
      [36.15, 32.0],
      [36.02, 32.08],
      [35.96, 32.14],
    ],
    [36.088, 32.073],
    12,
    "el-wheat",
    3,
  ],
  [
    "البلقاء",
    [
      [35.56, 32.3],
      [35.62, 32.3],
      [35.74, 32.22],
      [35.82, 32.14],
      [35.86, 32.02],
      [35.8, 31.9],
      [35.72, 31.8],
      [35.56, 31.76],
      [35.55, 32.0],
    ],
    [35.727, 32.039],
    10,
    "el-olive",
    2,
  ],
  [
    "العاصمة عمّان",
    [
      [35.82, 32.14],
      [35.96, 32.14],
      [36.02, 32.08],
      [36.15, 32.0],
      [36.25, 31.8],
      [36.6, 31.62],
      [37.0, 31.5],
      [37.5, 31.0],
      [36.9, 30.95],
      [36.3, 31.2],
      [36.0, 31.42],
      [35.95, 31.6],
      [35.8, 31.72],
      [35.72, 31.8],
      [35.8, 31.9],
      [35.86, 32.02],
    ],
    [35.911, 31.954],
    29,
    "el-wheat",
    3,
  ],
  [
    "مادبا",
    [
      [35.56, 31.76],
      [35.72, 31.8],
      [35.8, 31.72],
      [35.95, 31.6],
      [36.0, 31.42],
      [35.8, 31.44],
      [35.52, 31.48],
    ],
    [35.794, 31.716],
    4,
    "el-palm",
    1,
  ],
  [
    "الكرك",
    [
      [35.52, 31.48],
      [35.8, 31.44],
      [36.0, 31.42],
      [36.3, 31.2],
      [36.2, 30.98],
      [35.9, 30.95],
      [35.6, 31.0],
      [35.42, 30.95],
      [35.45, 31.2],
    ],
    [35.705, 31.185],
    10,
    "el-indep",
    2,
  ],
  [
    "الطفيلة",
    [
      [35.42, 30.95],
      [35.6, 31.0],
      [35.9, 30.95],
      [35.95, 30.7],
      [35.75, 30.62],
      [35.5, 30.65],
      [35.3, 30.6],
    ],
    [35.604, 30.837],
    4,
    "el-olive",
    2,
  ],
  [
    "معان",
    [
      [35.3, 30.6],
      [35.5, 30.65],
      [35.75, 30.62],
      [35.95, 30.7],
      [35.9, 30.95],
      [36.2, 30.98],
      [36.3, 31.2],
      [36.9, 30.95],
      [37.5, 31.0],
      [38.0, 30.5],
      [37.67, 30.34],
      [37.5, 30.0],
      [36.74, 29.87],
      [36.5, 29.5],
      [36.07, 29.19],
      [35.75, 29.24],
      [35.7, 29.8],
      [35.45, 30.1],
      [35.18, 30.2],
    ],
    [35.734, 30.196],
    4,
    "el-indep",
    3,
  ],
  [
    "العقبة",
    [
      [34.96, 29.36],
      [35.75, 29.24],
      [35.7, 29.8],
      [35.45, 30.1],
      [35.18, 30.2],
      [35.05, 29.8],
      [34.98, 29.54],
    ],
    [35.006, 29.532],
    3,
    "el-palm",
    1,
  ],
];

export function election(clock: SeedClock): SeedMap {
  const b = new MapBuilder("el", PRESETS, { by: PEOPLE.maryam.name, at: clock.ago(0, 21, 5) });

  /* Every governorate starts as "count incomplete" and is called at its step. */
  for (const [name, ring, , , result, calledAt] of GOVERNORATES) {
    const id = b.area({
      name: ar(`محافظة ${name}`),
      label: ar(name),
      labelStyle: LABEL_PLAIN,
      group: "el-results",
      preset: "el-pending",
      ring,
    });
    b.revise(id, calledAt, withPreset(PRESETS, result));
  }
  for (const [name, , capital, seats] of GOVERNORATES) {
    b.number({
      name: ar(`مقاعد ${name}: ${seats}`),
      group: "el-seats",
      preset: "el-seats",
      at: capital,
      number: String(seats),
      size: 22,
    });
  }
  b.note({
    name: ar("ملاحظة: نسبة المشاركة"),
    group: "el-notes",
    since: 2,
    anchor: [35.911, 31.954],
    textAt: [38.3, 31.35],
    text: ar("أدنى نسبة مشاركة في التمرين: العاصمة 23%"),
  });
  b.note({
    name: ar("ملاحظة: أعلى مشاركة"),
    group: "el-notes",
    since: 2,
    anchor: [35.604, 30.837],
    textAt: [34.2, 30.9],
    text: ar("أعلى نسبة مشاركة: الطفيلة 61%"),
    leader: "elbow",
  });
  b.note({
    name: ar("ملاحظة: المحصّلة"),
    group: "el-notes",
    since: 3,
    anchor: [37.9, 32.4],
    textAt: [37.9, 32.4],
    text: ar("المحصّلة من 112 مقعدًا: السنابل 41، الزيتون 34، النخيل 15، مستقلون 22"),
    leader: null,
  });

  const settings = makeSettings({
    center: [36.6, 31.25],
    zoom: 6.4,
    basemap: "positron",
    labelLanguage: "ar",
    presets: PRESETS,
    groups: [
      ["el-notes", ar("ملاحظات")],
      ["el-seats", ar("المقاعد")],
      ["el-results", ar("النتائج حسب المحافظة")],
    ],
    legendTitle: ar("القائمة المتصدّرة"),
    legendItems: PRESETS.filter((p) => p.id !== "el-seats").map((p) => ({ ref: { presetId: p.id }, label: null, hidden: false })),
    legendPosition: "bottom-end",
    titleBlock: {
      subtitle: ar("القائمة المتصدّرة وعدد المقاعد في كل محافظة"),
      source: ar("المصدر: بيانات افتراضية أُعدّت للتدريب"),
      credit: ar("إعداد: قسم الغرافيك، المشرق"),
      note: ar("تمرين تدريبي — القوائم والأرقام افتراضية وليست نتائج حقيقية. حدود المحافظات مبسّطة."),
      asOf: clock.ago(0, 21, 5),
    },
  });

  return {
    id: "m_election",
    slug: "election-night-exercise",
    title: ar("تمرين ليلة الانتخابات: النتائج حسب المحافظة"),
    uiDir: "rtl",
    createdBy: "maryam",
    settings,
    draft: b.build(),
    rev: 31,
    updated: { at: clock.ago(0, 21, 5), by: "maryam" },
    versions: [
      { kind: "publish", step: 1, by: "maryam", rev: 12, at: clock.ago(1, 1, 40) },
      { kind: "publish", step: 2, by: "maryam", rev: 22, at: clock.ago(0, 23, 15) },
      { kind: "publish", step: 3, by: "layla", rev: 31, at: clock.ago(0, 21, 5) },
    ],
    snapshot: (step) => b.build(step),
  };
}
