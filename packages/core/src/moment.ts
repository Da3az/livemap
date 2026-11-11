// A Moment maps 1:1 onto row-level writes: features are individual records,
// never a blob per map.

import type { MapFeature, Moment, ReversibleMoment } from "./types.js";

export type FeatureMap = ReadonlyMap<string, MapFeature>;

/**
 * Inverse of a forward Moment. Needs the pre-state, hence computed at apply
 * time and stored rather than derived later.
 */
export function invert(forward: Moment, before: FeatureMap): Moment {
  const put: MapFeature[] = [];
  const del: string[] = [];

  for (const f of forward.put ?? []) {
    const prev = before.get(f.id);
    if (prev) put.push(prev);
    else del.push(f.id);
  }

  for (const id of forward.delete ?? []) {
    const prev = before.get(id);
    // Deleting what is not there inverts to nothing; a tombstone here would
    // resurrect phantom features.
    if (prev) put.push(prev);
  }

  const out: Moment = {};
  if (put.length) (out as { put?: MapFeature[] }).put = put;
  if (del.length) (out as { delete?: string[] }).delete = del;
  return out;
}

/** Does not mutate the input. */
export function apply(state: FeatureMap, m: Moment): Map<string, MapFeature> {
  const next = new Map(state);
  for (const id of m.delete ?? []) next.delete(id);
  for (const f of m.put ?? []) next.set(f.id, f);
  return next;
}

export function isEmptyMoment(m: Moment): boolean {
  return (m.put?.length ?? 0) === 0 && (m.delete?.length ?? 0) === 0;
}

export interface HistoryState {
  readonly undo: readonly ReversibleMoment[];
  readonly redo: readonly ReversibleMoment[];
}

export const EMPTY_HISTORY: HistoryState = { undo: [], redo: [] };

export interface TransactOptions {
  /**
   * Skip the history push: a drag emits a Moment per frame, but only the whole
   * gesture belongs in history.
   */
  readonly quiet?: boolean;
  readonly limit?: number;
}

export interface TransactResult {
  readonly state: Map<string, MapFeature>;
  readonly history: HistoryState;
}

/** Bounded so the stack cannot grow without limit during a long live event. */
export const DEFAULT_HISTORY_LIMIT = 200;

export function transact(
  state: FeatureMap,
  history: HistoryState,
  forward: Moment,
  options: TransactOptions = {},
): TransactResult {
  if (isEmptyMoment(forward)) {
    return { state: new Map(state), history };
  }

  const reverse = invert(forward, state);
  const next = apply(state, forward);

  if (options.quiet) {
    return { state: next, history };
  }

  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
  const undo = [...history.undo, { forward, reverse }];
  // A new edit invalidates the redo branch.
  return {
    state: next,
    history: { undo: undo.slice(-limit), redo: [] },
  };
}

export function undo(
  state: FeatureMap,
  history: HistoryState,
): TransactResult {
  const last = history.undo[history.undo.length - 1];
  if (!last) return { state: new Map(state), history };
  return {
    state: apply(state, last.reverse),
    history: {
      undo: history.undo.slice(0, -1),
      redo: [...history.redo, last],
    },
  };
}

export function redo(
  state: FeatureMap,
  history: HistoryState,
): TransactResult {
  const last = history.redo[history.redo.length - 1];
  if (!last) return { state: new Map(state), history };
  return {
    state: apply(state, last.forward),
    history: {
      undo: [...history.undo, last],
      redo: history.redo.slice(0, -1),
    },
  };
}

/**
 * Collapse a run of Moments into one, for committing a `quiet: true` gesture.
 * `before` must be the FIRST pre-state, hence passed in rather than recomputed.
 */
export function coalesce(
  moments: readonly Moment[],
  before: FeatureMap,
): ReversibleMoment {
  const puts = new Map<string, MapFeature>();
  const deletes = new Set<string>();

  for (const m of moments) {
    for (const id of m.delete ?? []) {
      puts.delete(id);
      deletes.add(id);
    }
    for (const f of m.put ?? []) {
      deletes.delete(f.id);
      puts.set(f.id, f);
    }
  }

  const forward: Moment = {};
  if (puts.size) (forward as { put?: MapFeature[] }).put = [...puts.values()];
  if (deletes.size) (forward as { delete?: string[] }).delete = [...deletes];

  return { forward, reverse: invert(forward, before) };
}
