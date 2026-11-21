/**
 * The four starting points for a new map. A template sets up presets, groups,
 * the legend, the title block and an opening view; it carries no features, so
 * nothing has to be deleted before work starts. Names follow the map's
 * direction: Arabic for a right-to-left map, English otherwise.
 */
import type { FeatureKind, LngLat, MapSettings, RichText, StylePreset, TemplateSummary, TextDir } from "@/model/types";
import { ar, en, fill, makeSettings, preset, slot, stroke } from "./seed/build";

type Dir = Exclude<TextDir, "auto">;
type Words = (english: string, arabic: string) => RichText;

export const TEMPLATES: TemplateSummary[] = [
  {
    id: "blank",
    title: "Blank map",
    description: "An empty map with no presets. Start from the basemap and draw.",
    uiDir: "ltr",
    featureCount: 0,
  },
  {
    id: "conflict-tracker",
    title: "Conflict tracker",
    description:
      "Control areas for two sides, a contested pattern, a hatched claimed advance, a front line and dated events, with the timeline switched on.",
    uiDir: "rtl",
    featureCount: 0,
  },
  {
    id: "storm-track",
    title: "Storm track",
    description:
      "Observed and forecast track, forecast cone, three warning levels, numbered positions and shelters, with a cumulative timeline.",
    uiDir: "rtl",
    featureCount: 0,
  },
  {
    id: "regional-results",
    title: "Regional results",
    description: "One fill per list or party, a pattern for regions still counting, and seat numbers, with the key set up to match.",
    uiDir: "ltr",
    featureCount: 0,
  },
];

const REGION: { center: LngLat; zoom: number } = { center: [38, 27], zoom: 3.8 };

function conflictPresets(w: Words): StylePreset[] {
  const lines: FeatureKind[] = ["line", "arrow"];
  return [
    preset("p-side-a", w("Side A control", "سيطرة الطرف أ"), ["area"], { fill: fill(2, 0.26), stroke: stroke(2, 1) }),
    preset("p-side-b", w("Side B control", "سيطرة الطرف ب"), ["area"], { fill: fill(1, 0.26), stroke: stroke(1, 1) }),
    preset("p-contested", w("Contested", "منطقة متنازع عليها"), ["area"], {
      fill: fill(3, 0.3, "cross"),
      stroke: stroke(3, 1, "dashed"),
    }),
    preset("p-claimed", w("Claimed advance", "تقدّم معلن غير مؤكد"), ["area"], {
      fill: fill(5, 0.2, "hatch"),
      stroke: stroke(5, 1, "dashed"),
    }),
    preset("p-front", w("Front line", "خط التماس"), ["frontline"], { stroke: stroke(1, 2.5) }),
    preset("p-movement", w("Reported movement", "تحرّك مُبلّغ عنه"), lines, { stroke: stroke(5, 3) }),
    preset("p-event", w("Reported event", "حدث مُبلّغ عنه"), ["point"], { iconColor: slot(1) }),
  ];
}

function stormPresets(w: Words): StylePreset[] {
  return [
    preset("p-red", w("Red warning", "تحذير أحمر"), ["area"], { fill: fill(1, 0.3), stroke: stroke(1, 1.5) }),
    preset("p-orange", w("Orange warning", "تحذير برتقالي"), ["area"], { fill: fill(3, 0.32), stroke: stroke(3, 1.5) }),
    preset("p-yellow", w("Yellow advisory", "تنبيه أصفر"), ["area"], {
      fill: fill(3, 0.14, "dots"),
      stroke: stroke(3, 1, "dashed"),
    }),
    preset("p-cone", w("Forecast cone", "مخروط التوقعات"), ["area"], { fill: fill(5, 0.12), stroke: stroke(5, 1, "dotted") }),
    preset("p-track", w("Observed track", "المسار المرصود"), ["line"], { stroke: stroke(5, 3) }),
    preset("p-forecast", w("Forecast track", "المسار المتوقع"), ["line"], { stroke: stroke(5, 2, "dashed") }),
    preset("p-position", w("Storm centre", "موقع مركز العاصفة"), ["point"], { iconColor: slot(5) }),
    preset("p-shelter", w("Shelter", "مركز إيواء"), ["point"], { iconColor: slot(4) }),
  ];
}

