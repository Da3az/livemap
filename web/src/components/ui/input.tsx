"use client"

import * as React from "react"
import { cn } from "cn"
import {
  composeRenderProps,
  Input as InputPrimitive,
} from "react-aria-components"

import {
  fieldBox,
  fieldDisabled,
  fieldHover,
  fieldInvalid,
} from "@/components/ui/styles"

function Input({
  className,
  type,
  ...props
}: React.ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={composeRenderProps(className, (className) =>
        cn(
          "h-field w-full min-w-0 px-2 placeholder:text-ink-3",
          fieldBox,
          fieldHover,
          fieldDisabled,
          fieldInvalid,
          className
        )
      )}
      {...props}
    />
  )
}

export { Input }
