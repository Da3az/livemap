import { cn } from "cn";
import { Radio, RadioGroup } from "react-aria-components";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import type { IconId } from "@/model/types";
import { toCss } from "@/render/color";
import { ICON_GLYPHS } from "@/render/icons";
import { readableOn, resolveColor } from "@/render/palette";
import { useEditorLayout } from "../shared/layout";
import { colorCss, useMapPalette } from "../shared/palette";
import { ColorControl } from "./color-control";
import { GlyphDraw } from "./drawings";
import { Caption, has, isMixed, PIXELS, Section, SliderField, valueOf } from "./parts";
import { useRestyle, type SectionProps } from "./style-sections";

const ICONS = Object.keys(ICON_GLYPHS).filter((key): key is IconId => key in ICON_GLYPHS);

/** A marker: one of the twelve icons as the map draws them, or a short number; its size and colour. */
export function PointSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const palette = useMapPalette();
  const { touch } = useEditorLayout();
  const { set, commit } = useRestyle();
  const { style } = summary;
  if (!has(style["point.symbol"])) return null;
  const symbol = valueOf(style["point.symbol"]);
  const mode = symbol === undefined ? undefined : "icon" in symbol ? "icon" : "number";
  const icon = symbol !== undefined && "icon" in symbol ? symbol.icon : null;
  const colorRef = valueOf(style.color);
  const color = colorCss(colorRef ?? null, palette);
  const ink = colorRef && palette ? toCss(readableOn(resolveColor(colorRef, palette), palette)) : "var(--panel)";

  return (
    <Section
      title={t.point.heading}
      aside={
        <ToggleGroup
          aria-label={t.point.heading}
          size={touch ? "lg" : "sm"}
          spacing={0}
          selectionMode="single"
          disallowEmptySelection={mode !== undefined}
          isDisabled={disabled}
          selectedKeys={mode === undefined ? [] : [mode]}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next === "icon") set("point.symbol", { icon: "pin" });
            if (next === "number") set("point.symbol", { number: "1" });
          }}
        >
          <ToggleGroupItem id="icon">{t.point.icon}</ToggleGroupItem>
          <ToggleGroupItem id="number">{t.point.number}</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {mode === "number" && symbol !== undefined && "number" in symbol ? (
        <label className="flex items-center gap-2">
          <Caption className="min-w-0 flex-1">{t.point.numberLabel}</Caption>
          <Input
            dir="ltr"
            maxLength={3}
            value={symbol.number}
            disabled={disabled}
            onChange={(event) => set("point.symbol", { number: event.target.value })}
            onBlur={commit}
            className={cn("w-16 text-center font-semibold tabular-nums", touch && "h-11")}
          />
        </label>
      ) : (
        <RadioGroup
          aria-label={t.point.icon}
          orientation="horizontal"
          value={icon}
          isDisabled={disabled}
          onChange={(next) => {
            const found = ICONS.find((candidate) => candidate === next);
            if (found) set("point.symbol", { icon: found });
          }}
          className="flex flex-col gap-1"
        >
          <div className="flex items-baseline gap-2">
            <Caption>{t.point.icon}</Caption>
            <span className={cn("text-xs font-medium", icon === null ? "text-ink-3" : "text-ink")}>
              {icon !== null ? t.point.icons[icon] : isMixed(style["point.symbol"]) ? t.mixed : ""}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1">
            {ICONS.map((id) => (
              <Radio
                key={id}
                value={id}
                aria-label={t.point.icons[id]}
                className={({ isSelected, isFocusVisible, isDisabled }) =>
                  cn(
                    "flex cursor-default items-center justify-center rounded-field border",
                    touch ? "h-11" : "h-9",
                    isSelected ? "border-ink bg-well ring-1 ring-ink" : "border-transparent hover:bg-well",
                    isFocusVisible && "outline-2 outline-offset-2 outline-focus",
                    isDisabled && "opacity-50",
                  )
                }
              >
                <GlyphDraw icon={id} color={color} ink={ink} size={24} />
              </Radio>
            ))}
          </div>
        </RadioGroup>
      )}
      <SliderField
        label={t.point.size}
        value={valueOf(style["point.size"])}
        min={12}
        max={48}
        step={1}
        format={PIXELS}
        disabled={disabled}
        onChange={(next) => set("point.size", next)}
        onCommit={commit}
      />
      <ColorControl
        label={t.preset.colour}
        value={colorRef}
        mixed={isMixed(style.color)}
        disabled={disabled}
        onChange={(next) => {
          if (next !== "ink") set("color", next);
        }}
        onCommit={commit}
      />
    </Section>
  );
}
