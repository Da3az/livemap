import { defineStrings, type Lang } from "@/i18n";

/**
 * Words a reader sees on a published map. The language follows the map's
 * direction, never the reader's browser and never a query parameter.
 */

const en = {
  mapLabel: (title: string) => `Map: ${title}`,
  featureList: "What this map shows",

  key: "Key",
  showKey: "Show the key",
  hideKey: "Hide",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomGroup: "Zoom",
  close: "Close",

  timeline: "Timeline",
  time: "Time",
  play: "Play",
  pause: "Pause",
  replay: "Replay",
  earlier: "Earlier",
  later: "Later",
  upTo: "Up to",
  windowTo: (hours: number) => (hours >= 48 && hours % 24 === 0 ? `${hours / 24} days to` : hours >= 1 ? `${hours} hours to` : `${Math.round(hours * 60)} min to`),
  showing: (when: string, count: number) => `${when}. ${count === 1 ? "1 feature" : `${count} features`} shown.`,
  from: "From",
  until: "until",

  updated: (time: string) => `Updated ${time}`,
  dataFrom: "Data from",
  basemapFailed: "The background map did not load. Everything drawn on it is shown.",

  loading: "Loading the map",
  notPublished: "This map has not been published yet.",
  notFound: "There is no map at this address.",
  failed: "The map could not be loaded.",
  retry: "Try again",
  retrying: "Trying…",
  offline: "You are offline. The map will load when the connection returns.",
  offlineStale: "Offline. This is the last version that loaded.",
  updateFailed: "Could not check for a newer version.",

  gestureWindows: "Use Ctrl + scroll to zoom the map",
  gestureMac: "Use ⌘ + scroll to zoom the map",
  gestureMobile: "Use two fingers to move the map",
};

export type EmbedStrings = typeof en;

function arabicFeatures(count: number): string {
  if (count === 0) return "لا عناصر ظاهرة";
  if (count === 1) return "عنصر واحد ظاهر";
  if (count === 2) return "عنصران ظاهران";
  if (count % 100 >= 3 && count % 100 <= 10) return `${count} عناصر ظاهرة`;
  return `${count} عنصرًا ظاهرًا`;
}

const ar: EmbedStrings = {
  mapLabel: (title) => `خريطة: ${title}`,
  featureList: "ما تعرضه هذه الخريطة",

  key: "مفتاح الخريطة",
  showKey: "إظهار مفتاح الخريطة",
  hideKey: "إخفاء",
  zoomIn: "تكبير",
  zoomOut: "تصغير",
  zoomGroup: "التكبير والتصغير",
  close: "إغلاق",

  timeline: "الخط الزمني",
  time: "الوقت",
  play: "تشغيل",
  pause: "إيقاف مؤقت",
  replay: "إعادة",
  earlier: "السابق",
  later: "التالي",
  upTo: "حتى",
  windowTo: (hours) => (hours >= 48 && hours % 24 === 0 ? `آخر ${hours / 24} أيام حتى` : hours >= 1 ? `آخر ${hours} ساعة حتى` : `آخر ${Math.round(hours * 60)} دقيقة حتى`),
  showing: (when, count) => `${when}. ${arabicFeatures(count)}.`,
  from: "من",
  until: "حتى",

  updated: (time) => `آخر تحديث ${time}`,
  dataFrom: "البيانات من",
  basemapFailed: "تعذّر تحميل خريطة الأساس. كل ما رُسم فوقها ظاهر.",

  loading: "جارٍ تحميل الخريطة",
  notPublished: "لم تُنشر هذه الخريطة بعد.",
  notFound: "لا توجد خريطة على هذا العنوان.",
  failed: "تعذّر تحميل الخريطة.",
  retry: "أعد المحاولة",
  retrying: "جارٍ المحاولة…",
  offline: "لا يوجد اتصال بالإنترنت. ستُحمَّل الخريطة عند عودة الاتصال.",
  offlineStale: "لا يوجد اتصال. هذه آخر نسخة حُمّلت.",
  updateFailed: "تعذّر التحقق من وجود نسخة أحدث.",

  gestureWindows: "استخدم Ctrl مع التمرير لتكبير الخريطة",
  gestureMac: "استخدم ⌘ مع التمرير لتكبير الخريطة",
  gestureMobile: "استخدم إصبعين لتحريك الخريطة",
};

/** Both dictionaries, for the states where no map has loaded and its language is not known yet. */
export const EMBED_STRINGS: Record<Lang, EmbedStrings> = { en, ar };

export const useEmbedStrings = defineStrings({ en, ar });
