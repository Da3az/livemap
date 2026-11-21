import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router";
import { Icon } from "@/components/icons";
import { StateBadge } from "@/components/state-badge";
import { formatAbsolute, formatPast, useNow } from "@/components/time";
import { useShellStrings } from "@/i18n/shell";
import { useVersionsStrings } from "@/i18n/versions";
import type { MapDoc, VersionPointer, VersionRecord } from "@/model/types";
import { CopyButton } from "./copy";
import { cachePolicy, type DraftState, formatBytes, shortEtag } from "./model";

const WEEK = 7 * 24 * 3_600_000;

/** Absolute always; relative as well while it is recent enough to mean something. */
export function When({ iso, className = "" }: { iso: string; className?: string }) {
  const shell = useShellStrings();
  const now = useNow();
  const recent = now - Date.parse(iso) < WEEK;
  return (
    <time dateTime={iso} className={`whitespace-nowrap tabular-nums ${className}`}>
      {formatAbsolute(iso, "en")}
      {recent ? <span className="text-ink-3"> · {formatPast(iso, now, "en", shell.time)}</span> : null}
    </time>
  );
}

function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-2xs font-semibold tracking-wide text-plum uppercase">{children}</span>
      {hint ? <span className="text-2xs text-ink-3">{hint}</span> : null}
    </p>
  );
}

