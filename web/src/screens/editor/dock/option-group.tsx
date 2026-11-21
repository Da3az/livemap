import { cn } from "cn";
import type { ReactNode } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { useEditorLayout } from "../shared/layout";

export interface Option<T extends string> {
  id: T;
  label: string;
  drawing: ReactNode;
}

/** A single choice among drawn options: the dash that draws the dash, the head that draws the head. */
export function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const { touch } = useEditorLayout();
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={value === null ? [] : [value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        const found = options.find((option) => option.id === next);
        if (found) onChange(found.id);
      }}
      className="flex items-center overflow-hidden rounded-field border border-rule-strong bg-panel"
    >
      {options.map((option) => (
        <ToggleButton
          key={option.id}
          id={option.id}
          aria-label={option.label}
          className={cn(
            "flex cursor-default items-center justify-center px-1.5 text-ink-2 -outline-offset-2 transition-colors duration-100 not-first:border-s not-first:border-rule-strong hover:bg-well hover:text-ink data-selected:bg-ink data-selected:text-panel",
            touch ? "h-11 min-w-11" : "h-6",
          )}
        >
          <span title={option.label} className="flex">
            {option.drawing}
          </span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
