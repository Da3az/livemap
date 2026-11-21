"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Cell as CellPrimitive,
  Column as ColumnPrimitive,
  Row as RowPrimitive,
  TableBody as TableBodyPrimitive,
  TableFooter as TableFooterPrimitive,
  TableHeader as TableHeaderPrimitive,
  Table as TablePrimitive,
  type CellProps,
  type ColumnProps,
  type RowProps,
  type TableBodyProps,
  type TableFooterProps,
  type TableHeaderProps,
  type TableProps,
} from "react-aria-components"

function Table({ className, ...props }: TableProps) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <TablePrimitive
        data-slot="table"
        className={cn(
          "w-full caption-bottom border-collapse text-sm text-ink",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader<T>({ className, ...props }: TableHeaderProps<T>) {
  return (
    <TableHeaderPrimitive
      data-slot="table-header"
      className={cn(
        "[&_tr]:border-b [&_tr]:border-rule-strong [&_tr]:hover:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function TableBody<T>({ className, ...props }: TableBodyProps<T>) {
  return (
    <TableBodyPrimitive
      data-slot="table-body"
      className={cn(
        "data-empty:h-row data-empty:text-start data-empty:text-ink-3 [&_tr:last-child]:border-0",
        className
      )}
      {...props}
    />
  )
}

function TableFooter<T>({ className, ...props }: TableFooterProps<T>) {
  return (
    <TableFooterPrimitive
      data-slot="table-footer"
      className={cn(
        "border-t border-rule-strong font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow<T>({ className, ...props }: RowProps<T>) {
  return (
    <RowPrimitive
      data-slot="table-row"
      className={cn(
        "h-row border-b border-rule transition-colors duration-100 hover:bg-well has-aria-expanded:bg-well data-selected:bg-selected data-selected:font-medium data-selected:outline data-selected:-outline-offset-1 data-selected:outline-survey data-selected:hover:bg-selected data-focus-visible:-outline-offset-2 data-disabled:text-ink-3",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: ColumnProps) {
  return (
    <ColumnPrimitive
      data-slot="table-head"
      className={cn(
        "h-field px-2 text-start align-middle text-xs font-medium whitespace-nowrap text-ink-3 data-focus-visible:-outline-offset-2 [&:has([data-slot=checkbox])]:pe-0 [&:has([role=checkbox])]:pe-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: CellProps) {
  return (
    <CellPrimitive
      data-slot="table-cell"
      className={cn(
        "px-2 py-1 align-middle whitespace-nowrap data-focus-visible:-outline-offset-2 [&:has([data-slot=checkbox])]:pe-0 [&:has([role=checkbox])]:pe-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"figcaption">) {
  return (
    <figcaption
      data-slot="table-caption"
      className={cn(
        "mt-2 text-start text-xs text-ink-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
