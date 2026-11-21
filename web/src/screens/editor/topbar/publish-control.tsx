import { Link } from "react-router";
import { useVersions } from "@/api/hooks";
import { useApi } from "@/app/providers";
import { StateBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { formatShortcut, selectDraftStatus, shallowEqual, shortcutFor, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useLang } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";
import { formatRecent, isMac } from "../shared/format";
import { Tip } from "../shared/tip";
import { useUnsavedCount } from "./save-status";

/** What is live, in words: the version, when it went out and who sent it. */
export function useLiveRecord(): { version: number; at: string; by: string } | null {
  const { id, version } = useEditorStore((state) => ({ id: state.meta.id, version: state.meta.publishedVersion }), shallowEqual);
  const versions = useVersions(id);
  if (version === null) return null;
  const record = versions.data?.versions.find((candidate) => candidate.version === version);
  return record ? { version, at: record.publishedAt, by: record.publishedBy.name } : null;
}

/**
 * Publishing, kept apart from everything else in the bar: a pill holding the
 * live state in words and the one button that changes what readers see.
 */
export function PublishControl({ compact = false }: { compact?: boolean }) {
  const t = useEditorStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const api = useApi();
  const draft = useEditorStore(selectDraftStatus);
  const meta = useEditorStore((state) => state.meta);
  const publishing = useEditorStore((state) => state.publish.kind === "publishing");
  const canPublish = useEditorStore((state) => state.access.canPublish);
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const unsaved = useUnsavedCount();
  const live = useLiveRecord();

  const ahead = Math.max(0, meta.rev - (meta.publishedRev ?? meta.rev)) + unsaved;
  const liveLine = live ? t.publish.publishedBy(formatRecent(live.at, lang), live.by) : null;

  let badge: React.ReactNode;
  let detail: string | null = null;
  if (draft.state === "never_published") {
    badge = <StateBadge state="draft">{t.publish.never}</StateBadge>;
  } else if (draft.state === "live") {
    badge = (
      <StateBadge state="live">
        <span className="tabular-nums">{t.publish.live(draft.liveVersion ?? 0)}</span>
      </StateBadge>
    );
    detail = liveLine;
  } else {
    badge = (
      <StateBadge state="draft">
        <span className="tabular-nums">{t.publish.ahead(ahead)}</span>
      </StateBadge>
    );
    detail = live ? t.publish.liveSince(live.version, formatRecent(live.at, lang), live.by) : t.publish.liveVersion(draft.liveVersion ?? 0);
  }
  if (!canPublish && !readOnly) detail = t.publish.cannot;

  const label = publishing ? t.publish.publishing : draft.state === "draft_ahead" ? t.publish.publishChanges : t.publish.publish;

  return (
    <div className="flex min-w-0 shrink items-center gap-2.5">
      <div
        role="group"
        aria-label={t.publish.group}
        className="flex h-10 min-w-0 shrink items-center gap-3 rounded-pill border border-rule-strong bg-panel ps-3.5 pe-1"
      >
        <div className="flex max-w-44 min-w-0 shrink flex-col justify-center overflow-hidden 2xl:max-w-80" aria-live="polite" title={detail ?? undefined}>
          {badge}
          {detail && !compact ? (
            <span className="truncate text-2xs text-ink-3 tabular-nums max-2xl:hidden" title={detail}>
              {detail}
            </span>
          ) : null}
        </div>
        {readOnly ? null : (
          <Tip label={t.publish.tip} keys={formatShortcut(shortcutFor("file.publish")?.keys ?? "", isMac())}>
            <Button
              className="h-8 shrink-0 rounded-pill px-4 font-semibold"
              isDisabled={publishing || !canPublish}
              onPress={() => void store.publish(api)}
            >
              {draft.state === "draft_ahead" && !publishing ? (
                <>
                  <span className="2xl:hidden">{t.publish.publish}</span>
                  <span className="max-2xl:hidden">{label}</span>
                </>
              ) : (
                label
              )}
            </Button>
          </Tip>
        )}
      </div>
      <Link to={`/maps/${meta.id}/versions`} aria-label={t.publish.history} className="shrink-0 rounded-key text-xs font-medium whitespace-nowrap text-bathy underline decoration-1 underline-offset-2 hover:decoration-2">
        <span className="2xl:hidden">{t.publish.historyShort}</span>
        <span className="max-2xl:hidden">{t.publish.history}</span>
      </Link>
    </div>
  );
}