function Fact({ term, children, title }: { term: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-2xs text-ink-3">{term}</dt>
      <dd title={title} className="text-xs text-ink tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/** An address with its file name set heavier, since the file is the part that differs. */
function Address({ url }: { url: string }) {
  const cut = url.lastIndexOf("/") + 1;
  return (
    <span className="min-w-0 text-sm text-ink-2">
      <span className="break-all">{url.slice(0, cut)}</span>
      <span className="font-semibold whitespace-nowrap text-ink">{url.slice(cut)}</span>
    </span>
  );
}

/** The join between the two: a rule with a head when the pointer resolves, a broken rule with a stop when it does not. */
function Resolves({ resolved }: { resolved: boolean }) {
  const t = useVersionsStrings();
  const line = resolved ? "border-ink" : "border-dashed border-rule-strong";
  return (
    <>
      <div aria-hidden="true" className="flex items-center gap-2 ps-1 @4xl:hidden">
        <span className={`h-5 border-s ${line}`} />
        <span className="text-2xs text-ink-3">{resolved ? `↓ ${t.resolvesTo}` : t.resolvesTo}</span>
      </div>
      <div aria-hidden="true" className="hidden w-32 shrink-0 flex-col gap-1 pt-6 @4xl:flex">
        <span className="text-center text-2xs text-ink-3">{t.resolvesTo}</span>
        <span className="flex items-center">
          <span className={`flex-1 border-t ${line}`} />
          {resolved ? (
            <svg width="8" height="10" viewBox="0 0 8 10" className="-ms-px text-ink">
              <path d="M0 0l8 5-8 5z" fill="currentColor" />
            </svg>
          ) : (
            <span className="h-3 border-s border-rule-strong" />
          )}
        </span>
      </div>
    </>
  );
}

/**
 * The publishing mechanism, drawn in type and rules: the short-cache pointer
 * every embed asks for, the immutable file it resolves to, and where the
 * draft stands against that file.
 */
export function PointerDiagram({
  map,
  pointer,
  live,
  draft,
  onCompareDraft,
}: {
  map: MapDoc;
  pointer: VersionPointer;
  live: VersionRecord | null;
  draft: DraftState;
  onCompareDraft: () => void;
}) {
  const t = useVersionsStrings();
  const [expanded, setExpanded] = useState(false);
  const mechanism = useId();
  return (
    <section aria-label={t.pointer} className="@container shrink-0 border-b border-rule-strong">
      {/* On a phone the mechanism folds to one line, so the versions start on the first screen. */}
      <div className="flex items-center gap-x-3 gap-y-1 px-4 pt-2.5 @2xl:hidden">
        {live ? (
          <>
            <span className="font-title text-lg leading-none font-semibold text-ink tabular-nums">{t.version(live.version)}</span>
            <StateBadge state="live">{t.live}</StateBadge>
            {pointer.updatedAt ? <When iso={pointer.updatedAt} className="min-w-0 truncate text-xs text-ink-2" /> : null}
          </>
        ) : (
          <span className="font-title text-lg leading-none font-semibold text-ink-3">{t.nothing}</span>
        )}
        <button type="button" aria-expanded={expanded} aria-controls={mechanism} onClick={() => setExpanded((open) => !open)} className="ms-auto flex min-h-10 shrink-0 items-center gap-1 rounded-key text-sm text-bathy">
          {t.pointerDetails}
          <Icon name="chevronDown" size={12} className={expanded ? "rotate-180" : ""} />
        </button>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3 md:px-5 @4xl:flex-row @4xl:items-start @4xl:gap-5">
        <div id={mechanism} className={`contents ${expanded ? "" : "@max-2xl:hidden"}`}>
        <div className="min-w-0 @4xl:flex-1">
          <Label hint={t.pointerHint}>{t.pointer}</Label>
          <p className="mt-1 flex items-start gap-2">
            <Address url={pointer.url} />
            <CopyButton compact text={pointer.url} label={t.copyUrl} />
          </p>
          <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
            <Fact term={t.etag} title={pointer.etag ?? undefined}>
              {pointer.etag ? shortEtag(pointer.etag) : "—"}
            </Fact>
            <Fact term={t.cache} title={pointer.cacheControl}>
              {cachePolicy(pointer.cacheControl)}
            </Fact>
            <Fact term={t.changed}>{pointer.updatedAt ? <When iso={pointer.updatedAt} /> : t.never}</Fact>
          </dl>
        </div>

        <Resolves resolved={live !== null} />

        <div className="min-w-0 @4xl:flex-1">
          <Label hint={t.artifactHint}>{t.artifact}</Label>
          {live ? (
            <>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-title text-xl leading-none font-semibold text-ink tabular-nums">{t.version(live.version)}</span>
                <StateBadge state="live">{t.live}</StateBadge>
                <a href={live.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-baseline gap-1 rounded-key text-sm text-bathy underline decoration-1 underline-offset-2 hover:decoration-2">
                  <span className="break-all">{live.storageKey}</span>
                  <Icon name="external" size={11} className="shrink-0 self-center" />
                </a>
              </p>
              <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                <Fact term={t.etag} title={live.etag}>
                  {shortEtag(live.etag)}
                </Fact>
                <Fact term={t.cache} title={live.cacheControl}>
                  {cachePolicy(live.cacheControl)}
                </Fact>
                <Fact term={t.size}>{formatBytes(live.byteSize)}</Fact>
                <Fact term={t.features}>{t.n(live.featureCount)}</Fact>
                <Fact term={t.publishedBy}>
                  <span dir="auto">{live.publishedBy.name}</span>
                </Fact>
              </dl>
            </>
          ) : (
            <>
              <p className="mt-0.5 font-title text-xl leading-none font-semibold text-ink-3">{t.nothing}</p>
              <p className="mt-1.5 max-w-prose text-xs text-ink-2">{t.pointsAtNothing}</p>
            </>
          )}
        </div>

        </div>
        <div className="min-w-0 border-t border-rule pt-3 @max-2xl:border-t-0 @max-2xl:pt-0 @4xl:w-80 @4xl:shrink-0 @4xl:border-s @4xl:border-t-0 @4xl:ps-5 @4xl:pt-0">
          <Label>{t.draft}</Label>
          {map.archived ? (
            <StateBadge state="archived" className="mt-1 whitespace-normal">
              {t.draftArchived}
            </StateBadge>
          ) : draft.kind === "ahead" ? (
            <>
              <StateBadge state="draft" className="mt-1 whitespace-normal">
                <span className="tabular-nums">{t.draftAhead(draft.rev, draft.publishedRev)}</span>
              </StateBadge>
              <p className="mt-1 text-xs text-ink-2">{t.draftAheadBody(draft.version)}</p>
            </>
          ) : draft.kind === "level" ? (
            <StateBadge state="live" className="mt-1 whitespace-normal">
              <span className="tabular-nums">{t.draftLevel(draft.rev, draft.version)}</span>
            </StateBadge>
          ) : (
            <>
              <StateBadge state="draft" className="mt-1 whitespace-normal">
                <span className="tabular-nums">{t.draftNever(draft.rev)}</span>
              </StateBadge>
              <p className="mt-1 text-xs text-ink-2">{t.willCreate}</p>
            </>
          )}
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link to={`/maps/${map.id}`} className="rounded-key text-bathy underline decoration-1 underline-offset-2 hover:decoration-2">
              {t.openEditor}
            </Link>
            {draft.kind === "ahead" && !map.archived ? (
              <button type="button" onClick={onCompareDraft} className="rounded-key text-bathy underline decoration-1 underline-offset-2 hover:decoration-2">
                {t.compareDraft}
              </button>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}
