import { Icon } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import { SHORTCUTS, formatShortcut, useEditorStoreApi } from "@/editor/store";
import { useLang } from "@/i18n";
import { useListStrings } from "@/i18n/editor-list";
import { isMac } from "../shared/format";
import { useEditorLayout } from "../shared/layout";

/**
 * The list before anything is drawn: the same rows the list will have, one
 * per drawing tool, each of which picks that tool up.
 */
export function EmptyList({ readOnly }: { readOnly: boolean }) {
  const t = useListStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const { touch, mode } = useEditorLayout();
  const tools = SHORTCUTS.filter((shortcut) => shortcut.tool !== undefined && shortcut.tool !== "select");

  if (readOnly) return <p className="px-3 py-2 text-sm text-ink-2">{t.emptyReadOnly}</p>;

  return (
    <div className="flex flex-col p-1">
      <p className="px-2 pt-1.5 pb-1 text-2xs font-semibold text-plum">{t.emptyTitle}</p>
      <p className="px-2 pb-2 text-xs text-ink-2">{t.emptyLead}</p>
      <p className="px-2 pb-1 text-2xs font-medium text-ink-3">{t.emptyDrawWith}</p>
      <ul>
        {tools.map((shortcut) => {
          const tool = shortcut.tool;
          if (tool === undefined || tool === "select") return null;
          return (
            <li key={shortcut.id}>
              <button
                type="button"
                disabled={mode === "phone"}
                onClick={() => store.setTool(tool)}
                className={`flex w-full items-center gap-2 rounded-block ps-2 pe-2 text-start text-sm text-ink hover:bg-well ${touch ? "h-11" : "h-row"}`}
              >
                <Icon name={tool} className="text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{shortcut.label[lang]}</span>
                <Kbd>{formatShortcut(shortcut.keys, isMac())}</Kbd>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
