import { useEffect, useState } from "react";
import { LOCALE, useLang, type Lang } from "@/i18n";
import { type ShellStrings, useShellStrings } from "@/i18n/shell";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The current time, refreshed on an interval, for text that has to stay true while it is on screen. */
export function useNow(intervalMs: number = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "21 Nov 2026, 14:05" */
export function formatAbsolute(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

/** "Sun 22 Nov, 14:05" */
export function formatDayAndTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

/** Relative for the last week, a date after that. */
export function formatPast(iso: string, now: number, lang: Lang, t: ShellStrings["time"]): string {
  const then = Date.parse(iso);
  const ago = Math.max(0, now - then);
  if (ago < 45_000) return t.justNow;
  if (ago < HOUR) return t.minutesAgo(Math.max(1, Math.round(ago / MINUTE)));
  if (ago < DAY) return t.hoursAgo(Math.floor(ago / HOUR));
  if (ago < 2 * DAY) return t.yesterday;
  if (ago < 7 * DAY) return t.daysAgo(Math.floor(ago / DAY));
  const sameYear = new Date(then).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(new Date(then));
}

/** "in 6 days", "in 23 h 58 min", "in 40 s" */
export function formatUntil(iso: string, now: number, t: ShellStrings["time"]): string {
  const left = Date.parse(iso) - now;
  if (left <= 0) return t.now;
  if (left >= 2 * DAY) return t.inDays(Math.floor(left / DAY));
  if (left >= HOUR) return t.inHours(Math.floor(left / HOUR), Math.floor((left % HOUR) / MINUTE));
  if (left >= MINUTE) return t.inMinutes(Math.floor(left / MINUTE));
  return t.inSeconds(Math.ceil(left / 1000));
}

/** The short form for a badge: "6 days left", "23 h left". */
export function formatLeft(iso: string, now: number, t: ShellStrings["time"]): string {
  const left = Math.max(0, Date.parse(iso) - now);
  if (left >= 2 * DAY) return t.leftDays(Math.floor(left / DAY));
  if (left >= HOUR) return t.leftHours(Math.floor(left / HOUR));
  return t.leftMinutes(Math.ceil(left / MINUTE));
}

/** A past moment: relative while recent, with the exact time on hover and for assistive technology. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const lang = useLang();
  const t = useShellStrings();
  const now = useNow();
  return (
    <time dateTime={iso} title={formatAbsolute(iso, lang)} className={className}>
      {formatPast(iso, now, lang, t.time)}
      <span className="sr-only">, {formatAbsolute(iso, lang)}</span>
    </time>
  );
}

/**
 * Whole seconds left until `until` (a `Date.now()` value), ticking while it is
 * above zero. null means there is nothing to wait for.
 */
export function useCountdown(until: number | null): number {
  const remaining = (): number => (until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  const [seconds, setSeconds] = useState(remaining);
  useEffect(() => {
    setSeconds(remaining());
    if (until === null) return;
    const id = window.setInterval(() => {
      const left = remaining();
      setSeconds(left);
      if (left <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
    /* `remaining` is derived from `until` alone. */
  }, [until]);
  return seconds;
}

/** "2:00", "0:27" */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
