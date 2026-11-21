"use client"

import * as React from "react"
import { cn } from "cn"
import {
  composeRenderProps,
  TextArea as TextareaPrimitive,
} from "react-aria-components"

import {
  fieldBox,
  fieldDisabled,
  fieldHover,
  fieldInvalid,
} from "@/components/ui/styles"

function Textarea({
  className,
  ...props
}: React.ComponentProps<typeof TextareaPrimitive>) {
  return (
    <TextareaPrimitive
      data-slot="textarea"
      className={composeRenderProps(className, (className) =>
        cn(
          "flex field-sizing-content min-h-14 w-full px-2 py-1.5 leading-normal placeholder:text-ink-3",
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

export { Textarea }
