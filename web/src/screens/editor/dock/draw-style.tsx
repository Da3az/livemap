import { cn } from "cn";
import type { ReactNode } from "react";
import { Button as RacButton, Dialog, DialogTrigger, ToggleButton } from "react-aria-components";
import { Popover } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useEditorStore, useEditorStoreApi, type DrawDefaults } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import type { ColorRef, DashStyle, FillPattern } from "@/model/types";
import { ColorSlots } from "./color-slots";
import {
  BackingDrawing,
  BendDrawing,
  DashDrawing,
  FacingDrawing,
  HeadDrawing,
  LeaderDrawing,
  PatternDrawing,
  SizeDrawing,
  TaperDrawing,
  ToothDrawing,
  WidthDrawing,
} from "./drawings";
import { useEditorLayout } from "../shared/layout";
import { colorCss, useMapPalette } from "../shared/palette";
import { Tip } from "../shared/tip";
import { OptionGroup } from "./option-group";
import { PresetMenu, SymbolPicker, type StyledKind } from "./strip-pickers";

const PATTERNS: FillPattern[] = ["none", "hatch", "cross", "dots"];
const DASHES = ["solid", "dashed", "dotted"] as const;
const HEADS = ["none", "single", "double"] as const;
const TEETH = ["triangle", "semicircle"] as const;
const FACINGS = ["left", "right"] as const;
const LEADERS = ["none", "straight", "elbow"] as const;
const BACKINGS = ["halo", "box", "none"] as const;
const WIDTHS = { thin: 1.5, medium: 2.5, thick: 4 } as const;
const SIZES = { small: 16, medium: 22, large: 30 } as const;

type WidthKey = keyof typeof WIDTHS;
type SizeKey = keyof typeof SIZES;

function colorOf(tool: StyledKind | "annotation", defaults: DrawDefaults): ColorRef | null {
  if (tool === "annotation") return defaults.annotation.labelStyle.color === "ink" ? null : defaults.annotation.labelStyle.color;
  return tool === "point" ? defaults.point.color : defaults[tool].stroke.color;
}

const dashValue = (dash: DashStyle): (typeof DASHES)[number] | null => (typeof dash === "string" ? dash : null);

function keyFor<K extends string>(table: Record<K, number>, value: number): K | null {
  return (Object.keys(table) as K[]).find((key) => table[key] === value) ?? null;
}

function Rule() {
  return <span aria-hidden="true" className="h-5 w-px shrink-0 bg-rule" />;
}

