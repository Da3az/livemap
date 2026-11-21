import { getLocalTimeZone, now, parseAbsoluteToLocal, type ZonedDateTime } from "@internationalized/date";
import { cn } from "cn";
import { useContext } from "react";
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker,
  DatePickerStateContext,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover,
  TimeField,
} from "react-aria-components";
import { Icon } from "@/components/icons";
import { overlayPanel } from "@/components/ui/styles";
import { useLang } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";
import type { IsoDateTime } from "@/model/types";
import { useEditorLayout } from "./layout";

function toZoned(iso: IsoDateTime | null | undefined): ZonedDateTime | null {
  if (iso === null || iso === undefined) return null;
  try {
    return parseAbsoluteToLocal(iso);
  } catch {
    return null;
  }
}

const segment =
  "rounded-key px-0.5 outline-none data-focused:bg-ink data-focused:text-panel data-placeholder:text-ink-3 data-[type=literal]:px-0 data-[type=literal]:text-ink-3";

/** The time of the value being picked, beside the calendar: the same segments as the field, so either can be used. */
function PopoverTime() {
  const t = useEditorStrings().date;
  const state = useContext(DatePickerStateContext);
  if (state === null) return null;
  return (
    <TimeField
      aria-label={t.time}
      value={state.timeValue}
      onChange={(next) => {
        if (next) state.setTimeValue(next);
      }}
      hourCycle={24}
      hideTimeZone
      shouldForceLeadingZeros
      granularity="minute"
      className="flex items-center gap-2"
    >
      <span className="text-xs text-ink-2">{t.time}</span>
      <DateInput className="block whitespace-nowrap rounded-field border border-rule-strong bg-panel px-1.5 py-1 text-sm tabular-nums data-focus-within:border-ink-3">
        {(part) => <DateSegment segment={part} className={segment} />}
      </DateInput>
    </TimeField>
  );
}

export interface DateTimePickerProps {
  /** The accessible name; also used in the calendar button's label. */
  label: string;
  value: IsoDateTime | null;
  onChange: (iso: IsoDateTime | null) => void;
  /** Called when the field loses focus or the calendar closes: the end of one edit. */
  onCommit?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A date and time to the minute: typed segment by segment, or picked from a
 * calendar popover that also carries the time. It follows the editor's locale
 * (Western digits in Arabic), mirrors in RTL, and its popover mounts in the
 * editor's portal. Values in and out are ISO strings.
 */
export function DateTimePicker({ label, value, onChange, onCommit, disabled = false, className }: DateTimePickerProps) {
  const t = useEditorStrings().date;
  const lang = useLang();
  const { touch } = useEditorLayout();
  const nav = cn("flex items-center justify-center rounded-field text-ink-2 outline-none hover:bg-well hover:text-ink data-focus-visible:ring-2 data-focus-visible:ring-focus", touch ? "size-11" : "size-7");

  return (
    <DatePicker
      aria-label={label}
      value={toZoned(value)}
      granularity="minute"
      hourCycle={24}
      hideTimeZone
      shouldForceLeadingZeros
      shouldCloseOnSelect={false}
      isDisabled={disabled}
      placeholderValue={now(getLocalTimeZone()).set({ minute: 0, second: 0, millisecond: 0 })}
      onChange={(next) => onChange(next ? next.toDate().toISOString() : null)}
      onOpenChange={(open) => {
        if (!open) onCommit?.();
      }}
      onBlur={() => onCommit?.()}
      className={cn("min-w-0", className)}
    >
      <Group
        className={cn(
          "flex w-full items-center rounded-field border border-rule-strong bg-panel text-sm text-ink tabular-nums transition-colors duration-100 hover:border-ink-3 data-disabled:opacity-50 data-focus-within:border-ink-3",
          touch ? "h-11" : "h-field",
        )}
      >
        <DateInput className="block min-w-0 flex-1 truncate whitespace-nowrap ps-1.5">
          {(part) => <DateSegment segment={part} className={segment} />}
        </DateInput>
        <Button
          aria-label={t.open(label)}
          className={cn(
            "flex shrink-0 items-center justify-center self-stretch border-s border-rule text-ink-2 outline-none hover:bg-well hover:text-ink data-focus-visible:ring-2 data-focus-visible:ring-focus",
            touch ? "w-11" : "w-7",
          )}
        >
          <Icon name="chevronDown" size={14} />
        </Button>
      </Group>
      <Popover placement="bottom end" offset={4} className={cn(overlayPanel, "p-3")}>
        <Dialog aria-label={label} className="flex flex-col gap-3 outline-none">
          <Calendar className="flex flex-col gap-2">
            <header className="flex items-center gap-1">
              <Button slot="previous" aria-label={t.previous} className={nav}>
                <Icon name="chevron" size={14} className="-scale-x-100 rtl:scale-x-100" />
              </Button>
              <Heading className="flex-1 text-center text-sm font-semibold text-ink tabular-nums" />
              <Button slot="next" aria-label={t.next} className={nav}>
                <Icon name="chevron" size={14} className="rtl:-scale-x-100" />
              </Button>
            </header>
            <CalendarGrid weekdayStyle={lang === "ar" ? "narrow" : "short"} className="border-separate border-spacing-0.5">
              <CalendarGridHeader>
                {(day) => <CalendarHeaderCell className="pb-1 text-2xs font-medium text-ink-3">{day}</CalendarHeaderCell>}
              </CalendarGridHeader>
              <CalendarGridBody>
                {(date) => (
                  <CalendarCell
                    date={date}
                    className={cn(
                      "flex items-center justify-center rounded-field text-sm tabular-nums text-ink outline-none hover:bg-well data-disabled:text-ink-3 data-focus-visible:ring-2 data-focus-visible:ring-focus data-outside-month:text-ink-3 data-selected:bg-survey data-selected:font-semibold data-selected:text-on-survey",
                      touch ? "size-11" : "size-8",
                    )}
                  />
                )}
              </CalendarGridBody>
            </CalendarGrid>
          </Calendar>
          <div className="flex items-center justify-between gap-3 border-t border-rule pt-3">
            <PopoverTime />
            <CloseButton label={t.done} />
          </div>
        </Dialog>
      </Popover>
    </DatePicker>
  );
}

function CloseButton({ label }: { label: string }) {
  const state = useContext(DatePickerStateContext);
  return (
    <Button
      onPress={() => state?.close()}
      className="rounded-field bg-survey px-3 py-1 text-sm font-medium text-on-survey outline-none hover:bg-survey-hover data-focus-visible:ring-2 data-focus-visible:ring-focus"
    >
      {label}
    </Button>
  );
}
