import type { Lang } from "@/i18n";
import type { FeatureKind, RichText, TextDir } from "@/model/types";

/** A string in both interface languages. Pick with `label[lang]`. */
export type Bilingual = Record<Lang, string>;

/** Shorthand for a `Bilingual`. */
export function bi(en: string, ar: string): Bilingual {
  return { en, ar };
}

/** Shorthand for a `RichText`. */
export function rich(value: string, dir: TextDir = "auto"): RichText {
  return { value, dir };
}

/** What each feature kind is called in the interface. */
export const KIND_NAMES: Record<FeatureKind, Bilingual> = {
  area: bi("Area", "منطقة"),
  line: bi("Line", "خط"),
  arrow: bi("Arrow", "سهم"),
  frontline: bi("Front line", "خط جبهة"),
  point: bi("Icon", "رمز"),
  annotation: bi("Text", "نص"),
};

function arabicCounted(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n % 100 >= 3 && n % 100 <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** "1 feature", "3 features" and the Arabic counted forms, with Western digits. */
export function countFeatures(n: number): Bilingual {
  return {
    en: n === 1 ? "1 feature" : `${n} features`,
    ar: arabicCounted(n, "عنصر واحد", "عنصران", "عناصر", "عنصرًا"),
  };
}

/** The object of a step label: "feature" / "3 features", with the Arabic counted forms. */
export function featuresNoun(n: number): Bilingual {
  return {
    en: n === 1 ? "feature" : `${n} features`,
    ar: n === 1 ? "العنصر" : arabicCounted(n, "عنصر", "عنصرين", "عناصر", "عنصرًا"),
  };
}

/** A step label with a count: "Move feature", "Move 3 features". */
export function verbFeatures(verbEn: string, verbAr: string, n: number): Bilingual {
  const noun = featuresNoun(n);
  return { en: `${verbEn} ${noun.en}`, ar: `${verbAr} ${noun.ar}` };
}

/** A fresh id for a feature, group, preset or lineage. */
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