/** On a narrow map the eight colours fold behind one swatch that shows the current one. */
function ColorButton({ value, onChange, label }: { value: ColorRef | null; onChange: (color: ColorRef) => void; label: string }) {
  const palette = useMapPalette();
  const { touch } = useEditorLayout();
  return (
    <DialogTrigger>
      <RacButton
        aria-label={label}
        className={cn(
          "flex shrink-0 cursor-default items-center justify-center rounded-field border border-rule-strong bg-panel px-1.5 text-ink-2 outline-none hover:bg-well data-focus-visible:ring-2 data-focus-visible:ring-focus",
          touch ? "h-11 min-w-11" : "h-6",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-5 rounded-field border border-ink/20", value === null && "border-dashed border-rule-strong bg-panel")}
          style={value === null ? undefined : { backgroundColor: colorCss(value, palette) }}
        />
      </RacButton>
      <Popover placement="top" className="w-auto rounded-block border border-rule p-2 shadow-overlay ring-0">
        <Dialog aria-label={label} className="outline-none">
          <ColorSlots label={label} value={value} onChange={onChange} />
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

/** How much the next arrow curves, and for a two-point arrow which side it bows to. */
function CurveControls({ compact }: { compact: boolean }) {
  const t = useEditorStrings();
  const s = t.strip;
  const store = useEditorStoreApi();
  const { touch } = useEditorLayout();
  const curvature = useEditorStore((state) => state.drawDefaults.arrow.curvature);
  const bend = useEditorStore((state) => state.drawDefaults.arrow.bend);
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-2xs text-ink-2 @max-3xl/map:sr-only", compact && "sr-only")}>{s.curve}</span>
      <Slider
        aria-label={s.curve}
        minValue={0}
        maxValue={1}
        step={0.05}
        value={curvature}
        onChange={(value) => store.setDrawDefaults("arrow", { curvature: value })}
        className={cn(compact ? "w-12" : "w-16", touch && "h-11")}
      />
      <Tip label={s.flipHint}>
        <ToggleButton
          aria-label={s.flip}
          isSelected={bend === "right"}
          isDisabled={curvature === 0}
          onChange={(flipped) => store.setDrawDefaults("arrow", { bend: flipped ? "right" : "left" })}
          className={cn(
            "flex cursor-default items-center gap-1 rounded-field border border-rule-strong bg-panel px-1.5 text-2xs text-ink-2 -outline-offset-2 transition-colors duration-100 hover:bg-well hover:text-ink data-disabled:opacity-50 data-selected:bg-ink data-selected:text-panel",
            touch ? "h-11 min-w-11" : "h-6",
          )}
        >
          <BendDrawing bend={bend} />
          <span className={cn("@max-3xl/map:sr-only", compact && "sr-only")}>{s.flip}</span>
        </ToggleButton>
      </Tip>
    </div>
  );
}

/**
 * The style the next shape will get, for the active tool only: its colour
 * (eight map colours or a custom one) or preset, and every option that
 * belongs to the kind. One row; on a narrow map it scrolls sideways rather
 * than wrapping and pushing the dock up.
 */
export function DrawStyleStrip({ compact = false }: { compact?: boolean }) {
  const t = useEditorStrings();
  const s = t.strip;
  const store = useEditorStoreApi();
  const tool = useEditorStore((state) => state.tool);
  const defaults = useEditorStore((state) => state.drawDefaults);
  if (tool === "select") return null;

  const setColor = (color: ColorRef): void => {
    if (tool === "area") {
      store.setDrawDefaults("area", { presetId: null, fill: { ...defaults.area.fill, color }, stroke: { ...defaults.area.stroke, color } });
    } else if (tool === "point") {
      store.setDrawDefaults("point", { presetId: null, color });
    } else if (tool === "annotation") {
      store.setDrawDefaults("annotation", { labelStyle: { ...defaults.annotation.labelStyle, color } });
    } else {
      store.setDrawDefaults(tool, { presetId: null, stroke: { ...defaults[tool].stroke, color } });
    }
  };
  const setDash = (kind: "area" | "line" | "arrow" | "frontline", dash: DashStyle): void =>
    store.setDrawDefaults(kind, { presetId: null, stroke: { ...defaults[kind].stroke, dash } });
  const dashGroup = (kind: "area" | "line", label: string) => (
    <OptionGroup
      key={`dash-${kind}`}
      label={label}
      value={dashValue(defaults[kind].stroke.dash)}
      options={DASHES.map((dash) => ({ id: dash, label: t.dashes[dash], drawing: <DashDrawing dash={dash} /> }))}
      onChange={(dash) => setDash(kind, dash)}
    />
  );

  const options: ReactNode[] = [];
  if (tool === "area") {
    options.push(
      <OptionGroup
        key="pattern"
        label={s.pattern}
        value={defaults.area.fill.pattern}
        options={PATTERNS.map((pattern) => ({ id: pattern, label: t.patterns[pattern], drawing: <PatternDrawing pattern={pattern} /> }))}
        onChange={(pattern) => store.setDrawDefaults("area", { presetId: null, fill: { ...defaults.area.fill, pattern } })}
      />,
      dashGroup("area", s.outline),
    );
  }
  if (tool === "line") {
    options.push(
      dashGroup("line", s.dash),
      <OptionGroup
        key="width"
        label={s.width}
        value={keyFor<WidthKey>(WIDTHS, defaults.line.stroke.width)}
        options={(Object.keys(WIDTHS) as WidthKey[]).map((key) => ({ id: key, label: `${s.width}: ${s.widthValue(WIDTHS[key])}`, drawing: <WidthDrawing width={WIDTHS[key]} /> }))}
        onChange={(key) => store.setDrawDefaults("line", { presetId: null, stroke: { ...defaults.line.stroke, width: WIDTHS[key] } })}
      />,
    );
  }
  if (tool === "arrow") {
    options.push(
      <OptionGroup
        key="head"
        label={s.head}
        value={defaults.arrow.head}
        options={HEADS.map((head) => ({ id: head, label: t.heads[head], drawing: <HeadDrawing head={head} /> }))}
        onChange={(head) => store.setDrawDefaults("arrow", { head })}
      />,
      <OptionGroup
        key="taper"
        label={s.taper}
        value={defaults.arrow.tapered ? "tapered" : "even"}
        options={(["tapered", "even"] as const).map((id) => ({ id, label: s.tapers[id], drawing: <TaperDrawing tapered={id === "tapered"} /> }))}
        onChange={(id) => store.setDrawDefaults("arrow", { tapered: id === "tapered" })}
      />,
      <CurveControls key="curve" compact={compact} />,
    );
  }
  if (tool === "frontline") {
    options.push(
      <OptionGroup
        key="facing"
        label={s.facing}
        value={defaults.frontline.facing}
        options={FACINGS.map((facing) => ({ id: facing, label: s.facings[facing], drawing: <FacingDrawing facing={facing} /> }))}
        onChange={(facing) => store.setDrawDefaults("frontline", { facing })}
      />,
      <OptionGroup
        key="tooth"
        label={s.tooth}
        value={defaults.frontline.toothShape}
        options={TEETH.map((shape) => ({ id: shape, label: t.teeth[shape], drawing: <ToothDrawing shape={shape} /> }))}
        onChange={(toothShape) => store.setDrawDefaults("frontline", { toothShape })}
      />,
    );
  }
  if (tool === "point") {
    options.push(
      <SymbolPicker key="symbol" />,
      <OptionGroup
        key="size"
        label={s.size}
        value={keyFor<SizeKey>(SIZES, defaults.point.size)}
        options={(Object.keys(SIZES) as SizeKey[]).map((key, index) => ({ id: key, label: s.sizes[key], drawing: <SizeDrawing size={3 + index * 2} /> }))}
        onChange={(key) => store.setDrawDefaults("point", { presetId: null, size: SIZES[key] })}
      />,
    );
  }
  if (tool === "annotation") {
    const label = defaults.annotation.labelStyle;
    options.push(
      <OptionGroup
        key="leader"
        label={s.leader}
        value={defaults.annotation.leader?.shape ?? "none"}
        options={LEADERS.map((leader) => ({ id: leader, label: t.leaders[leader], drawing: <LeaderDrawing leader={leader} /> }))}
        onChange={(shape) =>
          store.setDrawDefaults("annotation", {
            leader: shape === "none" ? null : { shape, anchorDot: defaults.annotation.leader?.anchorDot ?? true },
          })
        }
      />,
      <OptionGroup
        key="backing"
        label={s.backing}
        value={label.box ? "box" : label.halo ? "halo" : "none"}
        options={BACKINGS.map((backing) => ({ id: backing, label: s.backings[backing], drawing: <BackingDrawing backing={backing} /> }))}
        onChange={(backing) => store.setDrawDefaults("annotation", { labelStyle: { ...label, box: backing === "box", halo: backing === "halo" } })}
      />,
    );
  }

  const presetLocked = tool !== "annotation" && defaults[tool].presetId !== null;
  return (
    <div
      role="group"
      aria-label={s.label}
      className={cn(
        "pointer-events-auto flex max-w-full items-center overflow-x-auto rounded-pill border border-rule-strong bg-panel py-1 shadow-dock",
        compact ? "gap-1 px-1.5" : "gap-2 px-3",
      )}
    >
      {compact ? null : <span className="shrink-0 text-2xs font-semibold text-plum @max-3xl/map:hidden">{s.next}</span>}
      {compact ? (
        <ColorButton label={s.color} value={presetLocked ? null : colorOf(tool, defaults)} onChange={setColor} />
      ) : (
        <ColorSlots label={s.color} value={presetLocked ? null : colorOf(tool, defaults)} onChange={setColor} />
      )}
      {tool !== "annotation" ? <PresetMenu kind={tool} compact={compact} /> : null}
      {options.map((option, index) => (
        <div key={index} className={cn("flex shrink-0 items-center", compact ? "gap-1" : "gap-2")}>
          <Rule />
          {option}
        </div>
      ))}
    </div>
  );
}
