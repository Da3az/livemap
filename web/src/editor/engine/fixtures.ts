import type { IconId, LngLat, MapFeature, MapSettings, PaletteSlot, RichText, Viewport } from "@/model/types";

/**
 * A map for the harness: Cyclone Shaheen's landfall on Oman's Batinah coast,
 * 3 October 2021. Every feature kind and every style option appears at least once.
 */

export const FIXTURE_TITLE: Record<"ltr" | "rtl", RichText> = {
  ltr: { value: "Cyclone Shaheen: landfall on the Batinah coast", dir: "ltr" },
  rtl: { value: "إعصار شاهين يضرب ساحل الباطنة", dir: "rtl" },
};

export const FIXTURE_VIEWPORT: Viewport = { center: [57.55, 23.82], zoom: 8.2, bearing: 0, pitch: 0 };

export const FIXTURE_TIME = { from: "2021-10-02T00:00:00Z", to: "2021-10-05T00:00:00Z" };

export function fixtureSettings(dir: "ltr" | "rtl"): MapSettings {
  const text = (en: string, ar: string): RichText => (dir === "rtl" ? { value: ar, dir: "rtl" } : { value: en, dir: "ltr" });
  return {
    basemap: { styleId: "positron", labelLanguage: dir === "rtl" ? "ar" : "en" },
    openingView: FIXTURE_VIEWPORT,
    presets: [
      {
        id: "preset-flood",
        name: text("Flooded area", "منطقة غمرتها المياه"),
        appliesTo: ["area"],
        fill: { color: { slot: 6 }, opacity: 0.45, pattern: "hatch" },
        stroke: { color: { slot: 6 }, width: 1.5, opacity: 1, dash: "solid" },
      },
      {
        id: "preset-evacuation",
        name: text("Evacuation zone", "منطقة إخلاء"),
        appliesTo: ["area"],
        fill: { color: { slot: 3 }, opacity: 0.3, pattern: "dots" },
        stroke: { color: { slot: 3 }, width: 2, opacity: 1, dash: "dashed" },
      },
      {
        id: "preset-closed",
        name: text("Road closed", "طريق مغلق"),
        appliesTo: ["line"],
        stroke: { color: { slot: 1 }, width: 3, opacity: 1, dash: "dashed" },
      },
      {
        id: "preset-track",
        name: text("Storm track", "مسار الإعصار"),
        appliesTo: ["arrow"],
        stroke: { color: { slot: 5 }, width: 5, opacity: 1, dash: "solid" },
      },
      {
        id: "preset-surge",
        name: text("Storm surge front", "جبهة المدّ العاصفي"),
        appliesTo: ["frontline"],
        stroke: { color: { slot: 1 }, width: 2.5, opacity: 1, dash: "solid" },
      },
      { id: "preset-shelter", name: text("Shelter", "مركز إيواء"), appliesTo: ["point"], iconColor: { slot: 4 } },
      { id: "preset-unused", name: text("Power cut", "انقطاع الكهرباء"), appliesTo: ["area"], fill: { color: { slot: 7 }, opacity: 0.4, pattern: "none" } },
    ],
    groups: [
      { id: "group-impact", name: text("Impact", "الأضرار"), order: "a", hidden: false, locked: false, collapsed: false },
      { id: "group-drafts", name: text("Drafts", "مسودات"), order: "b", hidden: true, locked: false, collapsed: false },
    ],
    legend: { show: true, title: text("Key", "مفتاح الخريطة"), position: "bottom-start", items: [] },
    titleBlock: {
      show: true,
      subtitle: text("Flooding, evacuations and road closures as the storm came ashore", "الفيضانات وعمليات الإخلاء وإغلاق الطرق مع وصول الإعصار إلى اليابسة"),
      source: text("Oman Civil Aviation Authority; National Committee for Emergency Management", "هيئة الطيران المدني العُمانية؛ اللجنة الوطنية لإدارة الحالات الطارئة"),
      credit: text("Graphic: livemap desk", "إعداد: قسم الخرائط"),
      note: text("Locations are approximate", "المواقع تقريبية"),
      asOf: "2021-10-03T18:30:00Z",
    },
    timeline: { enabled: true, mode: "moving", speed: 3600, windowMs: 86_400_000 },
    embed: { legend: true, zoomButtons: true, scaleBar: true, cooperativeGestures: true, static: false, theme: "auto" },
  };
}

const AUTHOR = "user-mariam";
const UPDATED = "2021-10-03T18:30:00Z";

export function base(id: string, order: string, name: string, extra: Partial<MapFeature> = {}) {
  return {
    id,
    order,
    name: { value: name, dir: "ltr" as const },
    groupId: null,
    hidden: false,
    locked: false,
    presetId: null,
    validFrom: null,
    validTo: null,
    lineageId: null,
    updatedAt: UPDATED,
    updatedBy: AUTHOR,
    ...extra,
  };
}

export const SLOTS: PaletteSlot[] = [1, 2, 3, 4, 5, 6, 7, 8];
export const ICONS: IconId[] = ["strike", "explosion", "checkpoint", "shelter", "hospital", "flood", "fire", "airport", "port", "camp", "aid", "pin"];

function iconRow(): MapFeature[] {
  return ICONS.map((icon, index) => {
    const slot = SLOTS[index % SLOTS.length] ?? 1;
    const at: LngLat = [56.35 + index * 0.215, 23.02];
    return {
      ...base(`icon-${icon}`, `m${String(index).padStart(2, "0")}`, `Icon: ${icon}`),
      kind: "point",
      at,
      symbol: { icon },
      color: { slot },
      size: 26,
      label: { value: icon, dir: "ltr" },
      labelStyle: { color: "ink", size: 11, weight: 400, halo: true, box: false },
    };
  });
}

