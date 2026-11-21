"use client"

import { cn } from "cn"
import {
  composeRenderProps,
  RadioGroup as RadioGroupPrimitive,
  Radio as RadioPrimitive,
  type RadioGroupProps,
  type RadioProps,
} from "react-aria-components"

import { focusMark } from "@/components/ui/styles"

function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn(
        "grid w-full gap-2 data-[orientation=horizontal]:flex data-[orientation=horizontal]:flex-wrap data-[orientation=horizontal]:gap-4",
        className
      )}
      {...props}
    />
  )
}

/* One of several: a ring that gains a solid centre. Round because it is a point, not a box. */
function RadioGroupItem({ className, children, ...props }: RadioProps) {
  return (
    <RadioPrimitive
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item peer relative flex size-4 shrink-0 items-center justify-center rounded-pill border border-rule-strong bg-panel text-survey transition-colors duration-100 after:absolute after:-inset-1.5 data-hovered:border-ink-3 data-selected:border-survey data-invalid:border-danger data-invalid:text-danger data-disabled:border-dashed data-disabled:bg-well data-disabled:text-ink-3 data-disabled:data-selected:border-rule-strong",
        focusMark,
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span
            data-slot="radio-group-indicator"
            className="grid place-content-center"
          >
            {isSelected && <span className="size-2 rounded-pill bg-current" />}
          </span>
          {children}
        </>
      ))}
    </RadioPrimitive>
  )
}

export { RadioGroup, RadioGroupItem }
