import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { selectFeature, useEditorStore, useEditorStoreApi, type SelectionSummary, type StylePatch, type StyleProperty, type StyleValues } from "@/editor/store";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import type { DashStyle, FillPattern } from "@/model/types";
import { BendDrawing } from "../dock/drawings";
import { colorCss, useMapPalette } from "../shared/palette";
import { ColorControl } from "./color-control";
import { DashDraw, HeadDraw, PatternDraw, ToothDraw } from "./drawings";
import { has, isMixed, Line, NumberBox, PERCENT, PIXELS, Section, SliderField, Tiles, valueOf } from "./parts";

export interface SectionProps {
  summary: SelectionSummary;
  disabled: boolean;
}

/** Change one style property on everything selected; `commit` ends the undo step a drag or a run of typing made. */
export function useRestyle(): { set: <K extends StyleProperty>(key: K, value: StyleValues[K]) => void; commit: () => void } {
  const store = useEditorStoreApi();
  return {
    set: (key, value) => {
      const patch: StylePatch = {};
      patch[key] = value;
      store.restyle(patch);
    },
    commit: () => store.closeStep(),
  };
}

const PATTERNS: FillPattern[] = ["none", "hatch", "cross", "dots"];
type DashKind = "solid" | "dashed" | "dotted" | "custom";
const DASHES: DashKind[] = ["solid", "dashed", "dotted", "custom"];
const DEFAULT_CUSTOM: number[] = [8, 4];

function dashKind(dash: DashStyle | undefined): DashKind | undefined {
  if (dash === undefined) return undefined;
  return typeof dash === "string" ? dash : "custom";
}

/** The dash choice on its own, so the preset editor can use it too. */
export function DashControl({
  value,
  mixed,
  color,
  onChange,
  disabled,
}: {
  value: DashStyle | undefined;
  mixed: boolean;
  color: string;
  onChange: (dash: DashStyle) => void;
  disabled: boolean;
}) {
  const t = useInspectorStrings();
  const kind = dashKind(value);
  const custom = typeof value === "object" ? value.custom : DEFAULT_CUSTOM;
  const dashLength = custom[0] ?? 8;
  const gapLength = custom[1] ?? dashLength;
  return (
    <>
      <Tiles
        label={t.stroke.dash}
        value={kind}
        mixed={mixed}
        disabled={disabled}
        options={DASHES.map((id) => ({
          id,
          label: t.stroke.dashes[id],
          draw: <DashDraw dash={id === "custom" ? { custom } : id} color={color} />,
        }))}
        onChange={(next) => onChange(next === "custom" ? { custom } : next)}
      />
      {kind === "custom" ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-ink-2">{t.stroke.dashLength}</span>
          <NumberBox label={t.stroke.dashLength} value={dashLength} min={0} max={60} step={1} format={PIXELS} disabled={disabled} onCommit={(next) => onChange({ custom: [next, gapLength] })} />
          <span className="text-xs text-ink-2">{t.stroke.gapLength}</span>
          <NumberBox label={t.stroke.gapLength} value={gapLength} min={1} max={60} step={1} format={PIXELS} disabled={disabled} onCommit={(next) => onChange({ custom: [dashLength, next] })} />
        </div>
      ) : null}
    </>
  );
}

/** The pattern choice on its own. */
export function PatternControl({
  value,
  mixed,
  color,
  onChange,
  disabled,
}: {
  value: FillPattern | undefined;
  mixed: boolean;
  color: string;
  onChange: (pattern: FillPattern) => void;
  disabled: boolean;
}) {
  const t = useInspectorStrings();
  return (
    <Tiles
      label={t.fill.pattern}
      value={value}
      mixed={mixed}
      disabled={disabled}
      options={PATTERNS.map((id) => ({ id, label: t.fill.patterns[id], draw: <PatternDraw pattern={id} color={color} /> }))}
      onChange={onChange}
    />
  );
}

export function FillSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const palette = useMapPalette();
  const { set, commit } = useRestyle();
  const { style } = summary;
  if (!has(style["fill.color"])) return null;
  const color = valueOf(style["fill.color"]);
  return (
    <Section title={t.fill.heading}>
      <ColorControl
        label={t.preset.colour}
        value={color}
        mixed={isMixed(style["fill.color"])}
        disabled={disabled}
        onChange={(next) => {
          if (next !== "ink") set("fill.color", next);
        }}
        onCommit={commit}
      />
      <SliderField
        label={t.fill.opacity}
        value={valueOf(style["fill.opacity"])}
        min={0}
        max={1}
        step={0.01}
        format={PERCENT}
        disabled={disabled}
        onChange={(next) => set("fill.opacity", next)}
        onCommit={commit}
      />
      <PatternControl
        value={valueOf(style["fill.pattern"])}
        mixed={isMixed(style["fill.pattern"])}
        color={colorCss(color ?? null, palette)}
        disabled={disabled}
        onChange={(next) => set("fill.pattern", next)}
      />
    </Section>
  );
}

