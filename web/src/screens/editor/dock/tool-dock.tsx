import { cn } from "cn";
import { useEffect, useRef } from "react";
import { ToggleButton, Toolbar } from "react-aria-components";
import type { ToolId } from "@/editor/controller";
import { Icon } from "@/components/icons";
import { formatShortcut, shortcutFor, shortcutForTool, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useLang } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";
import { Timeline } from "@/screens/editor/extras";
import { isMac } from "../shared/format";
import { useEditorLayout } from "../shared/layout";
import { useEditorUi } from "../shared/ui";
import { Tip } from "../shared/tip";
import { DrawProgress } from "./draw-progress";
import { DrawStyleStrip } from "./draw-style";

const TOOLS: ToolId[] = ["select", "area", "line", "arrow", "frontline", "point", "annotation"];

function Key({ children }: { children: string }) {
  return (
    <kbd
      dir="ltr"
      aria-hidden="true"
      className="flex h-4 min-w-4 items-center justify-center rounded-key border border-current px-0.5 font-ui text-2xs font-medium opacity-70 @max-4xl/map:hidden"
    >
      {children}
    </kbd>
  );
}

/**
 * The tools, over the bottom of the map: each with its word and its key. The
 * active tool is a filled pill in heavier type, so it does not rest on colour.
 * Above it sit the styling for the active tool and, while drawing, what the
 * tool expects next; below it, the timeline.
 */
export function ToolDock({ onHeight }: { onHeight?: (height: number) => void }) {
  const t = useEditorStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const { touch, mode } = useEditorLayout();
  const ui = useEditorUi();
  const tool = useEditorStore((state) => state.tool);
  const snapping = useEditorStore((state) => state.view.snapping);
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const mac = isMac();
  const fixed = useRef<HTMLDivElement>(null);
  /*
   * A tablet with a pane slid over the map leaves about 540px: the tools keep
   * their icons and keys, and only the active one keeps its word.
   */
  const compact = mode === "tablet" && ui.overlayPane !== null;

  /* The furniture and zoom controls stand clear of the dock and the timeline, however tall those are. */
  useEffect(() => {
    const element = fixed.current;
    if (!element || !onHeight) return undefined;
    const observer = new ResizeObserver(() => onHeight(element.offsetHeight));
    observer.observe(element);
    onHeight(element.offsetHeight);
    return () => observer.disconnect();
  }, [onHeight]);

  const item = cn(
    "flex shrink-0 cursor-default items-center gap-1.5 rounded-pill px-3 text-sm @max-3xl/map:gap-1 @max-3xl/map:px-2 font-medium whitespace-nowrap text-ink-2 transition-colors duration-100 hover:bg-well hover:text-ink data-disabled:opacity-50 data-selected:bg-survey data-selected:font-semibold data-selected:text-on-survey",
    touch ? "h-11 px-2.5" : "h-dock",
  );

  return (
    <div
      ref={fixed}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-9 z-20 flex flex-col items-center gap-2 px-3 transition-[padding] duration-200 motion-reduce:transition-none",
        /* On a tablet a pane slides over one side of the map: the dock and timeline re-centre in what is left. */
        mode === "tablet" && ui.overlayPane === "list" && "ps-list",
        mode === "tablet" && ui.overlayPane === "inspector" && "pe-inspector",
      )}
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
        {readOnly ? null : <DrawStyleStrip compact={compact} />}
        <DrawProgress />
      </div>
      <Toolbar
        aria-label={t.dock.label}
        className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-pill border border-rule-strong bg-panel p-1 shadow-dock"
      >
        {TOOLS.map((id) => {
          const shortcut = shortcutForTool(id);
          const word = shortcut?.label[lang] ?? id;
          if (compact) {
            const active = tool === id;
            return (
              <ToggleButton
                key={id}
                aria-label={word}
                isSelected={active}
                isDisabled={readOnly && id !== "select"}
                onChange={() => store.setTool(id)}
                className={cn(item, "relative gap-1 px-2.5", !active && "min-w-11 justify-center")}
              >
                <Icon name={id} />
                {active ? <span aria-hidden="true">{word}</span> : null}
                {shortcut ? (
                  <kbd dir="ltr" aria-hidden="true" className="absolute end-1 top-0.5 font-ui text-2xs leading-none font-medium opacity-60">
                    {shortcut.keys}
                  </kbd>
                ) : null}
              </ToggleButton>
            );
          }
          return (
            <ToggleButton
              key={id}
              isSelected={tool === id}
              isDisabled={readOnly && id !== "select"}
              onChange={() => store.setTool(id)}
              className={item}
            >
              <Icon name={id} />
              {word}
              {shortcut && !touch ? <Key>{shortcut.keys}</Key> : null}
            </ToggleButton>
          );
        })}
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-rule-strong" />
        <Tip label={t.dock.snapTip} keys={formatShortcut(shortcutFor("view.toggleSnapping")?.keys ?? "", mac)}>
          <ToggleButton
            isSelected={snapping}
            isDisabled={readOnly}
            onChange={(on) => store.setSnapping(on)}
            aria-label={snapping ? t.dock.snapOn : t.dock.snapOff}
            className={cn(item, "data-selected:bg-well data-selected:font-medium data-selected:text-ink")}
          >
            <span
              aria-hidden="true"
              className={cn("size-2.5 rounded-pill border-2 border-current", snapping ? "bg-current" : "bg-transparent")}
            />
            {compact ? null : t.dock.snap}
          </ToggleButton>
        </Tip>
      </Toolbar>
      {/* The timeline takes the map's width, up to a comfortable reading length; it folds its controls into a menu below that. */}
      <div className="pointer-events-auto flex w-full max-w-5xl justify-center">
        <Timeline />
      </div>
    </div>
  );
}
