import { StateBadge } from "@/components/state-badge";
import { selectChangeSet, selectSaveStatus, useEditorStore, type ChangeSet } from "@/editor/store";
import { useLang } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";
import { formatClockTime } from "../shared/format";

/** How many separate things the next save would send. */
export function countChanges(changes: ChangeSet): number {
  return (
    changes.put.length +
    changes.delete.length +
    (changes.settings !== null ? 1 : 0) +
    (changes.title !== null ? 1 : 0) +
    (changes.uiDir !== null ? 1 : 0)
  );
}

export function useUnsavedCount(): number {
  return useEditorStore((state) => countChanges(selectChangeSet(state)));
}

/** Where saving stands, as a shape and words: saved at a time, a count of unsaved changes, or saving. */
export function SaveStatus({ className }: { className?: string }) {
  const t = useEditorStrings();
  const lang = useLang();
  const status = useEditorStore(selectSaveStatus);
  const savedAt = useEditorStore((state) => state.meta.updatedAt);
  const unsaved = useUnsavedCount();

  if (status === "read_only") {
    return (
      <StateBadge state="readonly" className={className}>
        {t.save.readOnly}
      </StateBadge>
    );
  }
  if (status === "saving") {
    return (
      <StateBadge state="unsaved" className={className}>
        {t.save.saving}
      </StateBadge>
    );
  }
  if (status === "unsaved" || status === "error") {
    return (
      <StateBadge state="unsaved" className={className}>
        <span className="tabular-nums">{status === "error" ? t.save.notSaved(unsaved) : t.save.unsaved(unsaved)}</span>
      </StateBadge>
    );
  }
  return (
    <StateBadge state="draft" className={className}>
      <span className="tabular-nums">{t.save.savedAt(formatClockTime(savedAt, lang))}</span>
    </StateBadge>
  );
}
