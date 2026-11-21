import { cn } from "cn";
import type { ReactNode } from "react";
import {
  Input as RacInput,
  NumberField,
  Radio,
  RadioGroup,
  Slider as RacSlider,
  SliderThumb,
  SliderTrack,
} from "react-aria-components";
import type { Mixed } from "@/editor/store";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import { useEditorLayout } from "../shared/layout";

/** The agreed value across the selection, or undefined when the selection disagrees or has no such property. */
export function valueOf<T>(mixed: Mixed<T>): T | undefined {
  return mixed.state === "value" ? mixed.value : undefined;
}

export function isMixed<T>(mixed: Mixed<T>): boolean {
  return mixed.state === "mixed";
}

export function has<T>(mixed: Mixed<T>): boolean {
  return mixed.state !== "none";
}

/** One block of the inspector: a quiet heading, something beside it, and controls shaped by what they set. Rules and spacing do the separating, not colour. */
export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border-b border-rule px-3 pt-2.5 pb-3", className)}>
      <header className="mb-2 flex min-h-5 items-center gap-2">
        <h3 className="text-xs font-semibold text-ink">{title}</h3>
        <div className="ms-auto flex min-w-0 items-center gap-1 text-xs text-ink-2">{aside}</div>
      </header>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

/** A small label over or beside a control. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-xs text-ink-2", className)}>{children}</span>;
}

/** A label at the start and one compact control at the end, for the few settings that really are a single value. */
export function Line({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-field items-center gap-2">
      <Caption className="min-w-0 flex-1">{label}</Caption>
      {children}
    </div>
  );
}

export interface TileOption<T extends string> {
  id: T;
  label: string;
  /** The drawing: what choosing this looks like on the map. */
  draw: ReactNode;
}

/**
 * A choice among a few looks, each drawn, each with its word. The chosen tile
 * has a heavy frame and a bold word, so it never rests on colour alone. No
 * tile is chosen when the selection is mixed.
 */
export function Tiles<T extends string>({
  label,
  options,
  value,
  mixed,
  onChange,
  disabled,
}: {
  label: string;
  options: TileOption<T>[];
  value: T | undefined;
  mixed?: boolean;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const t = useInspectorStrings();
  const { touch } = useEditorLayout();
  return (
    <RadioGroup
      aria-label={mixed ? `${label}: ${t.mixed}` : label}
      orientation="horizontal"
      value={value ?? null}
      isDisabled={disabled}
      onChange={(next) => {
        const found = options.find((option) => option.id === next);
        if (found) onChange(found.id);
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex items-baseline gap-2">
        <Caption>{label}</Caption>
        {mixed ? <span className="text-2xs font-medium text-ink-3">{t.mixed}</span> : null}
      </div>
      <div className="flex gap-1.5">
        {options.map((option) => (
          <Radio
            key={option.id}
            value={option.id}
            className={({ isSelected, isFocusVisible, isDisabled }) =>
              cn(
                "flex min-w-0 flex-1 cursor-default flex-col items-center justify-center gap-1 rounded-field border bg-panel px-1 pt-1.5 pb-1 text-2xs text-ink-2 transition-colors duration-100",
                touch ? "min-h-14" : "min-h-12",
                isSelected ? "border-ink font-semibold text-ink ring-1 ring-ink" : "border-rule-strong hover:bg-well",
                isFocusVisible && "outline-2 outline-offset-2 outline-focus",
                isDisabled && "opacity-50",
              )
            }
          >
            <span aria-hidden="true" className="flex h-5 w-full items-center justify-center text-ink">
              {option.draw}
            </span>
            <span className="max-w-full truncate">{option.label}</span>
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}

const FIELD =
  "h-field min-w-0 rounded-field border border-rule-strong bg-panel px-1.5 text-sm text-ink tabular-nums transition-colors duration-100 placeholder:text-ink-3 hover:border-ink-3 disabled:opacity-50";

/** A number typed directly. Empty with a "Mixed" placeholder when the selection disagrees. */
export function NumberBox({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
  disabled,
  className,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  format?: Intl.NumberFormatOptions;
  onCommit: (value: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useInspectorStrings();
  const { touch } = useEditorLayout();
  return (
    <NumberField
      aria-label={label}
      value={value ?? Number.NaN}
      minValue={min}
      maxValue={max}
      step={step}
      formatOptions={format}
      isDisabled={disabled}
      onChange={(next) => {
        if (!Number.isNaN(next)) onCommit(next);
      }}
      className={cn("shrink-0", className ?? "w-16")}
    >
      <span dir="ltr" className="relative block">
        <RacInput placeholder={t.mixed} className={cn(FIELD, "w-full text-end", touch && "h-11", format === PIXELS && value !== undefined && "pe-6")} />
        {format === PIXELS && value !== undefined ? <span className="pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2 text-2xs text-ink-3">{t.px}</span> : null}
      </span>
    </NumberField>
  );
}

/**
 * A continuous value: a slider to feel for it and a field to type it. A whole
 * drag is one undo step (`onCommit` closes it). When the selection is mixed
 * the track is dashed and carries no thumb, since no single value is true.
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  format?: Intl.NumberFormatOptions;
  onChange: (value: number) => void;
  onCommit: () => void;
  disabled?: boolean;
}) {
  const { touch } = useEditorLayout();
  const mixed = value === undefined;
  return (
    <div className="flex items-center gap-2">
      <Caption className="w-16 shrink-0">{label}</Caption>
      <RacSlider
        aria-label={label}
        value={value ?? min}
        minValue={min}
        maxValue={max}
        step={step}
        isDisabled={disabled}
        onChange={onChange}
        onChangeEnd={onCommit}
        className="min-w-0 flex-1 data-disabled:opacity-50"
      >
        <SliderTrack className={cn("relative w-full", touch ? "h-11" : "h-field")}>
          {({ state }) => (
            <>
              <span
                className={cn(
                  "absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill",
                  mixed ? "border-t-2 border-dashed border-rule-strong" : "bg-rule",
                )}
              />
              {mixed ? null : (
                <span
                  className="absolute start-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-ink-2"
                  style={{ width: `${state.getThumbPercent(0) * 100}%` }}
                />
              )}
              <SliderThumb
                className={({ isFocusVisible, isDragging }) =>
                  cn(
                    "top-1/2 size-3.5 rounded-pill border-2 border-ink bg-panel",
                    mixed && !isDragging && !isFocusVisible && "opacity-0",
                    isDragging && "bg-ink",
                    isFocusVisible && "outline-2 outline-offset-2 outline-focus",
                  )
                }
              />
            </>
          )}
        </SliderTrack>
      </RacSlider>
      <NumberBox
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        format={format}
        disabled={disabled}
        onCommit={(next) => {
          onChange(next);
          onCommit();
        }}
      />
    </div>
  );
}

export const PERCENT: Intl.NumberFormatOptions = { style: "percent", maximumFractionDigits: 0 };
/** Lengths on screen. Fields given this format carry a "px" suffix. */
export const PIXELS: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };

export const textFieldClass = FIELD;
