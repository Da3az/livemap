import { cn } from "cn";
import { useApi } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { formatShortcut, selectIsDirty, shortcutFor, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import { useEditorRuntime } from "../runtime";
import { isMac } from "../shared/format";
import { useEditorLayout } from "../shared/layout";
import { Tip } from "../shared/tip";
import { useEditorUi } from "../shared/ui";
import { SaveStatus } from "./save-status";

/**
 * Saving as a state first and a command second: the badge says where the
 * draft stands, and the button beside it fills in only when there is
 * something to save. On a read-only map only the state shows.
 */
export function SaveControl() {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const api = useApi();
  const { touch } = useEditorLayout();
  const dirty = useEditorStore(selectIsDirty);
  const saving = useEditorStore((state) => state.save.kind === "saving");
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  return (
    <div className={cn("flex shrink-0 items-center gap-1 rounded-field border border-rule ps-2.5", readOnly ? "pe-2.5" : "pe-0.5", touch ? "h-11" : "h-9")}>
      <SaveStatus className="text-xs whitespace-nowrap" />
      {readOnly ? null : (
        <Tip label={t.top.saveTip} keys={formatShortcut(shortcutFor("file.save")?.keys ?? "", isMac())}>
          <Button
            variant={dirty && !saving ? "default" : "ghost"}
            size={touch ? "touch" : "sm"}
            isDisabled={!dirty || saving}
            onPress={() => void store.save(api)}
            className="ms-1"
          >
            {saving ? t.save.saving : t.top.save}
          </Button>
        </Tip>
      )}
    </div>
  );
}

/**
 * Editing or previewing: a mode, so a two-way switch rather than a button.
 * Drawn as a pair of tabs with an underline, not as filled segments, so it
 * does not read as one more setting beside the save state.
 */
export function ModeSwitch() {
  const t = useEditorStrings();
  const ui = useEditorUi();
  const runtime = useEditorRuntime();
  const { touch } = useEditorLayout();
  return (
    <ToggleButtonGroup
      aria-label={t.top.mode}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[ui.previewOpen ? "preview" : "edit"]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next === "preview" && !ui.previewOpen) runtime.openPreview();
        else if (next === "edit" && ui.previewOpen) ui.closePreview();
      }}
      className={cn("flex shrink-0 items-stretch self-stretch", touch ? "gap-1" : "gap-0.5")}
    >
      {(["edit", "preview"] as const).map((id) => (
        <ToggleButton
          key={id}
          id={id}
          className={cn(
            "relative flex cursor-default items-center px-2 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors duration-100 -outline-offset-4 hover:text-ink",
            "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-pill after:bg-transparent hover:after:bg-rule-strong",
            "data-selected:font-semibold data-selected:text-ink data-selected:after:bg-ink",
            "data-focus-visible:outline-2 data-focus-visible:outline-focus",
            touch && "min-w-11 px-3",
          )}
        >
          {id === "edit" ? t.top.editing : t.top.preview}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