export function StrokeSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const palette = useMapPalette();
  const { set, commit } = useRestyle();
  const { style } = summary;
  if (!has(style["stroke.color"])) return null;
  const color = valueOf(style["stroke.color"]);
  const onlyAreas = summary.kinds.length === 1 && summary.kinds[0] === "area";
  return (
    <Section title={onlyAreas ? t.stroke.outline : t.stroke.line}>
      <ColorControl
        label={t.preset.colour}
        value={color}
        mixed={isMixed(style["stroke.color"])}
        disabled={disabled}
        onChange={(next) => {
          if (next !== "ink") set("stroke.color", next);
        }}
        onCommit={commit}
      />
      <SliderField
        label={t.stroke.width}
        value={valueOf(style["stroke.width"])}
        min={0}
        max={12}
        step={0.5}
        format={PIXELS}
        disabled={disabled}
        onChange={(next) => set("stroke.width", next)}
        onCommit={commit}
      />
      <SliderField
        label={t.stroke.opacity}
        value={valueOf(style["stroke.opacity"])}
        min={0}
        max={1}
        step={0.01}
        format={PERCENT}
        disabled={disabled}
        onChange={(next) => set("stroke.opacity", next)}
        onCommit={commit}
      />
      <DashControl
        value={valueOf(style["stroke.dash"])}
        mixed={isMixed(style["stroke.dash"])}
        color={colorCss(color ?? null, palette)}
        disabled={disabled}
        onChange={(next) => {
          set("stroke.dash", next);
          commit();
        }}
      />
    </Section>
  );
}

const HEADS = ["none", "single", "double"] as const;

export function ArrowSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const { set, commit } = useRestyle();
  /* Only a two-point arrow is an arc, and only an arc has a side to bow to. */
  const arcs = useEditorStore((state) =>
    state.selection.ids.some((id) => {
      const feature = selectFeature(state, id);
      return feature?.kind === "arrow" && feature.control.length === 2;
    }),
  );
  const { style } = summary;
  if (!has(style["arrow.head"])) return null;
  const tapered = style["arrow.tapered"];
  const bend = style["arrow.bend"];
  const curvature = valueOf(style["arrow.curvature"]);
  return (
    <Section title={t.arrow.heading}>
      <Tiles
        label={t.arrow.head}
        value={valueOf(style["arrow.head"])}
        mixed={isMixed(style["arrow.head"])}
        disabled={disabled}
        options={HEADS.map((id) => ({ id, label: t.arrow.heads[id], draw: <HeadDraw head={id} /> }))}
        onChange={(next) => set("arrow.head", next)}
      />
      <SliderField
        label={t.arrow.curvature}
        value={valueOf(style["arrow.curvature"])}
        min={0}
        max={1}
        step={0.01}
        format={PERCENT}
        disabled={disabled}
        onChange={(next) => set("arrow.curvature", next)}
        onCommit={commit}
      />
      {arcs ? (
        <Line label={isMixed(bend) ? `${t.arrow.flipHint} · ${t.mixed}` : t.arrow.flipHint}>
          <Toggle
            variant="outline"
            aria-label={t.arrow.flip}
            isSelected={valueOf(bend) === "right"}
            isDisabled={disabled || curvature === 0}
            onChange={(flipped) => {
              set("arrow.bend", flipped ? "right" : "left");
              commit();
            }}
            className="gap-1.5 data-selected:bg-ink"
          >
            <BendDrawing bend={valueOf(bend) ?? "left"} />
            {t.arrow.flip}
          </Toggle>
        </Line>
      ) : null}
      <Line label={isMixed(tapered) ? `${t.arrow.tapered} · ${t.mixed}` : t.arrow.tapered}>
        <Switch aria-label={t.arrow.tapered} isSelected={valueOf(tapered) ?? false} isDisabled={disabled} onChange={(next) => set("arrow.tapered", next)} />
      </Line>
    </Section>
  );
}

const SHAPES = ["triangle", "semicircle"] as const;
const FACINGS = ["left", "right"] as const;

export function FrontlineSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const { set, commit } = useRestyle();
  const { style } = summary;
  if (!has(style["frontline.facing"])) return null;
  const shape = valueOf(style["frontline.toothShape"]) ?? "triangle";
  return (
    <Section title={t.frontline.heading}>
      <Tiles
        label={t.frontline.facing}
        value={valueOf(style["frontline.facing"])}
        mixed={isMixed(style["frontline.facing"])}
        disabled={disabled}
        options={FACINGS.map((id) => ({ id, label: t.frontline[id], draw: <ToothDraw shape={shape} side={id === "left" ? "up" : "down"} /> }))}
        onChange={(next) => set("frontline.facing", next)}
      />
      <Tiles
        label={t.frontline.shape}
        value={valueOf(style["frontline.toothShape"])}
        mixed={isMixed(style["frontline.toothShape"])}
        disabled={disabled}
        options={SHAPES.map((id) => ({ id, label: t.frontline.shapes[id], draw: <ToothDraw shape={id} side="up" /> }))}
        onChange={(next) => set("frontline.toothShape", next)}
      />
      <SliderField
        label={t.frontline.spacing}
        value={valueOf(style["frontline.toothSpacing"])}
        min={6}
        max={60}
        step={1}
        format={PIXELS}
        disabled={disabled}
        onChange={(next) => set("frontline.toothSpacing", next)}
        onCommit={commit}
      />
      <SliderField
        label={t.frontline.size}
        value={valueOf(style["frontline.toothSize"])}
        min={3}
        max={24}
        step={1}
        format={PIXELS}
        disabled={disabled}
        onChange={(next) => set("frontline.toothSize", next)}
        onCommit={commit}
      />
    </Section>
  );
}
