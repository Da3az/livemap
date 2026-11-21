import { useEffect, useState } from "react";
import { useBlocker } from "react-router";
import { useApi } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { selectIsDirty, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import { useEditorLayout } from "../shared/layout";
import { useUnsavedCount } from "../topbar/save-status";

/**
 * Stops unsaved work being lost to a navigation. Leaving the page inside the
 * app is held and answered here, in a bar, with three plain choices; closing
 * the tab gets the browser's own warning.
 */
export function LeaveGuard() {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const api = useApi();
  const { touch } = useEditorLayout();
  const dirty = useEditorStore(selectIsDirty);
  const unsaved = useUnsavedCount();
  const [saving, setSaving] = useState(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (blocker.state !== "blocked") return null;
  const size = touch ? "touch" : "default";

  const saveAndLeave = async (): Promise<void> => {
    setSaving(true);
    const result = await store.save(api);
    setSaving(false);
    /* If the save was refused, stay: the save message says why. */
    if (result.kind === "saved" || result.kind === "nothing_to_save") blocker.proceed();
    else blocker.reset();
  };

  return (
    <div role="alert" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning bg-panel px-4 py-2">
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold text-ink tabular-nums">{t.leave.title(unsaved)}</span> <span className="text-ink-2">{t.leave.body}</span>
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <Button size={size} autoFocus isDisabled={saving} onPress={() => void saveAndLeave()}>
          {saving ? t.save.saving : t.leave.saveAndLeave}
        </Button>
        <Button size={size} variant="destructive" isDisabled={saving} onPress={() => blocker.proceed()}>
          {t.leave.discard}
        </Button>
        <Button size={size} variant="outline" isDisabled={saving} onPress={() => blocker.reset()}>
          {t.leave.stay}
        </Button>
      </div>
    </div>
  );
}
