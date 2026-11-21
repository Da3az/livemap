import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import {
  ToggleButton as TogglePrimitive,
  type ToggleButtonProps,
} from "react-aria-components"

const toggleVariants = cva(
  "group/toggle inline-flex cursor-default items-center justify-center gap-1 rounded-field text-xs font-medium whitespace-nowrap text-ink-2 transition-colors duration-100 hover:bg-well hover:text-ink data-disabled:pointer-events-none data-disabled:text-ink-3 data-disabled:data-selected:bg-rule data-disabled:data-selected:text-ink-3 data-selected:bg-ink data-selected:text-panel data-pressed:bg-rule [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-rule-strong bg-panel",
      },
      size: {
        default: "h-field min-w-field px-2.5",
        sm: "h-6 min-w-6 px-2",
        lg: "h-row min-w-row px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: ToggleButtonProps & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
