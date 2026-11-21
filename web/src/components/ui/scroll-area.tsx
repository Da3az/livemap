import * as React from "react"
import { cn } from "cn"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  // Use native scrollbar-width and scrollbar-color to customize the scrollbar.
  return (
    <div
      data-slot="scroll-area"
      className={cn(
        "relative overflow-auto [scrollbar-color:var(--rule-strong)_transparent] [scrollbar-width:thin] focus-visible:-outline-offset-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollArea }
