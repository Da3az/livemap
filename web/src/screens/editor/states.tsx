import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ApiError } from "@/api/client";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { SHORTCUTS } from "@/editor/store";
import { LangProvider } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";

/**
 * The editor before there is a map to put in it. It keeps the real
 * structure — the bar, the feature list, the map area and the dock — so what
 * loads, or fails to, lands where it belongs. The direction is not known
 * yet, so this is in the shell's language.
 */
/* Widths of the placeholder rows, so the list reads as a list of names rather than a block. */
const ROW_WIDTHS = ["w-3/5", "w-4/5", "w-1/2", "w-2/3", "w-3/4", "w-2/5", "w-3/5", "w-1/2", "w-4/5", "w-2/3", "w-3/5", "w-1/2"];

function PlaceholderRows() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-0 p-1">
      {ROW_WIDTHS.map((width, index) => (
        <div key={index} className={index % 6 === 0 ? "flex h-row items-center gap-2 ps-1.5" : "flex h-row items-center gap-2 ps-6"}>
          <span className="size-4 shrink-0 rounded-key bg-rule" />
          <span className={`h-2.5 rounded-pill ${index % 6 === 0 ? "bg-plum/25" : "bg-rule"} ${width}`} />
        </div>
      ))}
    </div>
  );
}

function Frame({ title, status, loading = false, children }: { title: ReactNode; status?: ReactNode; loading?: boolean; children?: ReactNode }) {
  const t = useEditorStrings();
  const tools = SHORTCUTS.filter((shortcut) => shortcut.tool !== undefined);
  return (
    <div aria-busy={loading || undefined} className="flex h-dvh flex-col overflow-hidden bg-page font-ui text-sm text-ink">
      <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-rule bg-panel ps-2 pe-3">
        <Link to="/maps" className="flex h-10 shrink-0 items-center gap-1 rounded-field px-2 text-sm font-medium text-ink-2 hover:bg-well hover:text-ink">
          <Icon name="chevron" className="rotate-180" />
          {t.top.back}
        </Link>
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-rule" />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
          {loading ? (
            <>
              <span aria-hidden="true" className="h-4 w-80 max-w-full rounded-pill bg-rule" />
              <span aria-hidden="true" className="h-2 w-32 rounded-pill bg-rule" />
            </>
          ) : (
            <div className="truncate px-1.5 font-title text-xl font-medium text-ink-3">{title}</div>
          )}
        </div>
        {loading ? (
          <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
            <span className="h-field w-16 rounded-field border border-rule" />
            <span className="h-field w-20 rounded-field border border-rule" />
            <span className="ms-2 h-10 w-44 rounded-pill border border-rule" />
          </span>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-list shrink-0 flex-col border-e border-rule bg-panel lg:flex">
          <div className="flex h-11 shrink-0 items-center border-b border-rule px-3 font-title text-lg font-medium">{t.list.paneLabel}</div>
          {loading ? <PlaceholderRows /> : null}
        </aside>
        <main className="relative min-w-0 flex-1 bg-well">
          {children ? (
            <div className="absolute inset-x-0 top-1/3 flex justify-center px-4">
              <div className="w-full max-w-md">{children}</div>
            </div>
          ) : null}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-9 hidden justify-center px-3 sm:flex">
            <div className="flex items-center gap-0.5 rounded-pill border border-rule-strong bg-panel p-1 opacity-50 shadow-dock">
              {tools.map((tool) => (
                <span key={tool.id} className="flex h-dock items-center gap-1.5 rounded-pill px-3 text-sm font-medium text-ink-2">
                  <Icon name={tool.tool ?? "select"} />
                  {tool.label.en}
                </span>
              ))}
            </div>
          </div>
        </main>
      </div>
      <footer className="flex h-7 shrink-0 items-center border-t border-rule bg-panel px-3 text-xs text-ink-2">{status}</footer>
    </div>
  );
}

export function EditorLoading() {
  return (
    <LangProvider lang="en">
      <LoadingFrame />
    </LangProvider>
  );
}

function LoadingFrame() {
  const t = useEditorStrings();
  return (
    <Frame title={t.load.openingTitle} loading status={<span role="status">{t.load.opening}</span>} />
  );
}

function FailedFrame({ error, onRetry, retrying }: { error: ApiError; onRetry: () => void; retrying: boolean }) {
  const t = useEditorStrings();
  const back = (
    <Link to="/maps" className="rounded-key text-sm font-medium text-bathy underline decoration-1 underline-offset-2 hover:decoration-2">
      {t.load.backToMaps}
    </Link>
  );
  if (error.code === "not_found") {
    return (
      <Frame title={t.load.notFoundTitle}>
        <Notice tone="warning" title={t.load.notFoundTitle}>
          <p>{t.load.notFoundBody}</p>
          <p className="mt-2">{back}</p>
        </Notice>
      </Frame>
    );
  }
  if (error.code === "forbidden") {
    return (
      <Frame title={t.load.forbiddenTitle}>
        <Notice tone="danger" title={t.load.forbiddenTitle}>
          <p dir="auto">{error.reason ?? t.load.forbiddenBody}</p>
          <p className="mt-2">{back}</p>
        </Notice>
      </Frame>
    );
  }
  const body = error.code === "network" ? t.load.offlineBody : error.code === "rate_limited" ? t.load.rateLimitedBody : t.load.failedBody;
  return (
    <Frame title={t.load.failedTitle}>
      <Notice tone="danger" title={t.load.failedTitle}>
        <p>{body}</p>
        <div className="mt-2 flex items-center gap-3">
          <Button isDisabled={retrying} onPress={onRetry}>
            {retrying ? t.load.retrying : t.load.retry}
          </Button>
          {back}
        </div>
      </Notice>
    </Frame>
  );
}

export function EditorLoadFailed(props: { error: ApiError; onRetry: () => void; retrying: boolean }) {
  return (
    <LangProvider lang="en">
      <FailedFrame {...props} />
    </LangProvider>
  );
}
