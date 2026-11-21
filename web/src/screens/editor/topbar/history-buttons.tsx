import { Button } from "@/components/ui/button";
import { formatShortcut, selectHistoryInfo, shortcutFor, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useLang } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";
import { isMac } from "../shared/format";
import { useEditorLayout } from "../shared/layout";
import { Tip } from "../shared/tip";

/** Undo and redo, each naming the step it will take back or reapply. */
/** `roomy`: the step name is always written out, as on the tablet's second row; otherwise only on wide screens. */
export function HistoryButtons({ roomy = false }: { roomy?: boolean }) {
  const t = useEditorStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const info = useEditorStore(selectHistoryInfo);
  const { touch } = useEditorLayout();
  const mac = isMac();
  const size = touch ? "touch" : "default";
  const undoStep = info.undoLabel?.[lang] ?? null;
  const redoStep = info.redoLabel?.[lang] ?? null;

  return (
    <div role="group" aria-label={t.top.history} className={roomy ? "flex min-w-0 shrink items-center gap-1" : "flex shrink-0 items-center gap-1"}>
      <Tip label={undoStep ? t.top.undoStep(undoStep) : t.top.nothingToUndo} keys={formatShortcut(shortcutFor("edit.undo")?.keys ?? "", mac)}>
        <Button variant="ghost" size={size} className="shrink-0" isDisabled={!info.canUndo} onPress={() => store.undo()} aria-label={undoStep ? t.top.undoStep(undoStep) : t.top.undo}>
          {t.top.undo}
        </Button>
      </Tip>
      <Tip label={redoStep ? t.top.redoStep(redoStep) : t.top.nothingToRedo} keys={formatShortcut(shortcutFor("edit.redo")?.keys ?? "", mac)}>
        <Button variant="ghost" size={size} className="shrink-0" isDisabled={!info.canRedo} onPress={() => store.redo()} aria-label={redoStep ? t.top.redoStep(redoStep) : t.top.redo}>
          {t.top.redo}
        </Button>
      </Tip>
      {undoStep ? (
        <span aria-hidden="true" className={roomy ? "max-w-48 min-w-0 shrink truncate text-xs text-ink-3" : "hidden max-w-36 min-w-0 shrink truncate text-xs text-ink-3 2xl:block"} title={t.top.undoStep(undoStep)}>
          {undoStep}
        </span>
      ) : null}
    </div>
  );
}
