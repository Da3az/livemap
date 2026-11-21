import { useEffect, useRef, useState } from "react";
import { useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";

/**
 * The map title, edited where it stands. It is set in the news serif and in
 * the title's own direction, which may differ from the editor's.
 * Enter commits, Escape puts the old title back.
 */
export function TitleField({ className }: { className?: string }) {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const title = useEditorStore((state) => state.doc.title);
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const reverting = useRef(false);

  /* An undo while the field is open must not leave a stale draft behind. */
  useEffect(() => setDraft(null), [title]);

  const commit = (): void => {
    if (draft === null) return;
    const value = draft.trim();
    setDraft(null);
    if (value === "" || value === title.value) return;
    store.setTitle({ value, dir: title.dir });
    store.closeStep();
  };

  return (
    <input
      ref={input}
      aria-label={t.top.titleLabel}
      title={readOnly ? title.value : t.top.titleHint}
      dir={title.dir}
      readOnly={readOnly}
      value={draft ?? title.value}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (reverting.current) {
          reverting.current = false;
          setDraft(null);
        } else commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.current?.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          reverting.current = true;
          input.current?.blur();
        }
      }}
      className={
        "w-full min-w-0 truncate rounded-field border border-transparent bg-transparent px-1.5 font-title font-medium text-ink outline-offset-0 transition-colors duration-100 read-only:cursor-default hover:not-read-only:border-rule focus:not-read-only:border-rule-strong focus:not-read-only:bg-panel " +
        (className ?? "")
      }
    />
  );
}