function resultsPresets(w: Words): StylePreset[] {
  return [
    preset("p-list-1", w("List A", "القائمة أ"), ["area"], { fill: fill(4, 0.45), stroke: stroke(4, 1) }),
    preset("p-list-2", w("List B", "القائمة ب"), ["area"], { fill: fill(2, 0.45), stroke: stroke(2, 1) }),
    preset("p-list-3", w("List C", "القائمة ج"), ["area"], { fill: fill(3, 0.5), stroke: stroke(3, 1) }),
    preset("p-independent", w("Independents", "مستقلون"), ["area"], { fill: fill(5, 0.4), stroke: stroke(5, 1) }),
    preset("p-pending", w("Count incomplete", "فرز غير مكتمل"), ["area"], {
      fill: fill(7, 0.2, "hatch"),
      stroke: stroke(7, 1, "dashed"),
    }),
    preset("p-seats", w("Seats", "عدد المقاعد"), ["point"], { iconColor: slot(5) }),
  ];
}

/** The settings a new map starts with. */
export function templateSettings(id: TemplateSummary["id"], uiDir: Dir): MapSettings {
  const w: Words = (english, arabic) => (uiDir === "rtl" ? ar(arabic) : en(english));
  const labelLanguage = uiDir === "rtl" ? "ar" : "en";
  const legendTitle = w("Key", "مفتاح الخريطة");
  const approximate = w("Locations are approximate", "المواقع تقريبية");

  switch (id) {
    case "blank":
      return makeSettings({ ...REGION, labelLanguage, presets: [], groups: [], legendTitle, showLegend: false });
    case "conflict-tracker":
      return makeSettings({
        ...REGION,
        labelLanguage,
        presets: conflictPresets(w),
        groups: [
          ["g-notes", w("Notes", "ملاحظات")],
          ["g-events", w("Events", "الأحداث")],
          ["g-front", w("Front line and movements", "خط التماس والتحركات")],
          ["g-control", w("Control", "مناطق السيطرة")],
        ],
        legendTitle,
        titleBlock: { note: approximate },
        timeline: { enabled: true, mode: "moving", speed: 43_200, windowMs: 172_800_000 },
      });
    case "storm-track":
      return makeSettings({
        center: [60, 20],
        zoom: 4.2,
        labelLanguage,
        presets: stormPresets(w),
        groups: [
          ["g-notes", w("Notes", "ملاحظات")],
          ["g-shelters", w("Shelters", "مراكز الإيواء")],
          ["g-track", w("Track", "المسار")],
          ["g-forecast", w("Forecast", "التوقعات")],
          ["g-warnings", w("Warnings", "التحذيرات")],
        ],
        legendTitle,
        titleBlock: { note: w("Forecast positions are uncertain", "المواقع المتوقعة غير مؤكدة") },
        timeline: { enabled: true, mode: "cumulative", speed: 7200, windowMs: 21_600_000 },
      });
    case "regional-results":
      return makeSettings({
        ...REGION,
        labelLanguage,
        presets: resultsPresets(w),
        groups: [
          ["g-notes", w("Notes", "ملاحظات")],
          ["g-seats", w("Seats", "المقاعد")],
          ["g-results", w("Results by region", "النتائج حسب المنطقة")],
        ],
        legendTitle: w("Leading list", "القائمة المتصدّرة"),
        legendItems: resultsPresets(w)
          .filter((p) => p.id !== "p-seats")
          .map((p) => ({ ref: { presetId: p.id }, label: null, hidden: false })),
        legendPosition: "bottom-end",
      });
  }
}
