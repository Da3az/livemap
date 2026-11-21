import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { eventTimes, timeExtent, timeHistogram, timeWindowFor, toIso, type TimeBucket, type TimeExtent, type TimeWindow } from "@/editor/store/time";
import type { MapVersion } from "@/model/types";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const BUCKETS = 48;
/** The moving window's width when the artifact does not carry one: the editor's default. */
export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_WINDOW_MS = 60_000;

/**
 * `settings.timeline.windowMs`, read defensively: artifacts published before
 * the field existed lack it, and a hand-edited one may hold anything.
 */
export function artifactWindowMs(timeline: MapVersion["settings"]["timeline"]): number {
  const value: unknown = timeline.windowMs;
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_WINDOW_MS ? value : DEFAULT_WINDOW_MS;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(REDUCED_MOTION);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
  );
}

export interface Playback {
  extent: TimeExtent;
  buckets: TimeBucket[];
  /** Every moment something starts or ends, for stepping. */
  events: number[];
  mode: "moving" | "cumulative";
  windowMs: number;
  playheadMs: number;
  playing: boolean;
  atEnd: boolean;
  /** What the map should show now. */
  window: TimeWindow | null;
  reducedMotion: boolean;
  seek(ms: number): void;
  toggle(): void;
  step(direction: 1 | -1): void;
}

function clamp(value: number, extent: TimeExtent): number {
  return Math.max(extent.fromMs, Math.min(extent.toMs, value));
}

/**
 * The reader's position in the map's time. Null when the map has no timeline
 * to show: it is switched off, or nothing on the map is dated.
 *
 * The playhead belongs to the reader, not to the artifact. When a newer
 * version arrives it stays where it was, except that a playhead resting at
 * the end keeps resting at the end, since that reader is watching "now".
 */
export function usePlayback(version: MapVersion, options: { initialTime?: string; windowMs?: number } = {}): Playback | null {
  const { timeline } = version.settings;
  const extent = useMemo(() => timeExtent(version.features), [version.features]);
  const usable = timeline.enabled && extent !== null && extent.toMs > extent.fromMs ? extent : null;
  const buckets = useMemo(() => timeHistogram(version.features, usable, BUCKETS), [version.features, usable]);
  const events = useMemo(() => eventTimes(version.features), [version.features]);
  const reducedMotion = useReducedMotion();
  const windowMs = options.windowMs ?? artifactWindowMs(timeline);

  const [playhead, setPlayhead] = useState<number | null>(() => {
    const initial = options.initialTime ? Date.parse(options.initialTime) : Number.NaN;
    return Number.isNaN(initial) ? null : initial;
  });
  const [playing, setPlaying] = useState(false);

  /* null means "at the end, whatever the end is", so a longer extent in a newer version is followed. */
  const playheadMs = usable === null ? 0 : playhead === null ? usable.toMs : clamp(playhead, usable);
  const atEnd = usable !== null && playheadMs >= usable.toMs;

  const live = useRef({ usable, playheadMs, playing, speed: timeline.speed });
  live.current = { usable, playheadMs, playing, speed: timeline.speed };

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const { usable: range, playheadMs: at, speed } = live.current;
      if (range === null) {
        setPlaying(false);
        return;
      }
      /* A tab that was in the background returns with one long frame; do not jump the map by it. */
      const elapsed = Math.min(now - last, 250);
      last = now;
      const next = at + elapsed * speed;
      if (next >= range.toMs) {
        setPlayhead(null);
        setPlaying(false);
        return;
      }
      live.current.playheadMs = next;
      setPlayhead(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    if (reducedMotion || usable === null) setPlaying(false);
  }, [reducedMotion, usable]);

  const seek = useCallback((ms: number) => {
    const range = live.current.usable;
    if (range === null) return;
    setPlayhead(ms >= range.toMs ? null : clamp(ms, range));
  }, []);

  const toggle = useCallback(() => {
    const { usable: range, playheadMs: at, playing: running } = live.current;
    if (range === null) return;
    /* Play from the end starts the story again. */
    if (!running && at >= range.toMs) setPlayhead(range.fromMs);
    setPlaying(!running);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      const { usable: range, playheadMs: at } = live.current;
      if (range === null) return;
      setPlaying(false);
      const target = direction === 1 ? events.find((time) => time > at) : events.findLast((time) => time < at);
      seek(target ?? (direction === 1 ? range.toMs : range.fromMs));
    },
    [events, seek],
  );

  const timeWindow = useMemo(
    () => (usable === null ? null : timeWindowFor(toIso(playheadMs), windowMs, timeline)),
    [usable, playheadMs, windowMs, timeline],
  );

  if (usable === null) return null;
  return { extent: usable, buckets, events, mode: timeline.mode, windowMs, playheadMs, playing, atEnd, window: timeWindow, reducedMotion, seek, toggle, step };
}
