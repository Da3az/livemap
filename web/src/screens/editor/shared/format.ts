import { LOCALE, type Lang } from "@/i18n";

const UNITS: Record<Lang, { m: string; km: string; m2: string; km2: string }> = {
  en: { m: "m", km: "km", m2: "m²", km2: "km²" },
  ar: { m: "م", km: "كم", m2: "م²", km2: "كم²" },
};

function round(value: number, lang: Lang): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: digits }).format(value);
}

/** "412 m", "18.4 km" */
export function formatLength(metres: number, lang: Lang): string {
  const unit = UNITS[lang];
  return metres >= 1000 ? `${round(metres / 1000, lang)} ${unit.km}` : `${round(metres, lang)} ${unit.m}`;
}

/** "8,200 m²", "4,180 km²" */
export function formatArea(squareMetres: number, lang: Lang): string {
  const unit = UNITS[lang];
  return squareMetres >= 100_000 ? `${round(squareMetres / 1_000_000, lang)} ${unit.km2}` : `${round(squareMetres, lang)} ${unit.m2}`;
}

/** "14:32" */
export function formatClockTime(iso: string | number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** "3 Oct, 20:00" */
export function formatDayTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  );
}

/** "14:32" today, "3 Oct, 14:32" on another day. */
export function formatRecent(iso: string, lang: Lang, now: number = Date.now()): string {
  const then = new Date(iso);
  const sameDay = then.toDateString() === new Date(now).toDateString();
  return sameDay ? formatClockTime(iso, lang) : formatDayTime(iso, lang);
}

export function formatInteger(value: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE[lang]).format(value);
}

/** "23.8514° N, 57.4388° E" — the same digits and letters in both languages, so it pastes anywhere. */
export function formatLngLat(at: readonly [number, number]): string {
  const [lng, lat] = at;
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;
}

/** True on macOS and iOS, where shortcuts use Command. */
export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}
