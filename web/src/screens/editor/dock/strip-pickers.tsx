import { Dialog } from "react-aria-components";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import type { ColorRef, FeatureKind } from "@/model/types";
import { useEditorLayout } from "../shared/layout";
import { colorCss, useMapPalette } from "../shared/palette";
import { GlyphDrawing, ICON_IDS, SymbolDrawing } from "./drawings";

export type StyledKind = Exclude<FeatureKind, "annotation">;

/** Presets that apply to the tool, as a menu. Choosing one makes the next shape follow it. */
export function PresetMenu({ kind, compact = false }: { kind: StyledKind; compact?: boolean }) {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const palette = useMapPalette();
  const { touch } = useEditorLayout();
  const presets = useEditorStore((state) => state.doc.settings.presets);
  const presetId = useEditorStore((state) => state.drawDefaults[kind].presetId);
  const usable = presets.filter((preset) => preset.appliesTo.includes(kind));
  if (usable.length === 0) return null;
  const current = usable.find((preset) => preset.id === presetId);
  const chip = (color: ColorRef | undefined) => (
    <span aria-hidden="true" className="size-3 shrink-0 rounded-key border border-ink/20" style={{ backgroundColor: colorCss(color ?? null, palette) }} />
  );
  return (
    <DropdownMenuTrigger>
      <Button variant="outline" size={touch ? "touch" : "sm"} className={compact ? "max-w-28 px-2" : "max-w-44"}>
        {current ? chip(current.stroke?.color ?? current.iconColor) : null}
        <span dir={current?.name.dir} className="truncate">
          {current ? current.name.value : t.strip.preset}
        </span>
      </Button>
      <DropdownMenu
        placement="top start"
        aria-label={t.strip.preset}
        onAction={(key) => store.setDrawDefaults(kind, { presetId: key === "none" ? null : String(key) })}
      >
        <DropdownMenuItem id="none">{t.strip.noPreset}</DropdownMenuItem>
        {usable.map((preset) => (
          <DropdownMenuItem key={preset.id} id={preset.id} textValue={preset.name.value}>
            {chip(preset.stroke?.color ?? preset.iconColor)}
            <span dir={preset.name.dir}>{preset.name.value}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </DropdownMenuTrigger>
  );
}

/** The icon the next marker gets: one of the twelve, or a number of up to three characters. */
export function SymbolPicker() {
  const t = useEditorStrings();
  const store = useEditorStoreApi();
  const palette = useMapPalette();
  const { touch } = useEditorLayout();
  const point = useEditorStore((state) => state.drawDefaults.point);
  const color = colorCss(point.color, palette);
  return (
    <PopoverTrigger>
      <Button variant="outline" size={touch ? "touch" : "sm"} aria-label={t.strip.symbol}>
        <SymbolDrawing symbol={point.symbol} color={color} size={16} />
        {"icon" in point.symbol ? t.icons[point.symbol.icon] : t.strip.number}
      </Button>
      <Popover placement="top" className="w-64">
        <Dialog aria-label={t.strip.symbol} className="flex flex-col gap-2.5 outline-none">
          <div role="group" aria-label={t.strip.icon} className="grid grid-cols-6 gap-1">
            {ICON_IDS.map((icon) => {
              const active = "icon" in point.symbol && point.symbol.icon === icon;
              return (
                <button
                  key={icon}
                  type="button"
                  aria-label={t.icons[icon]}
                  aria-pressed={active}
                  title={t.icons[icon]}
                  onClick={() => store.setDrawDefaults("point", { symbol: { icon } })}
                  className="flex aspect-square items-center justify-center rounded-field text-ink-2 hover:bg-well hover:text-ink aria-pressed:bg-ink aria-pressed:text-panel"
                >
                  <GlyphDrawing icon={icon} size={24} />
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-2">
            {t.strip.numberLabel}
            <Input
              dir="ltr"
              maxLength={3}
              value={"number" in point.symbol ? point.symbol.number : ""}
              placeholder="1"
              onChange={(event) => {
                const number = event.target.value.slice(0, 3);
                store.setDrawDefaults("point", { symbol: number === "" ? { icon: "pin" } : { number } });
              }}
              className="w-16 text-center tabular-nums"
            />
          </label>
        </Dialog>
      </Popover>
    </PopoverTrigger>
  );
}
