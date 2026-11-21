import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import {
  TabList as TabListPrimitive,
  TabPanel as TabPanelPrimitive,
  Tab as TabPrimitive,
  Tabs as TabsPrimitive,
} from "react-aria-components"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive>) {
  return (
    <TabsPrimitive
      data-slot="tabs"
      className={cn(
        "group/tabs flex gap-3 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

/*
 * `default` is a segmented field: a few views of one thing, the chosen one inked in.
 * `line` is a ruled index: sections of a pane, the chosen one underscored on the rule.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex text-ink-2 group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default:
          "w-fit items-stretch overflow-hidden rounded-field border border-rule-strong bg-panel group-data-horizontal/tabs:h-field",
        line: "items-stretch gap-4 border-rule group-data-horizontal/tabs:h-row group-data-horizontal/tabs:border-b group-data-vertical/tabs:gap-0 group-data-vertical/tabs:border-s",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabListPrimitive> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabListPrimitive
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabPrimitive>) {
  return (
    <TabPrimitive
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex cursor-default items-center justify-center gap-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-100 select-none group-data-vertical/tabs:justify-start data-hovered:text-ink data-disabled:pointer-events-none data-disabled:text-ink-3 data-disabled:line-through [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=default]/tabs-list:flex-1 group-data-[variant=default]/tabs-list:px-2.5 group-data-[variant=default]/tabs-list:-outline-offset-2 group-data-[variant=default]/tabs-list:data-hovered:bg-well group-data-[variant=default]/tabs-list:data-selected:bg-ink group-data-[variant=default]/tabs-list:data-selected:text-panel group-data-horizontal/tabs:group-data-[variant=default]/tabs-list:not-first:border-s group-data-horizontal/tabs:group-data-[variant=default]/tabs-list:not-first:border-rule-strong group-data-vertical/tabs:group-data-[variant=default]/tabs-list:min-h-field",
        "group-data-[variant=line]/tabs-list:text-sm group-data-[variant=line]/tabs-list:data-selected:font-semibold group-data-[variant=line]/tabs-list:data-selected:text-ink group-data-vertical/tabs:group-data-[variant=line]/tabs-list:min-h-field group-data-vertical/tabs:group-data-[variant=line]/tabs-list:ps-3",
        "after:absolute after:bg-ink after:opacity-0 group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:-bottom-px group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-start-px group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-selected:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabPanelPrimitive>) {
  return (
    <TabPanelPrimitive
      data-slot="tabs-content"
      className={cn("flex-1 text-sm text-ink", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