export function fixtureFeatures(): MapFeature[] {
  return [
    /* A thick line with a LOWER order than the warning area that covers it: it must show through the fill. */
    {
      ...base("line-under-area", "a0", "Coastal highway (under the warning area)"),
      kind: "line",
      path: [
        [56.62, 24.42],
        [56.86, 24.2],
        [57.08, 23.99],
        [57.42, 23.86],
        [57.86, 23.7],
        [58.2, 23.66],
      ],
      stroke: { color: { slot: 8 }, width: 6, opacity: 1, dash: "solid" },
    },
    {
      ...base("area-warning", "b0", "Cyclone warning area", { validFrom: "2021-10-02T00:00:00Z" }),
      kind: "area",
      rings: [
        [
          [56.3, 24.75],
          [58.75, 24.75],
          [58.75, 23.25],
          [57.9, 23.1],
          [56.3, 23.45],
          [56.3, 24.75],
        ],
        /* a hole: the interior around Rustaq was outside the warning */
        [
          [57.22, 23.52],
          [57.62, 23.52],
          [57.62, 23.28],
          [57.22, 23.28],
          [57.22, 23.52],
        ],
      ],
      fill: { color: { slot: 2 }, opacity: 0.16, pattern: "cross" },
      stroke: { color: { slot: 2 }, width: 1.5, opacity: 1, dash: "dotted" },
      label: { value: "Cyclone warning in force", dir: "ltr" },
      labelStyle: { color: { slot: 2 }, size: 12, weight: 600, halo: false, box: true },
    },
    {
      ...base("area-flood", "c0", "Flooding, Al Khaburah", { presetId: "preset-flood", validFrom: "2021-10-03T16:00:00Z", groupId: "group-impact" }),
      kind: "area",
      rings: [
        [
          [56.98, 24.06],
          [57.16, 23.98],
          [57.3, 23.9],
          [57.24, 23.78],
          [57.02, 23.84],
          [56.9, 23.96],
          [56.98, 24.06],
        ],
      ],
      fill: { color: { slot: 1 }, opacity: 1, pattern: "none" },
      stroke: { color: { slot: 1 }, width: 1, opacity: 1, dash: "solid" },
      label: { value: "منطقة غمرتها المياه", dir: "rtl" },
      labelStyle: { color: "ink", size: 13, weight: 600, halo: true, box: false },
    },
    {
      ...base("area-evacuation", "c5", "Evacuation zone, Al Suwaiq", {
        presetId: "preset-evacuation",
        validFrom: "2021-10-02T12:00:00Z",
        validTo: "2021-10-04T06:00:00Z",
        groupId: "group-impact",
      }),
      kind: "area",
      rings: [
        [
          [57.3, 23.9],
          [57.56, 23.82],
          [57.7, 23.74],
          [57.62, 23.62],
          [57.36, 23.7],
          [57.24, 23.78],
          [57.3, 23.9],
        ],
      ],
      fill: { color: { slot: 1 }, opacity: 1, pattern: "none" },
      stroke: { color: { slot: 1 }, width: 1, opacity: 1, dash: "solid" },
    },
    {
      ...base("area-plain", "c8", "Power restored, Seeb (ochre, no outline)", { validFrom: "2021-10-04T00:00:00Z" }),
      kind: "area",
      rings: [
        [
          [58.05, 23.72],
          [58.32, 23.68],
          [58.34, 23.52],
          [58.08, 23.54],
          [58.05, 23.72],
        ],
      ],
      fill: { color: { slot: 3 }, opacity: 0.5, pattern: "none" },
      stroke: { color: { slot: 3 }, width: 0, opacity: 1, dash: "solid" },
    },
    {
      ...base("line-closed", "d0", "Batinah Expressway closed", { presetId: "preset-closed", validFrom: "2021-10-03T10:00:00Z" }),
      kind: "line",
      path: [
        [56.78, 24.22],
        [57.0, 23.9],
        [57.3, 23.72],
        [57.74, 23.58],
        [58.1, 23.5],
      ],
      stroke: { color: { slot: 2 }, width: 2, opacity: 1, dash: "solid" },
      label: { value: "Expressway closed", dir: "ltr" },
    },
    {
      ...base("line-ferry", "d2", "Ferry suspended (dotted, sky: cased)"),
      kind: "line",
      path: [
        [58.56, 23.63],
        [58.4, 24.1],
        [57.9, 24.5],
      ],
      stroke: { color: { slot: 6 }, width: 3, opacity: 1, dash: "dotted" },
    },
    {
      ...base("line-custom", "d4", "Power line down (custom dash, ochre: cased)"),
      kind: "line",
      path: [
        [56.45, 23.3],
        [56.9, 23.6],
        [57.15, 23.2],
      ],
      stroke: { color: { slot: 3 }, width: 3, opacity: 1, dash: { custom: [12, 4, 2, 4] } },
    },
    {
      ...base("arrow-track", "e0", "Track of Shaheen", { presetId: "preset-track", validFrom: "2021-10-02T00:00:00Z" }),
      kind: "arrow",
      control: [
        [58.95, 24.62],
        [58.3, 24.5],
        [57.85, 24.12],
        [57.46, 23.88],
      ],
      curvature: 1,
      head: "single",
      tapered: true,
      stroke: { color: { slot: 1 }, width: 2, opacity: 1, dash: "solid" },
      label: { value: "Shaheen", dir: "ltr" },
      labelStyle: { color: { slot: 5 }, size: 14, weight: 600, halo: true, box: false },
    },
    {
      ...base("arrow-evacuation", "e2", "Evacuation route (double head, dashed)", { validFrom: "2021-10-02T12:00:00Z" }),
      kind: "arrow",
      control: [
        [57.44, 23.8],
        [57.3, 23.6],
        [57.42, 23.4],
      ],
      curvature: 0.7,
      head: "double",
      tapered: false,
      stroke: { color: { slot: 4 }, width: 3, opacity: 1, dash: "dashed" },
    },
    {
      ...base("arrow-straight", "e4", "Relief convoy (no head, straight segments)"),
      kind: "arrow",
      control: [
        [58.4, 23.56],
        [58.1, 23.36],
        [57.84, 23.4],
      ],
      curvature: 0,
      head: "none",
      tapered: false,
      stroke: { color: { slot: 7 }, width: 3, opacity: 1, dash: "solid" },
    },
    {
      ...base("arrow-weak", "e6", "Rainfall band (ochre: cased, single head)"),
      kind: "arrow",
      control: [
        [56.5, 24.6],
        [56.9, 24.52],
        [57.25, 24.3],
      ],
      curvature: 1,
      head: "single",
      tapered: false,
      stroke: { color: { slot: 3 }, width: 4, opacity: 1, dash: "solid" },
    },
    {
      ...base("arrow-arc", "e7", "Displacement toward Ibri (two points, arc to the right)"),
      kind: "arrow",
      control: [
        [56.62, 23.62],
        [56.35, 23.2],
      ],
      curvature: 1,
      bend: "right",
      head: "single",
      tapered: false,
      stroke: { color: { slot: 2 }, width: 3, opacity: 1, dash: "solid" },
    },
    {
      ...base("arrow-dashed-taper", "e8", "Expected track (two points, tapered and dashed)"),
      kind: "arrow",
      control: [
        [59.2, 23.3],
        [58.75, 23.0],
      ],
      curvature: 0.6,
      head: "single",
      tapered: true,
      stroke: { color: { slot: 5 }, width: 2, opacity: 1, dash: "dashed" },
    },
    {
      ...base("front-surge", "f0", "Storm surge front", { presetId: "preset-surge", validFrom: "2021-10-03T12:00:00Z" }),
      kind: "frontline",
      path: [
        [56.84, 24.36],
        [57.12, 24.1],
        [57.46, 23.98],
        [57.9, 23.82],
        [58.3, 23.8],
      ],
      facing: "right",
      toothShape: "triangle",
      toothSpacing: 22,
      toothSize: 9,
      stroke: { color: { slot: 2 }, width: 2, opacity: 1, dash: "solid" },
    },
    {
      ...base("front-rain", "f2", "Leading edge of heavy rain (semicircles)"),
      kind: "frontline",
      path: [
        [56.42, 24.0],
        [56.6, 23.7],
        [56.95, 23.42],
        [57.2, 23.14],
      ],
      facing: "left",
      toothShape: "semicircle",
      toothSpacing: 26,
      toothSize: 11,
      stroke: { color: { slot: 2 }, width: 2.5, opacity: 1, dash: "solid" },
    },
    ...iconRow(),
    {
      ...base("point-shelter-1", "n0", "Shelter, Al Suwaiq school", { presetId: "preset-shelter", validFrom: "2021-10-02T12:00:00Z" }),
      kind: "point",
      at: [57.52, 23.66],
      symbol: { icon: "shelter" },
      color: { slot: 1 },
      size: 26,
    },
    {
      ...base("point-1", "n2", "Event 1"),
      kind: "point",
      at: [57.44, 23.85],
      symbol: { number: "1" },
      color: { slot: 1 },
      size: 26,
      label: { value: "Landfall, 20:00", dir: "ltr" },
    },
    {
      ...base("point-12", "n3", "Event 12"),
      kind: "point",
      at: [57.09, 23.97],
      symbol: { number: "12" },
      color: { slot: 2 },
      size: 26,
    },
    {
      ...base("point-105", "n4", "Event 105 (locked)", { locked: true }),
      kind: "point",
      at: [58.19, 23.67],
      symbol: { number: "105" },
      color: { slot: 3 },
      size: 30,
      label: { value: "Seeb (locked)", dir: "ltr" },
    },
    {
      ...base("annotation-landfall", "p0", "Note: landfall"),
      kind: "annotation",
      anchor: [57.44, 23.9],
      textAt: [57.2, 24.42],
      text: { value: "Shaheen came ashore near Al Suwaiq\nwith winds of 120–150 km/h", dir: "ltr" },
      labelStyle: { color: "ink", size: 13, weight: 600, halo: true, box: true },
      leader: { shape: "elbow", anchorDot: true },
    },
    {
      ...base("annotation-arabic", "p2", "Note: Arabic"),
      kind: "annotation",
      anchor: [56.98, 23.93],
      textAt: [56.62, 23.9],
      text: { value: "الخابورة: أكثر من 300 ملم\nمن الأمطار خلال 24 ساعة", dir: "rtl" },
      labelStyle: { color: "ink", size: 13, weight: 600, halo: true, box: false },
      leader: { shape: "straight", anchorDot: true },
    },
    {
      ...base("annotation-free", "p4", "Note: sea name, no leader"),
      kind: "annotation",
      anchor: [58.3, 24.25],
      textAt: [58.3, 24.25],
      text: { value: "Sea of Oman", dir: "ltr" },
      labelStyle: { color: { slot: 2 }, size: 15, weight: 400, halo: true, box: false },
      leader: null,
    },
    {
      ...base("hidden-feature", "q0", "Hidden: must never be drawn", { hidden: true }),
      kind: "area",
      rings: [
        [
          [57.6, 24.6],
          [58.0, 24.6],
          [58.0, 24.3],
          [57.6, 24.3],
          [57.6, 24.6],
        ],
      ],
      fill: { color: { custom: "#ff00ff" }, opacity: 1, pattern: "none" },
      stroke: { color: { custom: "#ff00ff" }, width: 4, opacity: 1, dash: "solid" },
    },
    {
      ...base("hidden-by-group", "q2", "In a hidden group: must never be drawn", { groupId: "group-drafts" }),
      kind: "line",
      path: [
        [56.4, 24.7],
        [58.7, 23.2],
      ],
      stroke: { color: { custom: "#ff00ff" }, width: 8, opacity: 1, dash: "solid" },
    },
  ];
}

/** `count` plausible features around the fixture area, for measuring the renderer under load. */
