import { cn } from "cn";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { KIND_NAMES, PRESET_KINDS, selectDrawOrder, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useLang } from "@/i18n";
import { useExtrasStrings } from "@/i18n/editor-extras";
import type { FeatureKind, StylePreset } from "@/model/types";
import { ColorControl } from "../../inspector/color-control";
import { StyleSwatch } from "../../inspector/drawings";
import { PERCENT, PIXELS, SliderField } from "../../inspector/parts";
import { DashControl, PatternControl } from "../../inspector/style-sections";
import { colorCss, useMapPalette } from "../../shared/palette";
import { IconButton, Section } from "../shared/controls";
import { presetUse, sampleForPreset } from "./samples";
import { blankPreset, starterPresets, type StarterId } from "./starters";

/** The look of one preset: which kinds it styles, then fill, outline and icon colour, each only where the preset has it. */
function PresetEditor({ preset }: { preset: StylePreset }) {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().settings.presets;
  const lang = useLang();
  const palette = useMapPalette();
  const commit = (): void => store.closeStep();

  const toggleKind = (kind: FeatureKind): void => {
    const next = preset.appliesTo.includes(kind) ? preset.appliesTo.filter((candidate) => candidate !== kind) : [...preset.appliesTo, kind];
    if (next.length > 0) store.updatePreset(preset.id, { appliesTo: PRESET_KINDS.filter((candidate) => next.includes(candidate)) });
  };

  return (
    <div className="mb-1.5 flex flex-col gap-2.5 rounded-block bg-well p-2.5">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-2">{t.appliesTo}</span>
        <div role="group" aria-label={t.appliesTo} className="flex flex-wrap gap-1">
          {PRESET_KINDS.map((kind) => {
            const on = preset.appliesTo.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(kind)}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-field border px-1.5 text-xs font-medium",
                  on ? "border-ink bg-ink text-panel" : "border-rule-strong bg-panel text-ink-2 hover:bg-rule",
                )}
              >
                <Icon name={kind} size={12} />
                {KIND_NAMES[kind][lang]}
              </button>
            );
          })}
        </div>
      </div>
      {preset.fill !== undefined ? (
        <>
          <ColorControl
            label={t.fillColour}
            value={preset.fill.color}
            onChange={(color) => color !== "ink" && store.updatePreset(preset.id, { fill: { color } })}
            onCommit={commit}
          />
          <SliderField
            label={t.opacity}
            value={preset.fill.opacity}
            min={0}
            max={1}
            step={0.01}
            format={PERCENT}
            onChange={(opacity) => store.updatePreset(preset.id, { fill: { opacity } })}
            onCommit={commit}
          />
          <PatternControl
            value={preset.fill.pattern}
            mixed={false}
            color={colorCss(preset.fill.color, palette)}
            disabled={false}
            onChange={(pattern) => store.updatePreset(preset.id, { fill: { pattern } })}
          />
        </>
      ) : null}
      {preset.stroke !== undefined ? (
        <>
          <ColorControl
            label={t.outlineColour}
            value={preset.stroke.color}
            onChange={(color) => color !== "ink" && store.updatePreset(preset.id, { stroke: { color } })}
            onCommit={commit}
          />
          <SliderField
            label={t.width}
            value={preset.stroke.width}
            min={0}
            max={12}
            step={0.5}
            format={PIXELS}
            onChange={(width) => store.updatePreset(preset.id, { stroke: { width } })}
            onCommit={commit}
          />
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
      {preset.iconColor !== undefined ? (
        <ColorControl
          label={t.iconColour}
          value={preset.iconColor}
          onChange={(iconColor) => iconColor !== "ink" && store.updatePreset(preset.id, { iconColor })}
          onCommit={commit}
        />
      ) : null}
    </div>
  );
}

/**
 * The map's named styles as a list to manage: what each looks like, how many
 * features follow it, and its name, look and removal in place.
 */
