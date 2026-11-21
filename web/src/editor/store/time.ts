import type { IsoDateTime, MapFeature, MapSettings } from "@/model/types";

/** The window `EditorController.setTimeFilter` takes; null shows everything. */
export type TimeWindow = { from: IsoDateTime | null; to: IsoDateTime };

/** The span of time the document's dated features cover. */
export interface TimeExtent {
  from: IsoDateTime;
  to: IsoDateTime;
  fromMs: number;
  toMs: number;
}

function parse(value: IsoDateTime | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Epoch milliseconds to the ISO form the document stores. */
export function toIso(ms: number): IsoDateTime {
  return new Date(ms).toISOString();
}

/**
 * Whether a feature shows in a time window. An undated feature always shows.
 * With no lower bound (cumulative mode) a feature that has ended still shows.
 */
export function isValidInWindow(
  feature: Pick<MapFeature, "validFrom" | "validTo">,
  window: TimeWindow | null,
): boolean {
  if (window === null) return true;
  const to = parse(window.to);
  const from = parse(window.from);
  const start = parse(feature.validFrom);
  const end = parse(feature.validTo);
  if (to !== null && start !== null && start > to) return false;
  if (from !== null && end !== null && end <= from) return false;
  return true;
}

/**
 * The time window for a playhead; null when there is no playhead, which shows
 * everything. Only `mode` is read from the settings: `enabled` says whether
 * readers get a timeline, and never decides whether a playhead filters.
 */
export function timeWindowFor(
  playhead: IsoDateTime | null,
  windowMs: number,
  timeline: Pick<MapSettings["timeline"], "mode">,
): TimeWindow | null {
  const at = parse(playhead);
  if (playhead === null || at === null) return null;
  if (timeline.mode === "cumulative") return { from: null, to: playhead };
  return { from: toIso(at - windowMs), to: playhead };
}

/** Earliest start to latest start or end across dated features; null when nothing is dated. */
export function timeExtent(features: Iterable<MapFeature>): TimeExtent | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const feature of features) {
    for (const value of [parse(feature.validFrom), parse(feature.validTo)]) {
      if (value === null) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (min > max) return null;
  return { from: toIso(min), to: toIso(max), fromMs: min, toMs: max };
}

/** Every distinct moment at which some feature starts or ends, ascending, in milliseconds. */
export function eventTimes(features: Iterable<MapFeature>): number[] {
  const times = new Set<number>();
  for (const feature of features) {
    const start = parse(feature.validFrom);
    const end = parse(feature.validTo);
    if (start !== null) times.add(start);
    if (end !== null) times.add(end);
  }
  return [...times].sort((a, b) => a - b);
}

/** One bar of the timeline histogram. */
export interface TimeBucket {
  fromMs: number;
  toMs: number;
  /** Features that begin in this bucket. */
  starts: number;
  /** Features in existence at some point in this bucket. */
  active: number;
}

/** Features over time in equal buckets across the extent. Empty when nothing is dated. */
export function timeHistogram(features: Iterable<MapFeature>, extent: TimeExtent | null, buckets: number): TimeBucket[] {
  if (extent === null || buckets <= 0) return [];
  const span = Math.max(1, extent.toMs - extent.fromMs);
  const width = span / buckets;
  const out: TimeBucket[] = [];
  for (let i = 0; i < buckets; i++) {
    out.push({ fromMs: extent.fromMs + i * width, toMs: extent.fromMs + (i + 1) * width, starts: 0, active: 0 });
  }
  const indexOf = (ms: number): number => Math.max(0, Math.min(buckets - 1, Math.floor((ms - extent.fromMs) / width)));
  for (const feature of features) {
    const start = parse(feature.validFrom);
    const end = parse(feature.validTo);
    if (start === null && end === null) continue;
    const first = start === null ? 0 : indexOf(start);
    const last = end === null ? buckets - 1 : indexOf(end);
    if (start !== null) {
      const bucket = out[first];
      if (bucket !== undefined) bucket.starts += 1;
    }
    for (let i = first; i <= last; i++) {
      const bucket = out[i];
      if (bucket !== undefined) bucket.active += 1;
    }
  }
  return out;
}
