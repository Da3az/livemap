import type { Lang } from "@/i18n";

/**
 * Words on the map's furniture. They are a plain dictionary instead of a
 * `defineStrings` hook because an exported image draws them on a canvas,
 * outside React, and because the language follows the map's direction, not
 * the interface language of whoever is looking at it.
 */
export const FURNITURE_STRINGS: Record<Lang, { asOf: string; source: string; km: string; m: string; mi: string; ft: string; scale: string }> = {
  en: { asOf: "As of", source: "Source", km: "km", m: "m", mi: "mi", ft: "ft", scale: "Scale" },
  ar: { asOf: "حتى", source: "المصدر", km: "كم", m: "م", mi: "ميل", ft: "قدم", scale: "مقياس الرسم" },
};
