import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Group, type GroupProps } from "react-aria-components"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { fieldBox, fieldHover } from "@/components/ui/styles"

/*
 * One field box holding a text control and its addons. The box, not the inner
 * control, shows hover, focus, disabled and invalid, so the addons sit inside the state.
 */
function InputGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="input-group"
      className={cn(
        "group/input-group relative flex h-field w-full min-w-0 items-center outline-none",
        fieldBox,
        fieldHover,
        "has-[[data-slot=input-group-control]:focus-visible]:outline-2 has-[[data-slot=input-group-control]:focus-visible]:outline-offset-2 has-[[data-slot=input-group-control]:focus-visible]:outline-focus has-[[data-slot=input-group-control]:focus-visible]:outline-solid",
        "has-disabled:pointer-events-none has-disabled:border-dashed has-disabled:bg-well has-disabled:text-ink-3 data-disabled:border-dashed data-disabled:bg-well data-disabled:text-ink-3",
        "has-[[data-slot][aria-invalid=true]]:border-danger has-[[data-slot][aria-invalid=true]]:bg-danger-wash data-invalid:border-danger data-invalid:bg-danger-wash",
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto has-[>[data-align=block-end]]:[&>input]:pt-2 has-[>[data-align=block-start]]:[&>input]:pb-2 has-[>[data-align=inline-end]]:[&>input]:pe-1 has-[>[data-align=inline-start]]:[&>input]:ps-1",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-1.5 text-sm text-ink-3 select-none [&>svg]:shrink-0",
  {
    variants: {
      align: {
        "inline-start":
          "order-first ps-2 has-[>button]:ps-0.5",
        "inline-end":
          "order-last pe-2 has-[>button]:pe-0.5",
        "block-start":
          "order-first w-full justify-start px-2 pt-1.5 text-xs [.border-b]:pb-1.5",
        "block-end":
          "order-last w-full justify-start px-2 pb-1.5 text-xs [.border-t]:pt-1.5",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "flex items-center gap-1 text-sm",
  {
    variants: {
      size: {
        xs: "h-6 rounded-key px-1.5 text-xs",
        sm: "h-6 rounded-key px-2",
        "icon-xs": "size-6 rounded-key p-0",
        "icon-sm": "size-field rounded-key p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset"
  }) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-sm text-ink-3 tabular-nums [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "h-full flex-1 rounded-none border-0 bg-transparent focus-visible:outline-none disabled:border-0 disabled:bg-transparent aria-invalid:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-1.5 focus-visible:outline-none disabled:border-0 disabled:bg-transparent aria-invalid:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
