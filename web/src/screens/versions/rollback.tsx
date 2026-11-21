import { useCallback, useRef, useState } from "react";
import type { ApiError } from "@/api/client";
import { useRollbackMap } from "@/api/hooks";
import { Notice } from "@/components/notice";
import { formatClock, useCountdown } from "@/components/time";
import { Button } from "@/components/ui/button";
import { useVersionsStrings } from "@/i18n/versions";
import type { Session } from "@/model/types";
import type { RollbackBar } from "./model";

const TOUCH = "max-md:h-10 max-md:px-4 max-md:text-base";

export type RollbackState =
  | { target: number; phase: "confirm" }
  | { target: number; phase: "pending" }
  | { target: number; phase: "done"; version: number }
  | { target: number; phase: "refused"; error: ApiError; retryAt: number | null };

export interface Rollback {
  state: RollbackState | null;
  /** Ask about rolling back to a version; the answer appears in that version's row. */
  open(version: number): void;
  confirm(): void;
  close(): void;
}

/** One rollback at a time, answered where it was asked. Nothing is assumed: the table changes only after the server has. */
export function useRollback(mapId: string): Rollback {
  const mutation = useRollbackMap();
  const [state, setState] = useState<RollbackState | null>(null);

  const open = useCallback((version: number) => setState({ target: version, phase: "confirm" }), []);
  const close = useCallback(() => setState(null), []);
  const { mutate } = mutation;
  const latest = useRef(state);
  latest.current = state;
  const confirm = useCallback(() => {
    const current = latest.current;
    if (current === null || current.phase === "pending" || current.phase === "done") return;
    const { target } = current;
    setState({ target, phase: "pending" });
    mutate(
      { id: mapId, toVersion: target },
      {
        onSuccess: (result) => setState({ target, phase: "done", version: result.version }),
        onError: (error) => setState({ target, phase: "refused", error, retryAt: error.retryAfter === null ? null : Date.now() + error.retryAfter * 1000 }),
      },
    );
  }, [mapId, mutate]);

  return { state, open, confirm, close };
}

function Refused({ state, onRetry, onClose }: { state: Extract<RollbackState, { phase: "refused" }>; onRetry: () => void; onClose: () => void }) {
  const t = useVersionsStrings();
  const seconds = useCountdown(state.retryAt);
  const { error } = state;
  const cancel = (
    <Button variant="ghost" className={TOUCH} onPress={onClose}>
      {t.dismiss}
    </Button>
  );
  const retry = (disabled: boolean) => (
    <span className="flex gap-2">
      <Button variant="outline" className={TOUCH} isDisabled={disabled} onPress={onRetry}>
        {t.retry}
      </Button>
      {cancel}
    </span>
  );

  switch (error.code) {
    case "rate_limited":
      return (
        <Notice tone="warning" title={t.rateTitle} action={retry(seconds > 0)}>
          <span className="tabular-nums">{seconds > 0 ? t.rateBody(formatClock(seconds)) : t.rateReady}</span>
        </Notice>
      );
    case "network":
      return (
        <Notice tone="danger" title={t.offlineTitle} action={retry(false)}>
          {t.offlineBody}
        </Notice>
      );
    case "quota_exceeded":
      return (
        <Notice tone="danger" title={t.quotaServerTitle} action={cancel}>
          {error.reason} {t.quotaBody}
        </Notice>
      );
    case "forbidden":
      return (
        <Notice tone="danger" title={t.forbiddenServerTitle} action={cancel}>
          {error.reason}
        </Notice>
      );
    case "not_found":
      return (
        <Notice tone="danger" title={t.goneTitle} action={cancel}>
          {error.reason}
        </Notice>
      );
    default:
      return (
        <Notice tone="danger" title={t.otherTitle} action={retry(false)}>
          {error.reason}
        </Notice>
      );
  }
}

/**
 * The answer to "Roll back", in the row it was asked from: first what will
 * happen, in one sentence, then what did. A refusal that is already known
 * (role, archive, quota) is said at once, without a button that would fail.
 */
export function RollbackPanel({
  rollback,
  state,
  bar,
  session,
  nextVersion,
}: {
  rollback: Rollback;
  state: RollbackState;
  bar: RollbackBar;
  session: Session;
  nextVersion: number;
}) {
  const t = useVersionsStrings();
  const dismiss = (
    <Button variant="ghost" className={TOUCH} onPress={rollback.close}>
      {t.dismiss}
    </Button>
  );

  if (state.phase === "done") {
    return (
      <Notice tone="success" title={t.rolledBackDone(state.version, state.target)} action={dismiss}>
        {t.rolledBackBody}
      </Notice>
    );
  }
  if (state.phase === "refused") return <Refused state={state} onRetry={rollback.confirm} onClose={rollback.close} />;

  if (bar === "role") {
    return (
      <Notice tone="danger" title={t.notPermittedTitle(session.role)} action={dismiss}>
        {t.notPermittedBody}
      </Notice>
    );
  }
  if (bar === "archived") {
    return (
      <Notice tone="danger" title={t.archivedRefusalTitle} action={dismiss}>
        {t.archivedRefusalBody}
      </Notice>
    );
  }
  if (bar === "quota") {
    return (
      <Notice tone="danger" title={t.quotaTitle(session.limits.maxVersionsPerMap ?? 0)} action={dismiss}>
        {t.quotaBody}
      </Notice>
    );
  }

  const pending = state.phase === "pending";
  return (
    <div role="group" aria-label={t.rollBackNamed(state.target)} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-block border border-rule-strong bg-well px-3 py-2">
      <p className="min-w-0 flex-1 text-base text-ink tabular-nums">{t.rollbackPlan(state.target, nextVersion)}</p>
      <span className="flex shrink-0 gap-2">
        <Button autoFocus className={TOUCH} isDisabled={pending} onPress={rollback.confirm}>
          {pending ? t.rollingBack : t.rollbackConfirm(nextVersion)}
        </Button>
        <Button variant="ghost" className={TOUCH} isDisabled={pending} onPress={rollback.close}>
          {t.cancel}
        </Button>
      </span>
    </div>
  );
}
