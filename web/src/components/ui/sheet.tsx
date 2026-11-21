import * as React from "react"
import { cn } from "cn"
import {
  Heading,
  ModalOverlay as ModalOverlayPrimitive,
  Modal as ModalPrimitive,
  Dialog as SheetPrimitive,
  DialogTrigger as SheetTriggerPrimitive,
  type ModalOverlayProps as ModalOverlayPrimitiveProps,
  type DialogProps as SheetPrimitiveProps,
  type DialogTriggerProps as SheetTriggerPrimitiveProps,
} from "react-aria-components"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icons"

function SheetTrigger({ ...props }: SheetTriggerPrimitiveProps) {
  return <SheetTriggerPrimitive data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      slot="close"
      data-slot="sheet-close"
      variant={variant}
      size={size}
      className={cn(className)}
      {...props}
    />
  )
}

function SheetOverlay({
  className,
  children,
  ...props
}: Omit<ModalOverlayPrimitiveProps, "className" | "children"> & {
  className?: string
  children: React.ReactNode
}) {
  return (
    <ModalOverlayPrimitive
      data-slot="sheet-overlay"
      isDismissable
      className={cn(
        "fixed inset-0 z-50 bg-scrim transition-opacity duration-200 ease-out-quiet data-entering:opacity-0 data-exiting:opacity-0",
        className
      )}
      {...props}
    >
      {children}
    </ModalOverlayPrimitive>
  )
}

/*
 * Which edge the sheet is docked to. `start` and `end` follow the reading
 * direction; `left` and `right` are kept for callers written against the
 * generated API and mean the same as `start` and `end`, so they mirror in RTL.
 */
type SheetSide = "top" | "bottom" | "start" | "end" | "left" | "right"

const SIDE: Record<SheetSide, "top" | "bottom" | "start" | "end"> = {
  top: "top",
  bottom: "bottom",
  start: "start",
  end: "end",
  left: "start",
  right: "end",
}

function Sheet({
  className,
  children,
  side = "end",
  showCloseButton = true,
  ...props
}: Omit<ModalOverlayPrimitiveProps, "className" | "children"> &
  Pick<React.ComponentProps<typeof ModalPrimitive>, "isDismissable"> & {
    className?: string
    children: React.ReactNode
    side?: SheetSide
    showCloseButton?: boolean
  }) {
  return (
    <SheetOverlay {...props}>
      <ModalPrimitive
        data-slot="sheet-content"
        data-side={SIDE[side]}
        className={cn(
          /* a docked pane that slides a short way in: square, ruled on its open edge, the one shadow */
          "fixed z-50 flex flex-col gap-4 bg-panel text-sm text-ink shadow-overlay transition-[opacity,translate] duration-200 ease-out-quiet outline-none data-entering:opacity-0 data-exiting:opacity-0",
          "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:border-t data-[side=bottom]:border-rule-strong data-[side=bottom]:data-entering:translate-y-4 data-[side=bottom]:data-exiting:translate-y-4",
          "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:border-b data-[side=top]:border-rule-strong data-[side=top]:data-entering:-translate-y-4 data-[side=top]:data-exiting:-translate-y-4",
          "data-[side=start]:inset-y-0 data-[side=start]:start-0 data-[side=start]:w-3/4 data-[side=start]:border-e data-[side=start]:border-rule-strong data-[side=start]:data-entering:-translate-x-4 data-[side=start]:data-exiting:-translate-x-4 rtl:data-[side=start]:data-entering:translate-x-4 rtl:data-[side=start]:data-exiting:translate-x-4 data-[side=start]:sm:max-w-sm",
          "data-[side=end]:inset-y-0 data-[side=end]:end-0 data-[side=end]:w-3/4 data-[side=end]:border-s data-[side=end]:border-rule-strong data-[side=end]:data-entering:translate-x-4 data-[side=end]:data-exiting:translate-x-4 rtl:data-[side=end]:data-entering:-translate-x-4 rtl:data-[side=end]:data-exiting:-translate-x-4 data-[side=end]:sm:max-w-sm",
          className
        )}
      >
        <SheetPrimitive
          data-slot="sheet"
          className="[display:inherit] h-full max-h-[inherit] [flex-direction:inherit] [gap:inherit] outline-none"
        >
          {children}
          {showCloseButton && (
            <SheetClose
              variant="ghost"
              className="absolute top-3 end-3"
              size="icon-sm"
            >
              <Icon name="close" size={14} />
              <span className="sr-only">Close</span>
            </SheetClose>
          )}
        </SheetPrimitive>
      </ModalPrimitive>
    </SheetOverlay>
  )
}

function SheetContent({
  className,
  children,
  side = "end",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof Sheet>) {
  return (
    <Sheet
      className={className}
      side={side}
      showCloseButton={showCloseButton}
      {...props}
    >
      {children}
    </Sheet>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 border-b border-rule p-4 pe-12", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 border-t border-rule p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Heading>, "slot">) {
  return (
    <Heading
      slot="title"
      data-slot="sheet-title"
      className={cn(
        "font-title text-lg font-semibold text-ink",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "slot">) {
  return (
    <div
      data-slot="sheet-description"
      className={cn("text-sm text-ink-2", className)}
      {...props}
    />
  )
}

export {
  type SheetPrimitiveProps,
  type SheetTriggerPrimitiveProps,
  type SheetSide,
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
