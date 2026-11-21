import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import {
  Button as ButtonPrimitive,
  Link as LinkPrimitive,
  type ButtonProps as ButtonPrimitiveProps,
  type LinkProps as LinkPrimitiveProps,
} from "react-aria-components"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-default items-center justify-center border border-transparent font-medium whitespace-nowrap transition-colors duration-100 select-none data-disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "rounded-field bg-survey text-on-survey hover:bg-survey-hover data-pressed:bg-survey-pressed data-disabled:border-dashed data-disabled:border-rule-strong data-disabled:bg-well data-disabled:text-ink-3",
        outline:
          "rounded-field border-rule-strong bg-panel text-ink hover:border-ink-3 hover:bg-well aria-expanded:bg-well data-pressed:bg-rule data-disabled:border-dashed data-disabled:border-rule-strong data-disabled:bg-well data-disabled:text-ink-3",
        secondary:
          "rounded-field bg-well text-ink hover:bg-rule data-pressed:bg-rule-strong data-disabled:border-dashed data-disabled:border-rule-strong data-disabled:text-ink-3",
        ghost:
          "rounded-field text-ink-2 hover:bg-well hover:text-ink aria-expanded:bg-well aria-expanded:text-ink data-pressed:bg-rule data-disabled:text-ink-3 data-disabled:opacity-60",
        destructive:
          "rounded-field border-danger bg-panel text-danger hover:bg-danger-wash data-pressed:bg-danger/20 data-disabled:border-dashed data-disabled:border-rule-strong data-disabled:bg-well data-disabled:text-ink-3",
        link: "rounded-key text-bathy underline decoration-1 underline-offset-2 hover:decoration-2 data-disabled:text-ink-3 data-disabled:no-underline",
      },
      size: {
        default: "h-field gap-1.5 px-2.5 text-sm",
        xs: "h-5 gap-1 px-1.5 text-2xs",
        sm: "h-6 gap-1 px-2 text-xs",
        lg: "h-row gap-2 px-3.5 text-sm",
        touch: "h-10 gap-2 px-4 text-base",
        text: "gap-1 text-sm",
        icon: "size-field",
        "icon-xs": "size-5",
        "icon-sm": "size-6",
        "icon-lg": "size-row",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: Omit<ButtonPrimitiveProps, "className"> &
  React.RefAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    className?: string
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

function LinkButton({
  className,
  variant = "default",
  size = "default",
  ...props
}: Omit<LinkPrimitiveProps, "className"> &
  VariantProps<typeof buttonVariants> & {
    className?: string
  }) {
  return (
    <LinkPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, LinkButton, buttonVariants }
