import type { ReactNode } from "react";
import { EMBED_STRINGS, type EmbedStrings } from "@/i18n/embed";

type StatementKind = "notPublished" | "notFound" | "failed" | "offline";

const SENTENCE: Record<StatementKind, (t: EmbedStrings) => string> = {
  notPublished: (t) => t.notPublished,
  notFound: (t) => t.notFound,
  failed: (t) => t.failed,
  offline: (t) => t.offline,
};

/** The embed's outline with no map in it: where the title goes, where the map goes, where the credit goes. */
export function EmbedFrame({ header, children, busy }: { header: ReactNode; children?: ReactNode; busy?: boolean }) {
  return (
    <main aria-busy={busy} className="flex h-dvh flex-col bg-panel font-ui text-sm text-ink">
      <div className="shrink-0 px-3 pt-2.5 pb-2 sm:px-4 sm:pt-3 sm:pb-2.5">{header}</div>
      <div className="min-h-0 flex-1 bg-well">{children}</div>
      <div className="h-7 shrink-0 border-t border-rule" />
    </main>
  );
}

function Bar({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block rounded-key bg-rule ${className}`} />;
}

/** Loading: the frame with the title's lines held open, so nothing jumps when the map arrives. */
export function EmbedLoading() {
  return (
    <EmbedFrame
      busy
      header={
        <>
          <Bar className="h-6 w-3/5 max-w-md" />
          <Bar className="mt-2 h-3.5 w-4/5 max-w-2xl" />
          <Bar className="mt-2 h-3 w-40" />
          <p className="sr-only" role="status">
            {EMBED_STRINGS.en.loading} · <span lang="ar">{EMBED_STRINGS.ar.loading}</span>
          </p>
        </>
      }
    />
  );
}

/**
 * A plain sentence for a reader where the map would be. No map has loaded, so
 * its language is not known: the sentence is given in both.
 */
export function EmbedStatement({ kind, busy, onRetry }: { kind: StatementKind; busy?: boolean; onRetry?: () => void }) {
  const sentence = SENTENCE[kind];
  return (
    <EmbedFrame
      header={
        <div role={kind === "failed" ? "alert" : "status"}>
          <p className="font-title text-lg leading-tight font-semibold text-ink">{sentence(EMBED_STRINGS.en)}</p>
          <p dir="rtl" lang="ar" className="mt-1 text-start font-title text-lg leading-snug font-semibold text-ink">
            {sentence(EMBED_STRINGS.ar)}
          </p>
          {onRetry ? (
            <button
              type="button"
              disabled={busy}
              onClick={onRetry}
              className="mt-2 inline-flex h-10 items-center gap-2 rounded-field border border-rule-strong bg-panel px-4 text-sm font-semibold text-ink hover:bg-well disabled:opacity-60"
            >
              {busy ? EMBED_STRINGS.en.retrying : EMBED_STRINGS.en.retry}
              <span aria-hidden="true" className="text-rule-strong">
                ·
              </span>
              <span lang="ar" dir="rtl">
                {busy ? EMBED_STRINGS.ar.retrying : EMBED_STRINGS.ar.retry}
              </span>
            </button>
          ) : null}
        </div>
      }
    />
  );
}
