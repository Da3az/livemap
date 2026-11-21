import { useState } from "react";
import {
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorThumb,
  Input as RacInput,
  Label,
  parseColor,
  SliderTrack,
  type Color,
} from "react-aria-components";
import { LOCALE, useLang } from "@/i18n";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import type { ColorRef } from "@/model/types";
import { contrast, parseColor as parseCss } from "@/render/color";
import { resolveColor, type Palette } from "@/render/palette";
import { useMapPalette } from "../shared/palette";
import { textFieldClass } from "./parts";

const FALLBACK = "#808080";

/** The hex of a colour reference as the map draws it, to start a custom colour from. */
export function hexOf(ref: ColorRef | null, palette: Palette | null): string {
  if (ref === null || palette === null) return FALLBACK;
  const { r, g, b } = resolveColor(ref, palette);
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function safeParse(hex: string): Color {
  try {
    return parseColor(hex).toFormat("hsb");
  } catch {
    return parseColor(FALLBACK).toFormat("hsb");
  }
}

const THUMB = "size-4 rounded-pill border-2 border-white ring-1 ring-black/40 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-focus";

/**
 * A custom colour: a saturation and brightness field, a hue strip, the hex
 * typed directly, and how the colour reads against the basemap's land, as a
 * ratio and in words.
 */
export function ColorPickerPanel({ value, onChange, onCommit }: { value: string; onChange: (hex: string) => void; onCommit: () => void }) {
  const t = useInspectorStrings();
  const lang = useLang();
  const palette = useMapPalette();
  /* Held in HSB while open, so hue survives a trip through black or grey. */
  const [color, setColor] = useState<Color>(() => safeParse(value));
  const hex = color.toString("hex");

  const change = (next: Color): void => {
    setColor(next);
    onChange(next.toString("hex"));
  };

  const rgba = parseCss(hex);
  const ratio = rgba && palette ? contrast(rgba, palette.land) : null;
  const verdict = ratio === null ? "" : ratio >= 4.5 ? t.colour.strong : ratio >= 3 ? t.colour.fair : t.colour.weak;

  return (
    <ColorPicker value={color} onChange={change}>
      <div className="flex flex-col gap-2.5 p-2.5">
        <ColorArea
          aria-label={t.colour.area}
          colorSpace="hsb"
          xChannel="saturation"
          yChannel="brightness"
          onChangeEnd={onCommit}
          className="h-36 w-full rounded-field border border-ink/25"
        >
          <ColorThumb className={THUMB} />
        </ColorArea>
        <ColorSlider aria-label={t.colour.hue} colorSpace="hsb" channel="hue" onChangeEnd={onCommit}>
          <SliderTrack className="h-4 w-full rounded-pill border border-ink/25">
            <ColorThumb className={`top-1/2 ${THUMB}`} />
          </SliderTrack>
        </ColorSlider>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-field shrink-0 rounded-field border border-ink/25" style={{ backgroundColor: hex }} />
          <ColorField
            value={color}
            onChange={(next) => {
              if (next) {
                change(next.toFormat("hsb"));
                onCommit();
              }
            }}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <Label className="text-xs text-ink-2">{t.colour.hex}</Label>
            <RacInput dir="ltr" className={`${textFieldClass} w-full uppercase`} />
          </ColorField>
        </div>
        {ratio !== null ? (
          <p className="flex flex-wrap items-baseline gap-x-1.5 border-t border-rule pt-2 text-xs text-ink-2">
            <span>{t.colour.contrast}</span>
            <span className="font-semibold text-ink tabular-nums">
              {new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ratio)}:1
            </span>
            <span className={ratio < 3 ? "font-medium text-warning" : undefined}>{verdict}</span>
          </p>
        ) : null}
      </div>
    </ColorPicker>
  );
}
