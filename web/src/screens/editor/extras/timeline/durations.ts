import type { ExtrasStrings } from "@/i18n/editor-extras";
import { DAY, HOUR, MINUTE, WEEK } from "./ticks";

/** Playback speeds on offer, in seconds of map time per second of playback. */
export const SPEEDS = [HOUR / 1000, (2 * HOUR) / 1000, (6 * HOUR) / 1000, DAY / 1000, WEEK / 1000];

/** The speeds to list: the standard ones, plus the map's own when it is none of them. */
export function speedChoices(current: number): number[] {
  return SPEEDS.includes(current) ? SPEEDS : [...SPEEDS, current].sort((a, b) => a - b);
}

/** A span of map time in words: "6 h", "1 day", "2 weeks". */
export function durationLabel(ms: number, t: ExtrasStrings["timeline"]): string {
  if (ms >= WEEK && ms % WEEK === 0) return t.weeks(ms / WEEK);
  if (ms >= DAY && ms % DAY === 0) return t.days(ms / DAY);
  if (ms >= HOUR && ms % HOUR === 0) return t.hours(ms / HOUR);
  if (ms >= HOUR) return t.hours(Math.round((ms / HOUR) * 10) / 10);
  return t.minutes(Math.max(1, Math.round(ms / MINUTE)));
}

/** A playback speed in words: "6 h/s". */
export function speedLabel(speed: number, t: ExtrasStrings["timeline"]): string {
  return t.perSecond(durationLabel(speed * 1000, t));
}
