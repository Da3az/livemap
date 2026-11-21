import { cn } from "cn";
import { Icon, type IconName } from "@/components/icons";

export type ProductState = "draft" | "unsaved" | "live" | "archived" | "guest" | "readonly";

const STATES: Record<ProductState, { icon: IconName; color: string }> = {
  draft: { icon: "stateDraft", color: "text-state-draft" },
  unsaved: { icon: "stateUnsaved", color: "text-state-unsaved" },
  live: { icon: "stateLive", color: "text-state-live" },
  archived: { icon: "stateArchived", color: "text-state-archived" },
  guest: { icon: "stateGuest", color: "text-state-guest" },
  readonly: { icon: "stateReadonly", color: "text-state-readonly" },
};

/**
 * A product state: its own shape, its own colour, and always a word.
 * The word is passed in so it can be translated and made specific ("Live · v12").
 */
export function StateBadge({ state, children, className }: { state: ProductState; children: React.ReactNode; className?: string }) {
  const { icon, color } = STATES[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-ink", className)}>
      <Icon name={icon} size={12} className={color} />
      {children}
    </span>
  );
}
