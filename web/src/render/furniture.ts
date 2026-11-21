import { LOCALE, type Lang } from "@/i18n";
import type { MapFeature, MapSettings, RichText } from "@/model/types";
import { FURNITURE_STRINGS } from "./strings";

/** The parts of the map's furniture that the React components and the exported image both need. */

export interface LegendEntry {
  key: string;
  label: RichText;
  /** A feature drawn with the entry's style; the swatch paints it with the map's own code. */
  sample: MapFeature;
}

function isShown(feature: MapFeature, settings: MapSettings): boolean {
  if (feature.hidden) return false;
  const group = feature.groupId === null ? undefined : settings.groups.find((candidate) => candidate.id === feature.groupId);
  return group?.hidden !== true;
}

/**
 * The legend's rows. With explicit items, those in their order; otherwise
 * every preset in the settings' order. Either way a preset appears only while
 * a visible feature uses it, so the key never explains something that is not
 * on the map.
 */
export function legendEntries(settings: MapSettings, features: readonly MapFeature[]): LegendEntry[] {
  const shown = features.filter((feature) => isShown(feature, settings));
  const firstUse = new Map<string, MapFeature>();
  for (const feature of shown) {
    if (feature.presetId !== null && !firstUse.has(feature.presetId)) firstUse.set(feature.presetId, feature);
  }
  const forPreset = (presetId: string, label: RichText | null): LegendEntry[] => {
    const preset = settings.presets.find((candidate) => candidate.id === presetId);
    const sample = firstUse.get(presetId);
    return preset && sample ? [{ key: `preset:${presetId}`, label: label ?? preset.name, sample }] : [];
  };

  if (settings.legend.items.length === 0) return settings.presets.flatMap((preset) => forPreset(preset.id, null));

  return settings.legend.items.flatMap((item) => {
    if (item.hidden) return [];
    if ("presetId" in item.ref) return forPreset(item.ref.presetId, item.label);
    const { featureId } = item.ref;
    const feature = shown.find((candidate) => candidate.id === featureId);
    return feature ? [{ key: `feature:${featureId}`, label: item.label ?? feature.label ?? feature.name, sample: feature }] : [];
  });
}

export function langForDir(dir: "ltr" | "rtl"): Lang {
  return dir === "rtl" ? "ar" : "en";
}

/** "As of 3 October 2021 at 18:00 GMT+4": the moment in the reader's zone, with the zone named. */
export function formatAsOf(asOf: string, lang: Lang): string {
  const time = new Date(asOf);
  if (Number.isNaN(time.getTime())) return "";
  const formatted = new Intl.DateTimeFormat(LOCALE[lang], {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(time);
  return `${FURNITURE_STRINGS[lang].asOf} ${formatted}`;
}

export function sourceLine(source: RichText, lang: Lang): RichText {
  const word = FURNITURE_STRINGS[lang].source;
  /* Desks often type the word themselves ("Sources: …"); it is not printed twice. */
  if (source.value.trimStart().startsWith(word)) return source;
  return { value: `${word}: ${source.value}`, dir: source.dir };
}

export interface ScaleBarModel {
  /** Width of the bar in CSS pixels. */
  width: number;
  label: string;
}

const METRES_PER_FOOT = 0.3048;
const FEET_PER_MILE = 5280;

function niceBelow(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const leading = value / magnitude;
  return (leading >= 5 ? 5 : leading >= 2 ? 2 : 1) * magnitude;
}

/** The longest round distance that fits in `maxWidth` pixels at the given resolution. */
export function scaleBar(metresPerPixel: number, lang: Lang, options: { maxWidth?: number; units?: "metric" | "imperial" } = {}): ScaleBarModel | null {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return null;
  const strings = FURNITURE_STRINGS[lang];
  const maxMetres = metresPerPixel * (options.maxWidth ?? 96);
  const number = new Intl.NumberFormat(LOCALE[lang]);
  if (options.units === "imperial") {
    const maxFeet = maxMetres / METRES_PER_FOOT;
    if (maxFeet >= FEET_PER_MILE) {
      const miles = niceBelow(maxFeet / FEET_PER_MILE);
      return { width: (miles * FEET_PER_MILE * METRES_PER_FOOT) / metresPerPixel, label: `${number.format(miles)} ${strings.mi}` };
    }
    const feet = niceBelow(maxFeet);
    return { width: (feet * METRES_PER_FOOT) / metresPerPixel, label: `${number.format(feet)} ${strings.ft}` };
  }
  const metres = niceBelow(maxMetres);
  const label = metres >= 1000 ? `${number.format(metres / 1000)} ${strings.km}` : `${number.format(metres)} ${strings.m}`;
  return { width: metres / metresPerPixel, label };
}
