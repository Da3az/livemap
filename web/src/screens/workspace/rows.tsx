import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { ApiError } from "@/api/client";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/notice";
import { formatClock, useCountdown } from "@/components/time";
import { Button } from "@/components/ui/button";
import { useShellStrings } from "@/i18n/shell";
import type { MapSummary, Session } from "@/model/types";
import { canEdit, firstStrongDir, resolveDir } from "./model";
import type { ArchiveAction, ArchiveActions, Outcome } from "./use-archive";

/** One line of the table: a map, and whatever is happening to it. */
export interface Item {
  map: MapSummary;
  /** False when the map has left this view and only an outcome remains to be shown. */
  present: boolean;
  pending: ArchiveAction | undefined;
  outcome: Outcome | undefined;
}

export type Body =
  | { kind: "loading" }
  | { kind: "error"; error: ApiError; errorAt: number; fetching: boolean; onRetry: () => void }
  | { kind: "empty" }
  | { kind: "nomatch"; query: string; onClear: () => void }
  | { kind: "rows"; items: Item[] };

/**
 * A map's title in its own direction, in the title face. In this left-to-right
 * table a right-to-left title keeps the column's leading edge and is cut, when
 * it must be, at its own end.
 */
export function TitleText({ map, className }: { map: MapSummary; className?: string }) {
  const dir = resolveDir(map.title, map.uiDir);
  return (
    <span dir={dir} title={map.title.value} className={`font-title ${dir === "rtl" ? "text-end" : "text-start"} ${className ?? ""}`}>
      {map.title.value}
    </span>
  );
}

/** A person's name in its own direction, held to the column's leading edge like a title. */
export function PersonName({ name, className }: { name: string; className?: string }) {
  const dir = firstStrongDir(name) ?? "ltr";
  return (
    <span dir={dir} title={name} className={`${dir === "rtl" ? "text-end" : "text-start"} ${className ?? ""}`}>
      {name}
    </span>
  );
}

/**
 * For a contributor: the maps that are theirs to change. The others say so
 * where the row's action is ("View", with the read-only padlock), so the
 * title keeps its room.
 */
export function OwnershipMark({ session, map }: { session: Session; map: MapSummary }) {
  const t = useShellStrings();
  if (session.role !== "contributor" || map.createdBy.userId !== session.userId) return null;
  return <span className="shrink-0 rounded-key border border-survey px-1 text-2xs font-semibold text-survey">{t.ws.yours}</span>;
}

const TOUCH = "max-md:h-10 max-md:border-rule-strong max-md:bg-panel max-md:px-4 max-md:text-base";

/** Open, Versions, and Archive or Restore: the last only for a role that may. */
export function RowActions({
  session,
  item,
  archivedView,
  actions,
  tabIndex,
}: {
  session: Session;
  item: Item;
  archivedView: boolean;
  actions: ArchiveActions;
  tabIndex: 0 | -1;
}) {
  const t = useShellStrings();
  const { map, pending } = item;
  const title = map.title.value;
  const editable = canEdit(session, map);
  const mayArchive = session.capabilities.includes("map:archive");
  const action: ArchiveAction = map.archived ? "restore" : "archive";
  /*
   * Shaped by job: Open is the row's one primary action, inked in the action
   * colour and always legible; Versions is a plain word; Archive and Restore sit
   * past a rule, smaller and quieter, and Archive warms to danger only in hand.
   */
  const word = `inline-flex h-6 items-center rounded-key px-1.5 whitespace-nowrap transition-colors duration-100 max-md:border ${TOUCH}`;

  return (
    <>
      <Link
        to={`/maps/${map.id}`}
        tabIndex={tabIndex}
        aria-label={editable ? t.ws.openNamed(title) : t.ws.viewNamed(title)}
        title={editable ? undefined : t.ws.readOnly}
        className={`${word} gap-1 text-sm font-semibold text-survey decoration-1 underline-offset-2 hover:bg-selected hover:underline`}
      >
        {editable ? null : <Icon name="stateReadonly" size={12} className="text-state-readonly" />}
        {editable ? t.ws.open : t.ws.view}
      </Link>
      <Link
        to={`/maps/${map.id}/versions`}
        tabIndex={tabIndex}
        aria-label={t.ws.versionsNamed(title)}
        className={`${word} text-sm text-ink-2 hover:bg-well hover:text-ink`}
      >
        {t.ws.versions}
      </Link>
      {mayArchive ? (
        <span className="ms-1.5 flex items-center border-s border-rule ps-1.5 max-md:ms-0 max-md:border-0 max-md:ps-0">
          <Button
            variant="ghost"
            size="sm"
            className={`${word} text-xs ${
              action === "archive"
                ? "text-ink-3 hover:bg-danger-wash hover:text-danger data-pressed:bg-danger-wash"
                : "text-ink-3 hover:bg-well hover:text-ink"
            }`}
            excludeFromTabOrder={tabIndex === -1}
            isDisabled={pending !== undefined}
            aria-label={action === "archive" ? t.ws.archiveNamed(title) : t.ws.restoreNamed(title)}
            onPress={() => actions.run(action, map, archivedView)}
          >
            {pending === "archive" ? t.ws.archiving : pending === "restore" ? t.ws.restoring : action === "archive" ? t.ws.archive : t.ws.restore}
          </Button>
        </span>
      ) : null}
    </>
  );
}

