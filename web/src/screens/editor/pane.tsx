import { cn } from "cn";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useEditorLayout } from "./shared/layout";

/**
 * One of the two docked panes. Square, flush to the window edge, a hairline
 * rule toward the map. On a tablet it slides over the map from its edge.
 */
export function Pane({ side, overlay, label, children }: { side: "start" | "end"; overlay: boolean; label: string; children: ReactNode }) {
  return (
    <aside
      aria-label={label}
      data-pane={side}
      className={cn(
        "flex min-h-0 shrink-0 flex-col bg-panel",
        side === "start" ? "w-list border-e border-rule" : "w-inspector border-s border-rule",
        overlay &&
          cn(
            "absolute inset-y-0 z-30 max-w-full border-rule-strong shadow-overlay duration-200 ease-out-quiet animate-in",
            side === "start"
              ? "start-0 ltr:slide-in-from-left rtl:slide-in-from-right"
              : "end-0 ltr:slide-in-from-right rtl:slide-in-from-left",
          ),
      )}
    >
      {children}
    </aside>
  );
}

/** The heading of a pane: a serif title, whatever belongs beside it, and a way to put the pane away. */
export function PaneHeader({
  title,
  children,
  closeLabel,
  onClose,
}: {
  title: ReactNode;
  children?: ReactNode;
  closeLabel?: string;
  onClose?: () => void;
}) {
  const { touch } = useEditorLayout();
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-rule ps-3 pe-1.5">
      <h2 className="min-w-0 flex-1 truncate font-title text-lg font-medium text-ink">{title}</h2>
      {children}
      {onClose ? (
        <Button variant="ghost" size={touch ? "icon-lg" : "icon"} aria-label={closeLabel} onPress={onClose} className={touch ? "size-11" : undefined}>
          <Icon name="close" />
        </Button>
      ) : null}
    </header>
  );
}
