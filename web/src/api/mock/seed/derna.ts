/**
 * Storm Daniel and the Derna dam failures, Libya, 10–11 September 2023.
 * A contributor's working draft: never published.
 */
import type { LngLat, StylePreset } from "@/model/types";
import { ar, fill, makeSettings, MapBuilder, preset, slot, stroke } from "./build";
import { PEOPLE, type SeedClock, type SeedMap } from "./people";

const PRESETS: StylePreset[] = [
  preset("dn-flood", ar("منطقة غمرتها السيول"), ["area"], { fill: fill(2, 0.3), stroke: stroke(2, 1.5) }),
  preset("dn-dam", ar("سد منهار"), ["point"], { iconColor: slot(1) }),
  preset("dn-town", ar("مدينة متضررة"), ["point"], { iconColor: slot(2) }),
  preset("dn-aid", ar("مسار المساعدات"), ["arrow"], { stroke: stroke(4, 3) }),
  preset("dn-hub", ar("مطار أو ميناء للإغاثة"), ["point"], { iconColor: slot(4) }),
];

const utc = (day: number, hour: number): string => new Date(Date.UTC(2023, 8, day, hour)).toISOString();

export function derna(clock: SeedClock): SeedMap {
  const b = new MapBuilder("dn", PRESETS, { by: PEOPLE.youssef.name, at: clock.ago(2, 2, 15) });

  b.area({
    name: ar("مجرى وادي درنة داخل المدينة"),
    label: ar("وسط درنة"),
    group: "dn-damage",
    preset: "dn-flood",
    from: utc(11, 1),
    ring: [
      [22.628, 32.745],
      [22.642, 32.747],
      [22.647, 32.762],
      [22.648, 32.772],
      [22.636, 32.774],
      [22.63, 32.762],
    ],
  });
  b.area({
    name: ar("نطاق الأمطار الأشد في الجبل الأخضر"),
    group: "dn-damage",
    from: utc(10, 6),
    to: utc(11, 12),
    ring: [
      [20.9, 32.55],
      [21.4, 32.76],
      [21.95, 32.88],
      [22.5, 32.76],
      [22.75, 32.66],
      [22.6, 32.35],
      [21.9, 32.2],
      [21.2, 32.25],
    ],
    fill: fill(6, 0.12, "dots"),
    stroke: stroke(6, 1, "dashed"),
  });
  b.line({
    name: ar("وادي درنة"),
    group: "dn-damage",
    path: [
      [22.57, 32.67],
      [22.6, 32.7],
      [22.625, 32.73],
      [22.636, 32.752],
      [22.64, 32.772],
    ],
    stroke: stroke(2, 2.5),
  });
  const routes: [string, LngLat[]][] = [
    ["من بنغازي إلى درنة برًّا", [[20.2, 32.1], [21.0, 32.55], [21.8, 32.72], [22.55, 32.74]]],
    ["من طبرق إلى درنة", [[23.9, 32.05], [23.3, 32.25], [22.9, 32.45], [22.7, 32.7]]],
  ];
  for (const [name, control] of routes) {
    b.arrow({ name: ar(name), group: "dn-aid", preset: "dn-aid", from: utc(12, 6), control });
  }
  b.icon({ name: ar("سد أبو منصور"), group: "dn-damage", preset: "dn-dam", from: utc(11, 0), at: [22.572, 32.668], icon: "flood", size: 26 });
  b.icon({ name: ar("سد البلاد"), group: "dn-damage", preset: "dn-dam", from: utc(11, 1), at: [22.631, 32.742], icon: "flood", size: 26 });
  const towns: [string, LngLat][] = [
    ["البيضاء", [21.755, 32.763]],
    ["شحات", [21.86, 32.83]],
    ["سوسة", [21.96, 32.9]],
    ["المرج", [20.83, 32.49]],
  ];
  for (const [name, at] of towns) {
    b.icon({ name: ar(name), label: ar(name), group: "dn-damage", preset: "dn-town", from: utc(10, 18), at, icon: "flood" });
  }
  const hubs: [string, LngLat, "airport" | "port"][] = [
    ["مطار بنينا، بنغازي", [20.269, 32.097], "airport"],
    ["مطار الأبرق", [21.964, 32.789], "airport"],
    ["ميناء طبرق", [23.975, 32.075], "port"],
    ["ميناء درنة", [22.655, 32.765], "port"],
  ];
  for (const [name, at, icon] of hubs) {
    b.icon({ name: ar(name), group: "dn-aid", preset: "dn-hub", at, icon });
  }
  b.note({
    name: ar("ملاحظة: انهيار السدّين"),
    group: "dn-notes",
    from: utc(11, 1),
    anchor: [22.631, 32.742],
    textAt: [22.95, 32.45],
    text: ar("انهار السدّان فجر الاثنين 11 سبتمبر فاجتاحت المياه وسط المدينة"),
  });

  const settings = makeSettings({
    center: [22.0, 32.55],
    zoom: 7.6,
    basemap: "positron",
    labelLanguage: "ar",
    presets: PRESETS,
    groups: [
      ["dn-notes", ar("ملاحظات")],
      ["dn-aid", ar("الإغاثة")],
      ["dn-damage", ar("الأضرار")],
    ],
    legendTitle: ar("مفتاح الخريطة"),
    titleBlock: {
      subtitle: ar("السدّان المنهاران والمدن المتضررة ومسارات الإغاثة في شرق ليبيا، سبتمبر 2023"),
      source: ar("المصدر: مكتب الأمم المتحدة لتنسيق الشؤون الإنسانية"),
      credit: ar("إعداد: قسم الغرافيك، المشرق"),
      note: ar("المواقع تقريبية"),
      asOf: utc(14, 12),
    },
  });

  const draft = b.build();
  return {
    id: "m_derna",
    slug: "storm-daniel-derna",
    title: ar("العاصفة دانيال: فيضانات درنة ومسارات الإغاثة"),
    uiDir: "rtl",
    createdBy: "youssef",
    settings,
    draft,
    rev: 18,
    updated: { at: clock.ago(2, 2, 15), by: "youssef" },
    versions: [],
    snapshot: () => draft,
  };
}
