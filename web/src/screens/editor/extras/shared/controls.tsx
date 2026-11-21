import { cn } from "cn";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Checkbox as AriaCheckbox, Switch as AriaSwitch } from "react-aria-components";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { onSettingsSectionRequest, takePendingSettingsSection, type SettingsSection } from "./bus";

const SECTION_KEY = "livemap.settings.folded";

function readFolded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SECTION_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeFolded(id: string, folded: boolean): void {
  const all = readFolded();
  if (folded) all.add(id);
  else all.delete(id);
  try {
    window.localStorage.setItem(SECTION_KEY, JSON.stringify([...all]));
  } catch {
    /* not remembered; it still applies for this visit */
  }
}

/**
 * One part of a pane: a plum heading, an optional control at its end, and the
 * content. With an `id` it folds, remembers whether it was folded, and opens
 * and scrolls into view when another panel asks for it by that id.
 */
export function Section({
  title,
  aside,
  summary,
  children,
  className,
  id,
}: {
  title: string;
  aside?: ReactNode;
  /** Shown beside the heading while folded: the section's state in a few words. */
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: SettingsSection;
}) {
  const [open, setOpen] = useState(() => id === undefined || !readFolded().has(id));
  const root = useRef<HTMLElement>(null);
  const bodyId = useId();

  useEffect(() => {
    if (id === undefined) return undefined;
    const reveal = (): void => {
      setOpen(true);
      writeFolded(id, false);
      window.requestAnimationFrame(() => {
        root.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        root.current?.querySelector<HTMLElement>("[data-section-toggle]")?.focus({ preventScroll: true });
      });
    };
    if (takePendingSettingsSection(id)) reveal();
    return onSettingsSectionRequest((requested) => {
      if (requested === id) reveal();
    });
  }, [id]);

  const toggle = (): void => {
    if (id === undefined) return;
    setOpen(!open);
    writeFolded(id, open);
  };

  return (
    <section ref={root} data-settings-section={id} className={cn("scroll-mt-1 border-b border-rule px-3 py-3", !open && "py-2", className)}>
      <div className={cn("flex min-h-5 items-center justify-between gap-2", open && "mb-2")}>
        {id === undefined ? (
          <h3 className="text-xs font-semibold text-plum">{title}</h3>
        ) : (
          <h3 className="min-w-0 flex-1">
            <button
              type="button"
              data-section-toggle
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={toggle}
              className="-mx-1 flex w-full min-w-0 items-center gap-1.5 rounded-key px-1 text-start text-xs font-semibold text-plum outline-offset-1 outline-focus hover:bg-well focus-visible:outline-2"
            >
              <Icon name="chevron" size={11} className={cn("shrink-0 transition-transform duration-100", open ? "rotate-90" : "rtl:-scale-x-100")} />
              <span className="shrink-0">{title}</span>
              {!open && summary !== undefined ? <span className="min-w-0 truncate font-normal text-ink-3">{summary}</span> : null}
            </button>
          </h3>
        )}
        {open ? aside : null}
      </div>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-2.5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Spoken name when the label is a drawing. */
  ariaLabel?: string;
  disabled?: boolean;
}

/** A small set of exclusive choices, shown all at once. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "sm",
  disabled = false,
  className,
}: {
  label: string;
  value: T | null;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "default";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      spacing={0}
      size={size}
      selectionMode="single"
      disallowEmptySelection
      isDisabled={disabled}
      selectedKeys={value === null ? [] : [value]}
      onSelectionChange={(keys) => {
        const chosen = options.find((option) => keys.has(option.value));
        if (chosen !== undefined && chosen.value !== value) onChange(chosen.value);
      }}
      className={className}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          id={option.value}
          aria-label={option.ariaLabel}
          isDisabled={option.disabled}
          className="grow data-selected:hover:bg-ink data-selected:hover:text-panel"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A tick box with its words beside it. */
export function Check({
  checked,
  onChange,
  disabled = false,
  children,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AriaCheckbox
      isSelected={checked}
      onChange={onChange}
      isDisabled={disabled}
      className={cn("group flex min-h-6 items-start gap-2 text-sm text-ink data-disabled:text-ink-3", className)}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-key border border-rule-strong bg-panel text-on-survey outline-offset-2 outline-focus group-data-disabled:opacity-50 group-data-focus-visible:outline-2 group-data-selected:border-survey group-data-selected:bg-survey">
        {checked ? <Icon name="check" size={12} /> : null}
      </span>
      <span className="min-w-0">{children}</span>
    </AriaCheckbox>
  );
}

/** An on/off setting that takes effect at once. The words sit first, the switch at the end. */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  children,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AriaSwitch
      isSelected={checked}
      onChange={onChange}
      isDisabled={disabled}
      className={cn("group flex min-h-6 items-center justify-between gap-3 text-sm text-ink data-disabled:text-ink-3", className)}
    >
      <span className="min-w-0">{children}</span>
      <span className="flex h-4 w-7 shrink-0 items-center justify-start rounded-pill border border-rule-strong bg-well px-px outline-offset-2 outline-focus group-data-disabled:opacity-50 group-data-focus-visible:outline-2 group-data-selected:justify-end group-data-selected:border-survey group-data-selected:bg-survey">
        <span className="size-3 rounded-pill bg-ink-3 group-data-selected:bg-on-survey" />
      </span>
    </AriaSwitch>
  );
}

/** A label at the start and its control at the end, on one line. */
export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-field items-center justify-between gap-3", className)}>
      <span className="shrink-0 text-sm text-ink-2">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-1.5">{children}</div>
    </div>
  );
}

/** A square button that shows only a drawing; `label` is what it is called. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  pressed,
  className,
  iconClassName,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} isDisabled={disabled} onPress={onPress} className={className}>
      <span title={label} className="flex">
        <Icon name={icon} size={14} className={iconClassName} />
      </span>
    </Button>
  );
}

/** Small print under a control: what it means, or why it is unavailable. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("block text-xs text-ink-3", className)}>{children}</span>;
}

export interface PickOption {
  value: string;
  label: string;
  /** The label's own direction, for names a user typed. */
  dir?: "ltr" | "rtl" | "auto";
}

/** A labelled single choice from a list too long for a segmented control. */
export function Pick({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
  ...data
}: {
  label: string;
  value: string;
  options: readonly PickOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
} & { [key: `data-${string}`]: string | boolean | undefined }) {
  return (
    <Select
      aria-label={label}
      value={value}
      isDisabled={disabled}
      onChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
      className={cn("w-full min-w-0", className)}
      {...data}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} id={option.value} textValue={option.label}>
            <span dir={option.dir} className="truncate">
              {option.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