/** What an archive or a restore came to, shown where the row is or was. */
export function OutcomeNotice({
  item,
  actions,
  stacked = false,
  className,
}: {
  item: Item;
  actions: ArchiveActions;
  /** Put the buttons under the words instead of beside them, for a narrow list. */
  stacked?: boolean;
  className?: string;
}) {
  const t = useShellStrings();
  const outcome = item.outcome;
  const waiting = useCountdown(outcome?.kind === "failed" ? outcome.waitUntil : null);
  if (!outcome) return null;
  const busy = item.pending !== undefined;
  const title = <TitleText map={item.map} className="font-medium" />;

  if (outcome.kind === "done") {
    const archived = outcome.action === "archive";
    const buttons = (
      <span className="flex gap-1">
        <Button variant="outline" size="sm" className={TOUCH} isDisabled={busy} onPress={() => actions.undo(outcome)}>
          {busy ? (archived ? t.ws.restoring : t.ws.archiving) : t.ws.undo}
        </Button>
        <Button variant="ghost" size="sm" className={TOUCH} isDisabled={busy} onPress={() => actions.dismiss(item.map.id)}>
          {t.ws.dismiss}
        </Button>
      </span>
    );
    return (
      <Notice
        tone="success"
        className={className}
        title={
          <>
            {archived ? t.ws.archivedDone : t.ws.restoredDone} {title}
          </>
        }
        action={stacked ? undefined : buttons}
      >
        {archived ? t.ws.archivedDoneBody : t.ws.restoredDoneBody}
        {stacked ? <span className="mt-2 block">{buttons}</span> : null}
      </Notice>
    );
  }

  const { error } = outcome;
  const held = waiting > 0;
  const buttons = (
    <span className="flex gap-1">
      <Button variant="outline" size="sm" className={TOUCH} isDisabled={busy || held} onPress={() => actions.retry(outcome)}>
        {busy ? (outcome.action === "archive" ? t.ws.archiving : t.ws.restoring) : t.ws.retry}
      </Button>
      <Button variant="ghost" size="sm" className={TOUCH} isDisabled={busy} onPress={() => actions.dismiss(item.map.id)}>
        {t.ws.dismiss}
      </Button>
    </span>
  );
  return (
    <Notice
      tone={error.code === "rate_limited" ? "warning" : "danger"}
      className={className}
      title={
        <>
          {outcome.action === "archive" ? t.ws.archiveFailed : t.ws.restoreFailed}
          {item.present ? null : <>: {title}</>}
        </>
      }
      action={stacked ? undefined : buttons}
    >
      <span className="tabular-nums">
        {error.code === "rate_limited" && held ? t.ws.rateWait(formatClock(waiting)) : error.code === "network" ? t.ws.networkFailed : error.reason}
      </span>
      {stacked ? <span className="mt-2 block">{buttons}</span> : null}
    </Notice>
  );
}

/** The list could not be loaded. A rate limit counts down and then loads again by itself. */
export function LoadError({ body }: { body: Extract<Body, { kind: "error" }> }) {
  const t = useShellStrings();
  const { error, errorAt, fetching, onRetry } = body;
  const waitUntil = error.retryAfter === null ? null : errorAt + error.retryAfter * 1000;
  const waiting = useCountdown(waitUntil);
  const retried = useRef<number | null>(null);

  useEffect(() => {
    if (waitUntil !== null && waiting === 0 && Date.now() >= waitUntil && retried.current !== waitUntil) {
      retried.current = waitUntil;
      onRetry();
    }
  }, [waiting, waitUntil, onRetry]);

  const retry = (
    <Button variant="outline" className={TOUCH} isDisabled={fetching} onPress={onRetry}>
      {error.code === "rate_limited" ? t.ws.retryNow : t.ws.retry}
    </Button>
  );

  if (error.code === "rate_limited") {
    return (
      <Notice tone="warning" title={t.ws.loadRateTitle} action={retry}>
        <span className="tabular-nums">{waiting > 0 ? t.ws.loadRateBody(formatClock(waiting)) : t.ws.loadRateReady}</span>
      </Notice>
    );
  }
  return (
    <Notice tone="danger" title={t.ws.loadFailedTitle} action={retry}>
      {error.code === "network" ? t.ws.loadNetworkBody : error.reason}
    </Notice>
  );
}

export function NoMatch({ body }: { body: Extract<Body, { kind: "nomatch" }> }) {
  const t = useShellStrings();
  return (
    <div className="flex flex-col items-start gap-2 py-3">
      <p className="text-base text-ink">
        <span dir="auto">{t.ws.noMatchTitle(body.query)}</span>
      </p>
      <p className="text-xs text-ink-3">{t.ws.noMatchBody}</p>
      <Button variant="outline" className={TOUCH} onPress={body.onClear}>
        {t.ws.clearSearch}
      </Button>
    </div>
  );
}
