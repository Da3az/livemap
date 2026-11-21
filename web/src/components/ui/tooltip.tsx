"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Focusable,
  Tooltip as TooltipPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
} from "react-aria-components"

function TooltipTrigger({
  delay = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipTriggerPrimitive>) {
  const [trigger, tooltip] = React.Children.toArray(children)
  /* A disabled trigger cannot take focus; Focusable has to be told, or it warns that its child is not focusable. */
  const triggerProps: { isDisabled?: unknown; disabled?: unknown } = React.isValidElement<{ isDisabled?: unknown; disabled?: unknown }>(trigger) ? trigger.props : {}
  const isDisabled = triggerProps.isDisabled === true || triggerProps.disabled === true

  return (
    <TooltipTriggerPrimitive
      data-slot="tooltip-trigger"
      delay={delay}
      {...props}
    >
      <Focusable isDisabled={isDisabled}>
        {trigger as React.ComponentProps<typeof Focusable>["children"]}
      </Focusable>
      {tooltip}
    </TooltipTriggerPrimitive>
  )
}

/* A caption, not a bubble: an inked label with a hard edge and no pointer. */
function Tooltip({
  className,
  placement = "top",
  offset = 6,
  crossOffset = 0,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof TooltipPrimitive>,
  "children" | "className"
> & {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <TooltipPrimitive
      data-slot="tooltip-content"
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cn(
        "z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-key bg-ink px-2 py-1 text-xs font-medium text-panel transition-opacity duration-100 data-entering:opacity-0 data-exiting:opacity-0 **:data-[slot=kbd]:border-panel/40 **:data-[slot=kbd]:text-panel",
        className
      )}
      {...props}
    >
      {children}
    </TooltipPrimitive>
  )
}

export { Tooltip, TooltipTrigger }
