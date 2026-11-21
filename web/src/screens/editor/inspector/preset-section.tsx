import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { buildFeature, initialDrawDefaults, newId, useEditorStore, useEditorStoreApi, type NewGeometry } from "@/editor/store";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import type { FeatureKind, MapFeature, MapSettings, StylePreset } from "@/model/types";
import { useEditorLayout } from "../shared/layout";
import { colorCss, useMapPalette } from "../shared/palette";
import { ColorControl } from "./color-control";
import { StyleSwatch } from "./drawings";
import { PERCENT, PIXELS, Section, SliderField } from "./parts";
import { DashControl, PatternControl, type SectionProps } from "./style-sections";

const GEOMETRY: Record<Exclude<FeatureKind, "annotation">, NewGeometry> = {
  area: { kind: "area", rings: [] },
  line: { kind: "line", path: [] },
  arrow: { kind: "arrow", control: [] },
  frontline: { kind: "frontline", path: [] },
  point: { kind: "point", at: [0, 0] },
};

/** A stand-in feature that follows the preset, for the swatch painter. */
function sampleFor(preset: StylePreset, prefer: FeatureKind[]): MapFeature {
  const kind = prefer.find((candidate) => preset.appliesTo.includes(candidate)) ?? preset.appliesTo[0] ?? "area";
  const feature = buildFeature(GEOMETRY[kind === "annotation" ? "area" : kind], initialDrawDefaults(), { uiDir: "ltr", now: "", userId: "", id: `sample:${preset.id}` });
  return { ...feature, presetId: preset.id };
}

function PresetSwatch({ preset, kinds, settings }: { preset: StylePreset; kinds: FeatureKind[]; settings: MapSettings }) {
  const dir = useEditorStore((state) => state.doc.uiDir);
  const sample = useMemo(() => sampleFor(preset, kinds), [preset, kinds]);
  return <StyleSwatch sample={sample} settings={settings} dir={dir} />;
}

