import type { ReactElement } from "react";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A tooltip for a control whose word alone does not say everything: what it
 * will do, and its shortcut.
 */
export function Tip({ label, keys, children }: { label: string; keys?: string | undefined; children: ReactElement }) {
  return (
    <TooltipTrigger delay={500} closeDelay={0}>
      {children}
      <Tooltip>
        <span>{label}</span>
        {keys ? (
          <span dir="ltr" className="font-medium tabular-nums opacity-70">
            {keys}
          </span>
        ) : null}
      </Tooltip>
    </TooltipTrigger>
  );
}
