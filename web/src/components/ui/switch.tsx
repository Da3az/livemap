"use client"

import { cn } from "cn"
import {
  composeRenderProps,
  Switch as SwitchPrimitive,
  type SwitchProps as SwitchPrimitiveProps,
} from "react-aria-components"

import { focusMark } from "@/components/ui/styles"

/*
 * On or off, applied at once. A squared track rather than a pill: pills are
 * kept for the dock, publish and the timeline. Off is hollow, on is filled and
 * the thumb has moved, so the state reads without colour.
 */
function Switch({
  className,
  size = "default",
  children,
  ...props
}: SwitchPrimitiveProps & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-field border border-rule-strong bg-panel p-px transition-colors duration-100 after:absolute after:-inset-1.5 data-hovered:border-ink-3 data-selected:border-survey data-selected:bg-survey data-invalid:border-danger data-disabled:border-dashed data-disabled:bg-well data-disabled:data-selected:border-rule-strong data-[size=default]:h-4.5 data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        focusMark,
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span
            data-slot="switch-thumb"
            data-selected={isSelected || undefined}
            className="pointer-events-none block rounded-key bg-ink-3 transition-[margin,background-color] duration-100 group-data-disabled/switch:bg-rule-strong group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 data-selected:bg-on-survey group-data-disabled/switch:data-selected:bg-ink-3 group-data-[size=default]/switch:data-selected:ms-3.5 group-data-[size=sm]/switch:data-selected:ms-2.5"
          />
          {children}
        </>
      ))}
    </SwitchPrimitive>
  )
}

export { Switch }
