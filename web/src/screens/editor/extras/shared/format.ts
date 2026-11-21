import { LOCALE, type Lang } from "@/i18n";
import type { RichText } from "@/model/types";

/** True on Apple platforms, where `Mod` is Command. */
export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

/** "3 Oct 2021, 20:00": a moment in the editor's zone, to the minute, with Western digits. */
export function formatMoment(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}

/** "GMT+4": the zone the moments are shown in. */
export function zoneName(ms: number, lang: Lang): string {
  const parts = new Intl.DateTimeFormat(LOCALE[lang], { timeZoneName: "short" }).formatToParts(ms);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/** "1.2 MB", "340 KB" */
export function formatBytes(bytes: number, lang: Lang): string {
  const number = new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 1 });
  if (bytes >= 1_000_000) return `${number.format(bytes / 1_000_000)} MB`;
  return `${number.format(Math.max(1, Math.round(bytes / 1000)))} KB`;
}

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/** The direction of the first strong character; null when the text has none. */
export function firstStrongDir(text: string): "ltr" | "rtl" | null {
  for (const char of text) {
    if (RTL_CHAR.test(char)) return "rtl";
    if (LTR_CHAR.test(char)) return "ltr";
  }
  return null;
}

/** The direction a rich text renders in, given the direction around it. */
export function effectiveDir(text: RichText, fallback: "ltr" | "rtl"): "ltr" | "rtl" {
  if (text.dir !== "auto") return text.dir;
  return firstStrongDir(text.value) ?? fallback;
}

/** Start a browser download of a blob under a file name. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
