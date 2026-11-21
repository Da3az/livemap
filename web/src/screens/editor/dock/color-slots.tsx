import { cn } from "cn";
import { Button as RacButton, Dialog, DialogTrigger, ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { Icon } from "@/components/icons";
import { Popover } from "@/components/ui/popover";
import { useEditorStrings } from "@/i18n/editor";
import type { ColorRef } from "@/model/types";
import { ColorPickerPanel, hexOf } from "../inspector/color-picker";
import { useEditorLayout } from "../shared/layout";
import { colorCss, PALETTE_SLOTS, useMapPalette } from "../shared/palette";

/**
 * The eight map colours as a row of swatches, and a ninth that opens the same
 * custom-colour picker the inspector uses. The chosen one carries a tick, not
 * only a ring.
 */
export function ColorSlots({ value, onChange, label }: { value: ColorRef | null; onChange: (color: ColorRef) => void; label: string }) {
  const t = useEditorStrings();
  const palette = useMapPalette();
  const { touch } = useEditorLayout();
  const selected = value !== null && "slot" in value ? String(value.slot) : null;
  const custom = value !== null && "custom" in value ? value.custom : null;
  const cell = cn("group/slot flex cursor-default items-center justify-center rounded-field outline-none", touch ? "size-11" : "size-5");
  const chip =
    "flex size-5 items-center justify-center rounded-field border border-ink/20 text-white group-data-selected/slot:outline-2 group-data-selected/slot:outline-offset-1 group-data-selected/slot:outline-ink group-data-focus-visible/slot:ring-2 group-data-focus-visible/slot:ring-focus";
  return (
    <div className={cn("flex shrink-0 items-center", touch ? "gap-0" : "gap-1")}>
      <ToggleButtonGroup
        aria-label={label}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={selected === null ? [] : [selected]}
        onSelectionChange={(keys) => {
          const next = Number([...keys][0]);
          const slot = PALETTE_SLOTS.find((candidate) => candidate === next);
          if (slot) onChange({ slot });
        }}
        className={cn("flex items-center", touch ? "gap-0" : "gap-1")}
      >
        {PALETTE_SLOTS.map((slot) => (
          <ToggleButton key={slot} id={String(slot)} aria-label={t.colors[slot]} className={cell}>
            <span title={t.colors[slot]} className={chip} style={{ backgroundColor: colorCss({ slot }, palette) }}>
              <Icon name="check" size={12} className="hidden group-data-selected/slot:block" />
            </span>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <DialogTrigger>
        <RacButton aria-label={custom !== null ? `${t.strip.custom} ${custom}` : t.strip.custom} className={cell} data-selected={custom !== null || undefined}>
          <span
            title={t.strip.custom}
            className={cn(chip, custom === null && "border-dashed border-rule-strong bg-panel text-ink-2")}
            style={custom !== null ? { backgroundColor: custom } : undefined}
          >
            <Icon name={custom !== null ? "check" : "plus"} size={12} className={custom !== null ? "mix-blend-difference" : undefined} />
          </span>
        </RacButton>
        <Popover placement="top" className="w-64 rounded-block border border-rule p-0 shadow-overlay ring-0">
          <Dialog aria-label={`${label}: ${t.strip.custom}`} className="outline-none">
            <ColorPickerPanel value={custom ?? hexOf(value, palette)} onChange={(hex) => onChange({ custom: hex })} onCommit={() => undefined} />
          </Dialog>
        </Popover>
      </DialogTrigger>
    </div>
  );
}
