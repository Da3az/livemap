import { cn } from "cn";
import { useLayoutEffect, useRef, useState } from "react";
import { Button as RacButton, Dialog, DialogTrigger, Radio, RadioGroup } from "react-aria-components";
import { Icon } from "@/components/icons";
import { Popover } from "@/components/ui/popover";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import type { ColorRef, PaletteSlot } from "@/model/types";
import { useEditorLayout } from "../shared/layout";
import { colorCss, PALETTE_SLOTS, useMapPalette } from "../shared/palette";
import { ColorPickerPanel, hexOf } from "./color-picker";
import { Caption } from "./parts";

type Value = ColorRef | "ink";

function keyOf(value: Value | undefined): string | null {
  if (value === undefined) return null;
  if (value === "ink") return "ink";
  return "slot" in value ? String(value.slot) : "custom";
}

function isSlot(key: string): PaletteSlot | null {
  return PALETTE_SLOTS.find((slot) => String(slot) === key) ?? null;
}

/**
 * A colour: the eight named map colours as a row of swatches, and a custom
 * colour behind a picker. The swatches are painted with the colours the map
 * draws, which follow the basemap. The chosen one carries a tick and its name
 * is written out; with a mixed selection none is chosen.
 */
export function ColorControl({
  label,
  value,
  mixed,
  allowInk,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: Value | undefined;
  mixed?: boolean;
  /** Text can also take the basemap's own ink. */
  allowInk?: boolean;
  onChange: (value: Value) => void;
  onCommit: () => void;
  disabled?: boolean;
}) {
  const t = useInspectorStrings();
  const palette = useMapPalette();
  const { touch } = useEditorLayout();
  const key = keyOf(value);
  const custom = value !== undefined && value !== "ink" && "custom" in value ? value.custom : null;
  const slot = key === null ? null : isSlot(key);
  const name = mixed ? t.mixed : slot !== null ? t.colour.slots[slot] : key === "ink" ? t.colour.ink : custom !== null ? custom.toUpperCase() : "";
  /* On touch the nine swatches share the pane width in one row instead of wrapping at 44px each. */
  const size = touch ? "aspect-square w-full min-w-0" : "size-6";
  /* The picker opens beside the whole row, over the map, so it never covers the swatches it belongs to. */
  const row = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(8);
  useLayoutEffect(() => {
    const trigger = row.current?.querySelector("[data-custom-colour]");
    if (!row.current || !trigger) return;
    const outer = row.current.getBoundingClientRect();
    const inner = trigger.getBoundingClientRect();
    setOffset(Math.max(inner.left - outer.left, outer.right - inner.right) + 20);
  }, [touch, allowInk]);

  const swatch = (selected: boolean, focus: boolean, off: boolean): string =>
    cn(
      "relative flex shrink-0 cursor-default items-center justify-center rounded-field border border-ink/25",
      size,
      selected && "ring-2 ring-ink ring-offset-2 ring-offset-panel",
      focus && "outline-2 outline-offset-4 outline-focus",
      off && "opacity-50",
    );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <Caption>{label}</Caption>
        <span dir="ltr" className={cn("text-xs font-medium tabular-nums", mixed ? "text-ink-3" : "text-ink")}>
          {name}
        </span>
      </div>
      <div ref={row} className={touch ? (allowInk ? "grid grid-cols-10 gap-1" : "grid grid-cols-9 gap-1") : "flex flex-wrap items-center gap-1"}>
        <RadioGroup
          aria-label={label}
          orientation="horizontal"
          value={slot !== null || key === "ink" ? key : null}
          isDisabled={disabled}
          onChange={(next) => {
            const picked = isSlot(next);
            onChange(picked !== null ? { slot: picked } : "ink");
            onCommit();
          }}
          className={touch ? (allowInk ? "col-span-9 grid grid-cols-9 gap-1" : "col-span-8 grid grid-cols-8 gap-1") : "flex flex-wrap items-center gap-1"}
        >
          {allowInk ? (
            <Radio
              value="ink"
              aria-label={t.colour.ink}
              className={({ isSelected, isFocusVisible, isDisabled }) => swatch(isSelected, isFocusVisible, isDisabled)}
              style={{ backgroundColor: colorCss("ink", palette) }}
            >
              {({ isSelected }) => (isSelected ? <Icon name="check" size={14} className="text-panel" /> : null)}
            </Radio>
          ) : null}
          {PALETTE_SLOTS.map((candidate) => (
            <Radio
              key={candidate}
              value={String(candidate)}
              aria-label={t.colour.slots[candidate]}
              className={({ isSelected, isFocusVisible, isDisabled }) => swatch(isSelected, isFocusVisible, isDisabled)}
              style={{ backgroundColor: colorCss({ slot: candidate }, palette) }}
            >
              {({ isSelected }) => (isSelected ? <Icon name="check" size={14} className="text-white" /> : null)}
            </Radio>
          ))}
        </RadioGroup>
        <DialogTrigger>
          <RacButton
            data-custom-colour
            aria-label={custom !== null ? `${t.colour.custom} ${custom}` : t.colour.customPick}
            isDisabled={disabled}
            className={({ isFocusVisible, isDisabled }) =>
              cn(swatch(custom !== null, isFocusVisible, isDisabled), custom === null && "border-dashed border-rule-strong bg-panel text-ink-2 hover:bg-well")
            }
            style={custom !== null ? { backgroundColor: custom } : undefined}
          >
            {custom !== null ? <Icon name="check" size={14} className="text-white mix-blend-difference" /> : <Icon name="plus" size={14} />}
          </RacButton>
          <Popover placement="start top" offset={offset} className="w-64 rounded-block border border-rule p-0 shadow-overlay ring-0">
            <Dialog aria-label={`${label}: ${t.colour.custom}`} className="outline-none">
              <ColorPickerPanel
                value={custom ?? hexOf(value === undefined || value === "ink" ? null : value, palette)}
                onChange={(hex) => onChange({ custom: hex })}
                onCommit={onCommit}
              />
            </Dialog>
          </Popover>
        </DialogTrigger>
      </div>
    </div>
  );
}
