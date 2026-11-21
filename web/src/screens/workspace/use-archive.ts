import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { useArchiveMap, useUnarchiveMap } from "@/api/hooks";
import type { MapSummary } from "@/model/types";

export type ArchiveAction = "archive" | "restore";

/**
 * What became of an archive or a restore, kept so the table can say it where
 * the row is (or was). `map` is the row as it stood before the action, which
 * is what places a row that has since left the list.
 */
interface OutcomeBase {
  action: ArchiveAction;
  map: MapSummary;
  /** The view the action was started from (true: Archived); the outcome is reported there. */
  view: boolean;
  /** The action was the reversal of an earlier one. */
  undoing: boolean;
}
export type Outcome = (OutcomeBase & { kind: "done" }) | (OutcomeBase & { kind: "failed"; error: ApiError; waitUntil: number | null });

export interface ArchiveActions {
  pending: Readonly<Record<string, ArchiveAction>>;
  outcomes: Readonly<Record<string, Outcome>>;
  run(action: ArchiveAction, map: MapSummary, view: boolean): void;
  /** Reverse a finished action; the row simply returns. */
  undo(outcome: Outcome): void;
  /** Make a failed attempt again. */
  retry(outcome: Outcome): void;
  dismiss(id: string): void;
}

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  const next = { ...record };
  delete next[id];
  return next;
}

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError({ status: 0, code: "network" });
}

export function useArchiveActions(): ArchiveActions {
  const archive = useArchiveMap();
  const restore = useUnarchiveMap();
  const [pending, setPending] = useState<Record<string, ArchiveAction>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const perform = useCallback(
    (action: ArchiveAction, map: MapSummary, view: boolean, undoing: boolean): void => {
      setPending((current) => ({ ...current, [map.id]: action }));
      const request = action === "archive" ? archive.mutateAsync(map.id) : restore.mutateAsync(map.id);
      request
        .then(() => {
          setOutcomes((current) => (undoing ? without(current, map.id) : { ...current, [map.id]: { kind: "done", action, map, view, undoing } }));
        })
        .catch((reason: unknown) => {
          const error = toApiError(reason);
          const waitUntil = error.retryAfter === null ? null : Date.now() + error.retryAfter * 1000;
          setOutcomes((current) => ({ ...current, [map.id]: { kind: "failed", action, map, view, undoing, error, waitUntil } }));
        })
        .finally(() => setPending((current) => without(current, map.id)));
    },
    [archive, restore],
  );

  const run = useCallback((action: ArchiveAction, map: MapSummary, view: boolean) => perform(action, map, view, false), [perform]);

  const undo = useCallback(
    (outcome: Outcome) => perform(outcome.action === "archive" ? "restore" : "archive", outcome.map, outcome.view, true),
    [perform],
  );

  const retry = useCallback((outcome: Outcome) => perform(outcome.action, outcome.map, outcome.view, outcome.undoing), [perform]);

  const dismiss = useCallback((id: string) => setOutcomes((current) => without(current, id)), []);

  return { pending, outcomes, run, undo, retry, dismiss };
}
