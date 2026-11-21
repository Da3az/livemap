import { LOCALE, type Lang } from "@/i18n";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

type Unit = "hour" | "day" | "month" | "year";

interface Step {
  unit: Unit;
  count: number;
  /** Roughly how long one step is, for choosing between them. */
  ms: number;
}

const STEPS: Step[] = [
  { unit: "hour", count: 1, ms: HOUR },
  { unit: "hour", count: 3, ms: 3 * HOUR },
  { unit: "hour", count: 6, ms: 6 * HOUR },
  { unit: "hour", count: 12, ms: 12 * HOUR },
  { unit: "day", count: 1, ms: DAY },
  { unit: "day", count: 2, ms: 2 * DAY },
  { unit: "day", count: 4, ms: 4 * DAY },
  { unit: "day", count: 7, ms: WEEK },
  { unit: "day", count: 14, ms: 2 * WEEK },
  { unit: "month", count: 1, ms: 30 * DAY },
  { unit: "month", count: 3, ms: 91 * DAY },
  { unit: "month", count: 6, ms: 182 * DAY },
  { unit: "year", count: 1, ms: 365 * DAY },
  { unit: "year", count: 5, ms: 5 * 365 * DAY },
  { unit: "year", count: 10, ms: 10 * 365 * DAY },
];

export interface Tick {
  ms: number;
  label: string;
  /** A day boundary among hours, a year boundary among months. */
  major: boolean;
}

const MIN_GAP_PX = 58;
const MAX_TICKS = 120;

function chooseStep(spanMs: number, widthPx: number): Step {
  const fit = Math.max(1, Math.floor(widthPx / MIN_GAP_PX));
  return STEPS.find((step) => spanMs / step.ms <= fit) ?? STEPS[STEPS.length - 1] ?? { unit: "year", count: 10, ms: 10 * 365 * DAY };
}

/** The first boundary of the step at or after `fromMs`, in the editor's zone. */
function firstBoundary(fromMs: number, step: Step): Date {
  const date = new Date(fromMs);
  if (step.unit === "hour") {
    date.setMinutes(0, 0, 0);
    date.setHours(Math.floor(date.getHours() / step.count) * step.count);
  } else if (step.unit === "day") {
    date.setHours(0, 0, 0, 0);
  } else if (step.unit === "month") {
    date.setHours(0, 0, 0, 0);
    date.setDate(1);
    date.setMonth(Math.floor(date.getMonth() / step.count) * step.count);
  } else {
    date.setHours(0, 0, 0, 0);
    date.setMonth(0, 1);
    date.setFullYear(Math.floor(date.getFullYear() / step.count) * step.count);
  }
  while (date.getTime() < fromMs) advance(date, step);
  return date;
}

function advance(date: Date, step: Step): void {
  if (step.unit === "hour") date.setHours(date.getHours() + step.count);
  else if (step.unit === "day") date.setDate(date.getDate() + step.count);
  else if (step.unit === "month") date.setMonth(date.getMonth() + step.count);
  else date.setFullYear(date.getFullYear() + step.count);
}

/**
 * Date ticks for a span drawn `widthPx` wide: hours with the date at each
 * midnight, then days, weeks, months or years as the span grows.
 */
export function buildTicks(fromMs: number, toMs: number, widthPx: number, lang: Lang): Tick[] {
  if (!(toMs > fromMs) || widthPx <= 0) return [];
  const step = chooseStep(toMs - fromMs, widthPx);
  const locale = LOCALE[lang];
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const month = new Intl.DateTimeFormat(locale, { month: "short" });
  const monthYear = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" });
  const year = new Intl.DateTimeFormat(locale, { year: "numeric" });

  const ticks: Tick[] = [];
  const date = firstBoundary(fromMs, step);
  while (date.getTime() <= toMs && ticks.length < MAX_TICKS) {
    const ms = date.getTime();
    if (step.unit === "hour") {
      const midnight = date.getHours() === 0;
      ticks.push({ ms, label: midnight ? day.format(ms) : time.format(ms), major: midnight });
    } else if (step.unit === "day") {
      ticks.push({ ms, label: day.format(ms), major: date.getDate() === 1 });
    } else if (step.unit === "month") {
      const january = date.getMonth() === 0;
      ticks.push({ ms, label: january || ticks.length === 0 ? monthYear.format(ms) : month.format(ms), major: january });
    } else {
      ticks.push({ ms, label: year.format(ms), major: false });
    }
    advance(date, step);
  }
  return ticks;
}

const KEY_STEPS = [10 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, WEEK, 30 * DAY];

function largestUpTo(limit: number): number {
  let chosen = KEY_STEPS[0] ?? MINUTE;
  for (const step of KEY_STEPS) if (step <= limit) chosen = step;
  return chosen;
}

/** How far an arrow key moves the playhead, and how far with Shift held. */
export function keySteps(spanMs: number): { fine: number; coarse: number } {
  const fine = largestUpTo(spanMs / 60);
  return { fine, coarse: Math.max(largestUpTo(spanMs / 8), fine * 2) };
}

/** The moving-window widths offered for a span: the round ones that are narrower than it. */
export function windowChoices(spanMs: number | null, current: number): number[] {
  const all = [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 3 * DAY, WEEK, 2 * WEEK, 30 * DAY];
  const fitting = spanMs === null ? all : all.filter((width) => width < spanMs && width >= spanMs / 200).slice(-6);
  /* The map's own width stays on the list, even when it was dragged to something in between. */
  return fitting.includes(current) ? fitting : [...fitting, current].sort((a, b) => a - b);
}
