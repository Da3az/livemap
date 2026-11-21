import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import type { ApiError } from "@/api/client";
import { AppHeader } from "@/components/app-header";
import { Notice } from "@/components/notice";
import { formatClock, useCountdown } from "@/components/time";
import { Button, LinkButton } from "@/components/ui/button";
import { useVersionsStrings } from "@/i18n/versions";
import type { Session } from "@/model/types";
import { VersionsList } from "./list";
import { DEFAULT_SORT } from "./model";
import type { Rollback } from "./rollback";
import { VersionsTable, type VersionRowsProps } from "./table";

const TOUCH = "max-md:h-10 max-md:px-4 max-md:text-base";
const NO_ROLLBACK: Rollback = { state: null, open: () => undefined, confirm: () => undefined, close: () => undefined };

function useIsTableWidth(): boolean {
  const query = "(min-width: 48rem)";
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Why the versions could not be shown, where they would be, with the way forward that fits the reason. */
export function LoadProblem({ error, failedAt, fetching, onRetry }: { error: ApiError; failedAt: number; fetching: boolean; onRetry: () => void }) {
  const t = useVersionsStrings();
  const retryAt = error.code === "rate_limited" && error.retryAfter !== null ? failedAt + error.retryAfter * 1000 : null;
  const seconds = useCountdown(retryAt);

  /* A rate limit names its own end: load again when it arrives, without asking for a click. */
  useEffect(() => {
    if (retryAt !== null && seconds === 0 && !fetching) onRetry();
    /* Fires once per countdown reaching zero. */
  }, [retryAt, seconds]);

  const retry = (
    <Button variant="outline" className={TOUCH} isDisabled={fetching} onPress={onRetry}>
      {t.retry}
    </Button>
  );
  const maps = (
    <LinkButton variant="outline" href="/maps" className={TOUCH}>
      {t.backToMaps}
    </LinkButton>
  );

  switch (error.code) {
    case "not_found":
      return (
        <Notice tone="danger" title={t.notFoundTitle} action={maps}>
          {t.notFoundBody}
        </Notice>
      );
    case "forbidden":
      return (
        <Notice tone="danger" title={t.forbiddenTitle} action={maps}>
          {error.reason}
        </Notice>
      );
    case "rate_limited":
      return (
        <Notice tone="warning" title={t.rateTitleLoad} action={retry}>
          <span className="tabular-nums">{seconds > 0 ? t.loadRateBody(formatClock(seconds)) : t.loadRateReady}</span>
        </Notice>
      );
    case "network":
      return (
        <Notice tone="danger" title={t.loadFailedTitle} action={retry}>
          {t.loadNetworkBody}
        </Notice>
      );
    default:
      return (
        <Notice tone="danger" title={t.loadFailedTitle} action={retry}>
          {error.reason}
        </Notice>
      );
  }
}

function Bar({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block rounded-key bg-rule ${className}`} />;
}

/**
 * The screen before its data: the same bar, the pointer's two halves and the
 * table's columns, with nothing in them yet. A failure is said in place of
 * the pointer, and the columns stay so the screen does not change shape.
 */
export function PendingScreen({ session, mapId, children }: { session: Session | null; mapId: string; children: ReactNode }) {
  const t = useVersionsStrings();
  const isTable = useIsTableWidth();
  const loading = children === null;
  const rows: VersionRowsProps = {
    session,
    versions: [],
    all: [],
    live: null,
    sort: DEFAULT_SORT,
    onSort: () => undefined,
    rollback: NO_ROLLBACK,
    bar: null,
    nextVersion: 1,
    viewing: null,
    onView: () => undefined,
    onCompare: () => undefined,
    loading,
    showEmpty: false,
  };

  return (
    <div className="flex h-dvh flex-col bg-page">
      <AppHeader session={session} />
      <main aria-busy={loading} className="@container flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel md:overflow-hidden">
        <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-rule px-4 py-2 md:px-5">
          <h1 className="font-title text-lg font-medium text-ink">{t.title}</h1>
          {loading ? (
            <span role="status" className="text-xs text-ink-3">
              {t.loading}
            </span>
          ) : null}
          {mapId && !loading ? (
            <LinkButton variant="outline" href="/maps" className={`ms-auto ${TOUCH}`}>
              {t.backToMaps}
            </LinkButton>
          ) : null}
        </div>

        {loading ? (
          <div aria-hidden="true" className="flex shrink-0 flex-col gap-3 border-b border-rule-strong px-4 py-3 md:px-5 @4xl:flex-row @4xl:gap-5">
            <div className="@4xl:flex-1">
              <p className="text-2xs font-semibold tracking-wide text-plum uppercase">{t.pointer}</p>
              <Bar className="mt-2 h-3 w-4/5" />
              <Bar className="mt-2 h-2.5 w-3/5" />
            </div>
            <div className="hidden w-32 shrink-0 pt-9 @4xl:block">
              <span className="block border-t border-dashed border-rule-strong" />
            </div>
            <div className="@4xl:flex-1">
              <p className="text-2xs font-semibold tracking-wide text-plum uppercase">{t.artifact}</p>
              <Bar className="mt-2 h-5 w-12" />
              <Bar className="mt-2 h-2.5 w-3/5" />
            </div>
            <div className="@4xl:w-80 @4xl:shrink-0 @4xl:border-s @4xl:border-rule @4xl:ps-5">
              <p className="text-2xs font-semibold tracking-wide text-plum uppercase">{t.draft}</p>
              <Bar className="mt-2 h-3 w-3/4" />
            </div>
          </div>
        ) : (
          <div className="shrink-0 border-b border-rule-strong px-4 py-3 md:px-5">
            <div className="max-w-3xl">{children}</div>
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{isTable ? <VersionsTable {...rows} /> : <VersionsList {...rows} />}</div>
      </main>
    </div>
  );
}
