import { newId } from "@/editor/store";
import type { Lang } from "@/i18n";
import type { DashStyle, FeatureKind, FillPattern, PaletteSlot, StylePreset } from "@/model/types";

export type StarterId = "conflict" | "storm";

interface StarterPreset {
  name: Record<Lang, string>;
  appliesTo: FeatureKind[];
  slot: PaletteSlot;
  /** Left out for presets that only draw a line. */
  fill?: { opacity: number; pattern: FillPattern };
  stroke: { width: number; dash: DashStyle };
}

/**
 * Starter sets. The conflict set names states, not sides: one colour, with
 * solid, hatched and cross-hatched fills carrying the degree of certainty, so
 * it reads in print and for colour-blind readers too.
 */
const STARTERS: Record<StarterId, StarterPreset[]> = {
  conflict: [
    { name: { en: "Controlled", ar: "سيطرة مؤكدة" }, appliesTo: ["area"], slot: 1, fill: { opacity: 0.4, pattern: "none" }, stroke: { width: 1.5, dash: "solid" } },
    { name: { en: "Claimed", ar: "سيطرة مُعلنة" }, appliesTo: ["area"], slot: 1, fill: { opacity: 0.3, pattern: "hatch" }, stroke: { width: 1.5, dash: "dashed" } },
    { name: { en: "Contested", ar: "مناطق متنازع عليها" }, appliesTo: ["area"], slot: 3, fill: { opacity: 0.35, pattern: "cross" }, stroke: { width: 1.5, dash: "dotted" } },
    { name: { en: "Front line", ar: "خط الجبهة" }, appliesTo: ["frontline", "line"], slot: 1, stroke: { width: 2.5, dash: "solid" } },
  ],
  storm: [
    { name: { en: "Red warning", ar: "إنذار أحمر" }, appliesTo: ["area"], slot: 1, fill: { opacity: 0.35, pattern: "none" }, stroke: { width: 1.5, dash: "solid" } },
    { name: { en: "Orange warning", ar: "إنذار برتقالي" }, appliesTo: ["area"], slot: 3, fill: { opacity: 0.35, pattern: "none" }, stroke: { width: 1.5, dash: "solid" } },
    { name: { en: "Forecast cone", ar: "مخروط التوقعات" }, appliesTo: ["area"], slot: 5, fill: { opacity: 0.2, pattern: "hatch" }, stroke: { width: 1.5, dash: "dashed" } },
    { name: { en: "Observed track", ar: "المسار المرصود" }, appliesTo: ["line", "arrow"], slot: 2, stroke: { width: 3, dash: "solid" } },
    { name: { en: "Forecast track", ar: "المسار المتوقع" }, appliesTo: ["line", "arrow"], slot: 2, stroke: { width: 3, dash: "dashed" } },
  ],
};

/** The presets of a starter set that the map does not already have by name. */
export function starterPresets(id: StarterId, lang: Lang, existing: readonly StylePreset[]): StylePreset[] {
  const taken = new Set(existing.map((preset) => preset.name.value.trim()));
  return STARTERS[id]
    .filter((starter) => !taken.has(starter.name[lang]))
    .map((starter): StylePreset => {
      const color = { slot: starter.slot };
      return {
        id: newId(),
        name: { value: starter.name[lang], dir: lang === "ar" ? "rtl" : "ltr" },
        appliesTo: starter.appliesTo,
        ...(starter.fill !== undefined ? { fill: { color, ...starter.fill } } : {}),
        stroke: { color, opacity: 1, ...starter.stroke },
      };
    });
}

/** A new style to shape from scratch: every part present, in the first colour the map is not using. */
export function blankPreset(name: string, lang: Lang, existing: readonly StylePreset[]): StylePreset {
  const used = new Set(existing.flatMap((preset) => (preset.stroke !== undefined && "slot" in preset.stroke.color ? [preset.stroke.color.slot] : [])));
  const slots: PaletteSlot[] = [1, 2, 3, 4, 5, 6, 7, 8];
  const color = { slot: slots.find((slot) => !used.has(slot)) ?? 1 };
  return {
    id: newId(),
    name: { value: name, dir: lang === "ar" ? "rtl" : "ltr" },
    appliesTo: ["area", "line", "arrow", "frontline", "point"],
    fill: { color, opacity: 0.35, pattern: "none" },
    stroke: { color, width: 2, opacity: 1, dash: "solid" },
    iconColor: color,
  };
}