/** Change the preset itself: every feature that follows it changes with it. */
function PresetEditor({ preset, usedBy, onDone }: { preset: StylePreset; usedBy: number; onDone: () => void }) {
  const t = useInspectorStrings();
  const store = useEditorStoreApi();
  const palette = useMapPalette();
  const { touch } = useEditorLayout();
  const commit = (): void => store.closeStep();
  const color = preset.stroke?.color ?? preset.fill?.color ?? preset.iconColor;
  return (
    <div className="flex flex-col gap-2.5 rounded-block bg-well p-2.5">
      <p className="text-xs text-ink-2">{t.preset.editing(preset.name.value)}</p>
      <Input
        aria-label={t.preset.newName}
        dir={preset.name.dir}
        value={preset.name.value}
        onChange={(event) => store.renamePreset(preset.id, { ...preset.name, value: event.target.value })}
        onBlur={commit}
        className={touch ? "h-11" : undefined}
      />
      <ColorControl
        label={t.preset.colour}
        value={color}
        onChange={(next) => {
          if (next !== "ink") store.updatePreset(preset.id, { fill: { color: next }, stroke: { color: next }, iconColor: next });
        }}
        onCommit={commit}
      />
      {preset.fill ? (
        <>
          <SliderField label={t.fill.opacity} value={preset.fill.opacity} min={0} max={1} step={0.01} format={PERCENT} onChange={(opacity) => store.updatePreset(preset.id, { fill: { opacity } })} onCommit={commit} />
          <PatternControl value={preset.fill.pattern} mixed={false} color={colorCss(preset.fill.color, palette)} disabled={false} onChange={(pattern) => store.updatePreset(preset.id, { fill: { pattern } })} />
        </>
      ) : null}
      {preset.stroke ? (
        <>
          <SliderField label={t.stroke.width} value={preset.stroke.width} min={0} max={12} step={0.5} format={PIXELS} onChange={(width) => store.updatePreset(preset.id, { stroke: { width } })} onCommit={commit} />
          <DashControl
            value={preset.stroke.dash}
            mixed={false}
            color={colorCss(preset.stroke.color, palette)}
            disabled={false}
            onChange={(dash) => {
              store.updatePreset(preset.id, { stroke: { dash } });
              commit();
            }}
          />
        </>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-ink-3 tabular-nums">{t.preset.usedBy(usedBy)}</span>
        <Button variant="destructive" size={touch ? "touch" : "sm"} onPress={() => store.deletePreset(preset.id)}>
          {t.preset.delete}
        </Button>
        <Button variant="outline" size={touch ? "touch" : "sm"} onPress={onDone}>
          {t.preset.done}
        </Button>
      </div>
    </div>
  );
}

/**
 * The named style the selection follows: pick one, let go of it, make a new
 * one from this look, or change the preset for everything that uses it.
 */
export function PresetSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const store = useEditorStoreApi();
  const { touch } = useEditorLayout();
  const settings = useEditorStore((state) => state.doc.settings);
  const dir = useEditorStore((state) => state.doc.uiDir);
  const features = useEditorStore((state) => state.doc.features);
  const [mode, setMode] = useState<"idle" | "saving" | "editing">("idle");
  const [name, setName] = useState("");

  const kinds = summary.kinds.filter((kind) => kind !== "annotation");
  if (kinds.length === 0) return null;
  const applicable = settings.presets.filter((preset) => kinds.some((kind) => preset.appliesTo.includes(kind)));
  const mixed = summary.presetId.state === "mixed";
  const presetId = summary.presetId.state === "value" ? summary.presetId.value : null;
  const current = presetId === null ? undefined : settings.presets.find((preset) => preset.id === presetId);
  const primary = summary.features[summary.features.length - 1];
  const usedBy = current ? [...features.values()].filter((feature) => feature.presetId === current.id).length : 0;
  const size = touch ? "touch" : "default";

  const save = (): void => {
    const trimmed = name.trim();
    if (trimmed === "" || !primary) return;
    const id = newId();
    const created = store.createPreset({ name: { value: trimmed, dir: "auto" }, fromFeatureId: primary.id, id });
    if (created.ok && summary.count > 1) store.applyPreset(id);
    setName("");
    setMode("idle");
  };

  return (
    <Section
      title={t.preset.heading}
      aside={
        current && !disabled ? (
          <Button variant="link" size="text" className="text-xs" onPress={() => store.detachPreset()}>
            {t.preset.detach}
          </Button>
        ) : null
      }
    >
      <DropdownMenuTrigger>
        <Button variant="outline" size={size} isDisabled={disabled} aria-label={t.preset.choose} className="w-full justify-start gap-2 px-2">
          {current ? <PresetSwatch preset={current} kinds={kinds} settings={settings} /> : !mixed && primary ? <StyleSwatch sample={primary} settings={settings} dir={dir} /> : null}
          <span dir={current?.name.dir} className="min-w-0 flex-1 truncate text-start">
            {mixed ? t.mixed : (current?.name.value ?? t.preset.own)}
          </span>
          <Icon name="chevron" size={12} className="rotate-90 text-ink-3" />
        </Button>
        <DropdownMenu placement="bottom start" className="min-w-64">
          <DropdownMenuItem id="own" textValue={t.preset.own} onAction={() => store.detachPreset()}>
            <span className="w-7.5 shrink-0" />
            {t.preset.own}
            {!mixed && current === undefined ? <Icon name="check" size={14} className="ms-auto" /> : null}
          </DropdownMenuItem>
          {applicable.length > 0 ? <DropdownMenuSeparator /> : null}
          {applicable.map((preset) => (
            <DropdownMenuItem key={preset.id} id={preset.id} textValue={preset.name.value} onAction={() => store.applyPreset(preset.id)}>
              <PresetSwatch preset={preset} kinds={kinds} settings={settings} />
              <span dir={preset.name.dir} className="min-w-0 truncate">
                {preset.name.value}
              </span>
              {preset.id === presetId ? <Icon name="check" size={14} className="ms-auto" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      </DropdownMenuTrigger>

      {mode === "editing" && current ? (
        <PresetEditor preset={current} usedBy={usedBy} onDone={() => setMode("idle")} />
      ) : mode === "saving" ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Input
            autoFocus
            dir="auto"
            aria-label={t.preset.newName}
            placeholder={t.preset.newPlaceholder}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setMode("idle");
              }
            }}
            className={touch ? "h-11" : undefined}
          />
          <Button type="submit" size={size} isDisabled={name.trim() === ""}>
            {t.preset.save}
          </Button>
          <Button variant="ghost" size={size} onPress={() => setMode("idle")}>
            {t.preset.cancel}
          </Button>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size={touch ? "touch" : "sm"} isDisabled={disabled || !primary} onPress={() => setMode("saving")}>
              {t.preset.saveAs}
            </Button>
            {current ? (
              <Button variant="outline" size={touch ? "touch" : "sm"} isDisabled={disabled} onPress={() => setMode("editing")}>
                {t.preset.edit}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </Section>
  );
}
