/**
 * The Al Haouz earthquake, Morocco, 8 September 2023. Published and up to
 * date: the draft and the live version are the same.
 */
import type { LngLat, StylePreset } from "@/model/types";
import { ar, circle, fill, makeSettings, MapBuilder, preset, slot, stroke } from "./build";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

const PRESETS: StylePreset[] = [
  preset("hz-severe", ar("اهتزاز عنيف"), ["area"], { fill: fill(1, 0.24), stroke: stroke(1, 1) }),
  preset("hz-strong", ar("اهتزاز قوي"), ["area"], { fill: fill(3, 0.16), stroke: stroke(3, 1, "dashed") }),
  preset("hz-village", ar("بلدة متضررة"), ["point"], { iconColor: slot(1) }),
  preset("hz-road", ar("طريق مقطوع"), ["line"], { stroke: stroke(1, 3, "dotted") }),
  preset("hz-aid", ar("مركز إغاثة أو مطار"), ["point"], { iconColor: slot(4) }),
];

const EPICENTRE: LngLat = [-8.39, 31.06];
const quake = new Date(Date.UTC(2023, 8, 8, 22, 11)).toISOString();

export function haouz(clock: SeedClock): SeedMap {
  const b = new MapBuilder("hz", PRESETS, { by: PEOPLE.omar.name, at: clock.ago(6, 3, 0) });

  b.area({ name: ar("اهتزاز قوي: نحو 70 كم من المركز"), group: "hz-shaking", preset: "hz-strong", from: quake, ring: circle(EPICENTRE, 70) });
  b.area({ name: ar("اهتزاز عنيف: نحو 30 كم من المركز"), group: "hz-shaking", preset: "hz-severe", from: quake, ring: circle(EPICENTRE, 30) });
  b.line({
    name: ar("طريق تيزي نتاست بين أسني وتارودانت"),
    group: "hz-access",
    preset: "hz-road",
    from: quake,
    since: 2,
    path: [
      [-7.98, 31.25],
      [-8.08, 31.18],
      [-8.18, 30.99],
      [-8.38, 30.87],
      [-8.62, 30.68],
      [-8.877, 30.47],
    ],
  });
  b.number({ name: ar("مركز الزلزال: 6.8 درجات"), group: "hz-shaking", from: quake, at: EPICENTRE, number: "6.8", color: 1, size: 30 });
  const villages: [string, LngLat, number][] = [
    ["أمزميز", [-8.23, 31.22], 1],
    ["أسني", [-7.98, 31.25], 1],
    ["مولاي إبراهيم", [-7.96, 31.29], 1],
    ["تلات نيعقوب", [-8.18, 30.99], 1],
    ["إيغيل", [-8.41, 31.05], 2],
    ["تارودانت", [-8.877, 30.47], 2],
    ["شيشاوة", [-8.76, 31.54], 2],
  ];
  for (const [name, at, since] of villages) {
    b.icon({ name: ar(name), label: ar(name), group: "hz-damage", preset: "hz-village", from: quake, since, at, icon: "pin" });
  }
  b.icon({ name: ar("مطار مراكش المنارة"), group: "hz-access", preset: "hz-aid", at: [-8.036, 31.607], icon: "airport" });
  b.icon({ name: ar("مركز الإغاثة في مراكش"), group: "hz-access", preset: "hz-aid", since: 2, at: [-7.99, 31.63], icon: "aid" });
  b.icon({ name: ar("مستشفى ميداني في أسني"), group: "hz-access", preset: "hz-aid", since: 2, at: [-7.985, 31.245], icon: "hospital" });
  b.note({
    name: ar("ملاحظة: الزلزال"),
    group: "hz-notes",
    from: quake,
    anchor: EPICENTRE,
    textAt: [-9.35, 31.45],
    text: ar("الجمعة 8 سبتمبر، 23:11 بالتوقيت المحلي: زلزال بقوة 6.8 درجات في جبال الأطلس الكبير"),
  });

  const settings = makeSettings({
    center: [-8.3, 31.1],
    zoom: 8,
    basemap: "positron",
    labelLanguage: "ar",
    presets: PRESETS,
    groups: [
      ["hz-notes", ar("ملاحظات")],
      ["hz-damage", ar("البلدات المتضررة")],
      ["hz-access", ar("الوصول والإغاثة")],
      ["hz-shaking", ar("الاهتزاز")],
    ],
    legendTitle: ar("مفتاح الخريطة"),
    titleBlock: {
      subtitle: ar("مركز الهزة والأقاليم الأكثر تضررًا في إقليم الحوز"),
      source: ar("المصدر: هيئة المسح الجيولوجي الأمريكية، المعهد الوطني للجيوفيزياء"),
      credit: ar("إعداد: قسم الغرافيك، المشرق"),
      note: ar("نطاقات الاهتزاز تقريبية"),
      asOf: new Date(Date.UTC(2023, 8, 10, 12)).toISOString(),
    },
  });

  return {
    id: "m_haouz",
    slug: "al-haouz-earthquake",
    title: ar("زلزال الحوز: مركز الهزة والبلدات المتضررة"),
    uiDir: "rtl",
    createdBy: "omar",
    settings,
    draft: b.build(),
    rev: 23,
    updated: { at: clock.ago(6, 3, 0), by: "omar" },
    versions: [
      { kind: "publish", step: 1, by: "omar", rev: 10, at: clock.ago(7, 1, 0) },
      { kind: "publish", step: 2, by: "omar", rev: 23, at: clock.ago(6, 3, 0) },
    ],
    snapshot: (step) => b.build(step),
  };
}
