"use client"

import { cn } from "cn"
import {
  Checkbox as CheckboxPrimitive,
  composeRenderProps,
  type CheckboxProps,
} from "react-aria-components"

import { Icon } from "@/components/icons"
import { focusMark } from "@/components/ui/styles"

/* A printed tick box: square, hairline, and the tick is drawn, so the state is a shape. */
function Checkbox({ className, children, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-key border border-rule-strong bg-panel text-on-survey transition-colors duration-100 after:absolute after:-inset-1.5 data-hovered:border-ink-3 data-selected:border-survey data-selected:bg-survey data-indeterminate:border-survey data-indeterminate:bg-survey data-invalid:border-danger data-invalid:not-data-selected:bg-danger-wash data-disabled:border-dashed data-disabled:bg-well data-disabled:text-ink-3 data-disabled:data-selected:border-rule-strong",
        focusMark,
        className
      )}
      {...props}
    >
      {composeRenderProps(
        children,
        (children, { isSelected, isIndeterminate }) => (
          <>
            <span
              data-slot="checkbox-indicator"
              className="grid place-content-center"
            >
              {isIndeterminate ? (
                <Icon name="minus" size={12} />
              ) : isSelected ? (
                <Icon name="check" size={12} />
              ) : null}
            </span>
            {children}
          </>
        )
      )}
    </CheckboxPrimitive>
  )
}

export { Checkbox }