export function PresetsSection({ disabled }: { disabled: boolean }) {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().settings.presets;
  const lang = useLang();
  const settings = useEditorStore((state) => state.doc.settings);
  const features = useEditorStore(selectDrawOrder);
  const dir = useEditorStore((state) => state.doc.uiDir);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const use = useMemo(() => presetUse(features), [features]);
  const presets = settings.presets;

  const addStarter = (id: StarterId): void => {
    store.addPresets(starterPresets(id, lang, presets));
  };
  const addBlank = (): void => {
    const preset = blankPreset(t.newName(presets.length + 1), lang, presets);
    if (store.addPresets([preset]).ok) setEditing(preset.id);
  };

  return (
    <Section id="presets" title={t.heading} summary={String(presets.length)} aside={<span className="text-xs text-ink-3 tabular-nums">{presets.length}</span>}>
      {presets.length === 0 ? (
        <p className="text-xs text-ink-3">{t.empty}</p>
      ) : (
        <ul aria-label={t.heading} className="flex flex-col">
          {presets.map((preset) => {
            const count = use.get(preset.id) ?? 0;
            return (
              <li key={preset.id} data-preset={preset.id}>
                <div className="flex h-row items-center gap-1.5">
                  <StyleSwatch sample={sampleForPreset(preset, features)} settings={settings} dir={dir} />
                  <input
                    type="text"
                    dir={preset.name.dir}
                    disabled={disabled}
                    aria-label={t.nameOf(preset.name.value)}
                    value={preset.name.value}
                    onChange={(event) => store.renamePreset(preset.id, { ...preset.name, value: event.target.value })}
                    onBlur={() => store.closeStep()}
                    className="h-6 min-w-0 flex-1 rounded-key border border-transparent bg-transparent px-1 text-sm hover:border-rule-strong focus:border-rule-strong focus:bg-panel"
                  />
                  <span className="shrink-0 text-2xs text-ink-3 tabular-nums" title={t.usedBy(count)}>
                    {count}
                  </span>
                  <Button
                    variant={editing === preset.id ? "secondary" : "ghost"}
                    size="sm"
                    isDisabled={disabled}
                    aria-expanded={editing === preset.id}
                    onPress={() => setEditing(editing === preset.id ? null : preset.id)}
                  >
                    {editing === preset.id ? t.done : t.edit}
                  </Button>
                  <IconButton icon="trash" label={t.deleteNamed(preset.name.value)} disabled={disabled} onPress={() => setDeleting(preset.id)} />
                </div>
                {deleting === preset.id ? (
                  <Notice
                    tone="warning"
                    title={t.deleteTitle(preset.name.value)}
                    className="mb-1.5"
                    action={
                      <div className="flex flex-col gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          onPress={() => {
                            store.deletePreset(preset.id);
                            setDeleting(null);
                            if (editing === preset.id) setEditing(null);
                          }}
                        >
                          {t.delete}
                        </Button>
                        <Button variant="outline" size="sm" onPress={() => setDeleting(null)}>
                          {t.keep}
                        </Button>
                      </div>
                    }
                  >
                    {count === 0 ? t.deleteUnused : t.deleteUsed(count)}
                  </Notice>
                ) : null}
                {editing === preset.id && !disabled ? <PresetEditor preset={preset} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col items-start gap-1.5">
        <Button variant="outline" size="sm" isDisabled={disabled} onPress={addBlank}>
          <Icon name="plus" size={12} />
          {t.create}
        </Button>
        <span className="text-xs text-ink-2">{t.starters}</span>
        {(["conflict", "storm"] as const).map((id) => {
          const missing = starterPresets(id, lang, presets).length;
          return (
            <Button key={id} variant="outline" size="sm" isDisabled={disabled || missing === 0} data-starter={id} onPress={() => addStarter(id)} className="h-auto min-h-6 max-w-full py-0.5 text-start whitespace-normal">
              {missing === 0 ? t.starterAdded(t.starterNames[id]) : t.starter[id]}
            </Button>
          );
        })}
      </div>
    </Section>
  );
}
