import { cn } from "cn";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { selectDrawOrder, selectLegend, useEditorStore, useEditorStoreApi, type LegendEntry } from "@/editor/store";
import { useExtrasStrings } from "@/i18n/editor-extras";
import type { MapFeature, MapSettings } from "@/model/types";
import { StyleSwatch } from "../../inspector/drawings";
import { fold } from "../palette/fuzzy";
import { IconButton, Section, Toggle } from "../shared/controls";
import { DirTextField } from "./dir-text";
import { sampleForPreset } from "./samples";

type Position = MapSettings["legend"]["position"];
const POSITIONS: { id: Position; place: string }[] = [
  { id: "top-start", place: "start-1 top-1" },
  { id: "top-end", place: "end-1 top-1" },
  { id: "bottom-start", place: "start-1 bottom-1" },
  { id: "bottom-end", place: "end-1 bottom-1" },
];

/** The four corners of the map, drawn as a map: the filled block is where the key sits. */
function PositionPicker({ value, disabled, onChange }: { value: Position; disabled: boolean; onChange: (position: Position) => void }) {
  const t = useExtrasStrings().settings.legend;
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label={t.position} className="relative h-12 w-20 shrink-0 rounded-key border border-rule-strong bg-well">
        {POSITIONS.map((position) => (
          <button
            key={position.id}
            type="button"
            role="radio"
            aria-checked={value === position.id}
            aria-label={t.positions[position.id]}
            disabled={disabled}
            onClick={() => onChange(position.id)}
            className={cn(
              "absolute h-4 w-7 rounded-key border disabled:opacity-50",
              position.place,
              value === position.id ? "border-ink bg-ink" : "border-dashed border-rule-strong bg-panel hover:border-ink-3",
            )}
          />
        ))}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-ink-2">{t.position}</span>
        <span className="text-sm font-medium text-ink">{t.positions[value]}</span>
      </div>
    </div>
  );
}

function sampleOf(entry: LegendEntry, settings: MapSettings, features: readonly MapFeature[]): MapFeature | null {
  if ("featureId" in entry.ref) {
    const { featureId } = entry.ref;
    return features.find((feature) => feature.id === featureId) ?? null;
  }
  const { presetId } = entry.ref;
  const preset = settings.presets.find((candidate) => candidate.id === presetId);
  return preset === undefined ? null : sampleForPreset(preset, features);
}

function baseName(entry: LegendEntry, settings: MapSettings, features: readonly MapFeature[]): string {
  if ("featureId" in entry.ref) {
    const { featureId } = entry.ref;
    return features.find((feature) => feature.id === featureId)?.name.value ?? "";
  }
  const { presetId } = entry.ref;
  return settings.presets.find((preset) => preset.id === presetId)?.name.value ?? "";
}

/** The entries of the key: relabel, hide, and drag or arrow them into order. */
function Items({ disabled }: { disabled: boolean }) {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().settings.legend;
  const entries = useEditorStore(selectLegend);
  const settings = useEditorStore((state) => state.doc.settings);
  const features = useEditorStore(selectDrawOrder);
  const dir = useEditorStore((state) => state.doc.uiDir);
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ key: string; to: number } | null>(null);
  const [said, setSaid] = useState("");

  const shown = useMemo(() => {
    if (drag === null) return entries;
    const moving = entries.find((entry) => entry.key === drag.key);
    if (moving === undefined) return entries;
    const rest = entries.filter((entry) => entry.key !== drag.key);
    rest.splice(drag.to, 0, moving);
    return rest;
  }, [entries, drag]);

  const indexUnder = (clientY: number, key: string): number => {
    let above = 0;
    for (const row of list.current?.children ?? []) {
      if (!(row instanceof HTMLElement) || row.dataset.key === key) continue;
      const rect = row.getBoundingClientRect();
      if (rect.top + rect.height / 2 < clientY) above += 1;
    }
    return above;
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, entry: LegendEntry, index: number): void => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ key: entry.key, to: index });
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (drag === null) return;
    const to = indexUnder(event.clientY, drag.key);
    if (to !== drag.to) setDrag({ key: drag.key, to });
  };
  const drop = (): void => {
    if (drag === null) return;
    const from = entries.findIndex((entry) => entry.key === drag.key);
    const moving = entries[from];
    if (moving !== undefined && from !== drag.to) store.moveLegendItem(moving.ref, drag.to);
    setDrag(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, entry: LegendEntry, index: number): void => {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (step === 0 || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const to = index + step;
    if (to < 0 || to >= entries.length) return;
    store.moveLegendItem(entry.ref, to);
    setSaid(t.moved(entry.label.value, to + 1, entries.length));
  };

  if (entries.length === 0) return <p className="text-xs text-ink-3">{t.empty}</p>;

  return (
    <>
      <ol ref={list} aria-label={t.items} className="flex flex-col">
        {shown.map((entry, index) => {
          const sample = sampleOf(entry, settings, features);
          const name = baseName(entry, settings, features);
          return (
            <li
              key={entry.key}
              data-key={entry.key}
              className={cn("flex h-row items-center gap-1 rounded-block", drag?.key === entry.key && "bg-well", entry.hidden && "text-ink-3")}
            >
              <button
                type="button"
                disabled={disabled}
                aria-label={t.reorder(entry.label.value)}
                title={t.reorderHint}
                onPointerDown={(event) => onPointerDown(event, entry, index)}
                onPointerMove={onPointerMove}
                onPointerUp={drop}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(event) => onKeyDown(event, entry, index)}
                className="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-key text-ink-3 hover:text-ink disabled:opacity-50"
              >
                <Icon name="grip" size={12} />
              </button>
              <span className={cn("flex shrink-0", entry.hidden && "opacity-40")}>{sample === null ? null : <StyleSwatch sample={sample} settings={settings} dir={dir} />}</span>
              <input
                type="text"
                dir="auto"
                disabled={disabled}
                aria-label={t.labelFor(name)}
                value={entry.overridden ? entry.label.value : ""}
                placeholder={name}
                onChange={(event) => {
                  const next = event.target.value;
                  store.setLegendItem(entry.ref, { label: next === "" ? null : { value: next, dir: "auto" } });
                }}
                onBlur={() => store.closeStep()}
                className={cn(
                  "h-6 min-w-0 flex-1 rounded-key border border-transparent bg-transparent px-1 text-sm placeholder:text-ink hover:border-rule-strong focus:border-rule-strong focus:bg-panel",
                  entry.hidden && "line-through placeholder:text-ink-3",
                )}
              />
              <span className="shrink-0 text-2xs text-ink-3 tabular-nums" title={t.count(entry.count)}>
                {entry.count}
              </span>
              <IconButton
                icon={entry.hidden ? "eyeOff" : "eye"}
                label={entry.hidden ? t.showItem(entry.label.value) : t.hideItem(entry.label.value)}
                pressed={entry.hidden}
                disabled={disabled}
                onPress={() => store.setLegendItem(entry.ref, { hidden: !entry.hidden })}
              />
              {"featureId" in entry.ref ? (
                <IconButton icon="close" label={t.removeItem(entry.label.value)} disabled={disabled} onPress={() => store.removeLegendItem(entry.ref)} />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
    </>
  );
}

/** Picks a feature that follows no preset and gives it its own line in the key. */
function AddFeature({ disabled }: { disabled: boolean }) {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().settings.legend;
  const features = useEditorStore(selectDrawOrder);
  const settings = useEditorStore((state) => state.doc.settings);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const candidates = useMemo(() => {
    const presets = new Set(settings.presets.map((preset) => preset.id));
    const listed = new Set(settings.legend.items.flatMap((item) => ("featureId" in item.ref ? [item.ref.featureId] : [])));
    return features.filter(
      (feature) => feature.kind !== "annotation" && !listed.has(feature.id) && (feature.presetId === null || !presets.has(feature.presetId)),
    );
  }, [features, settings]);
  const folded = fold(query);
  const matches = folded === "" ? candidates : candidates.filter((feature) => fold(feature.name.value).includes(folded));

  if (!open) {
    return (
      <Button variant="outline" size="sm" isDisabled={disabled} className="self-start" onPress={() => setOpen(true)}>
        <Icon name="plus" size={12} />
        {t.addFeature}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-block border border-rule-strong p-2">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          dir="auto"
          autoFocus
          aria-label={t.findFeature}
          placeholder={t.findFeature}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setOpen(false);
          }}
          className="h-field min-w-0 flex-1 rounded-field border border-rule-strong bg-panel px-2 text-sm placeholder:text-ink-3"
        />
        <Button variant="ghost" size="sm" onPress={() => setOpen(false)}>
          {t.done}
        </Button>
      </div>
      {matches.length === 0 ? (
        <p className="text-xs text-ink-3">{candidates.length === 0 ? t.noCandidates : t.noCandidateMatch}</p>
      ) : (
        <ul aria-label={t.candidates} className="flex max-h-40 flex-col overflow-y-auto">
          {matches.map((feature) => (
            <li key={feature.id}>
              <button
                type="button"
                onClick={() => store.addLegendFeature(feature.id)}
                className="flex h-7 w-full items-center gap-2 rounded-key px-1 text-start text-sm hover:bg-well"
              >
                <Icon name={feature.kind} size={14} className="shrink-0 text-ink-3" />
                <span dir={feature.name.dir} className="min-w-0 flex-1 truncate">
                  {feature.name.value}
                </span>
                <Icon name="plus" size={12} className="shrink-0 text-ink-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The map key: whether it shows, its heading, its corner, and what it lists. */
export function LegendSection({ disabled }: { disabled: boolean }) {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().settings.legend;
  const legend = useEditorStore((state) => state.doc.settings.legend);
  return (
    <Section id="legend" title={t.heading} summary={legend.show ? undefined : t.show}>
      <Toggle checked={legend.show} disabled={disabled} onChange={(show) => store.setLegend({ show })}>
        {t.show}
      </Toggle>
      <DirTextField label={t.title} value={legend.title} serif disabled={disabled} onChange={(title) => store.setLegend({ title: title ?? { value: "", dir: "auto" } })} />
      <PositionPicker value={legend.position} disabled={disabled} onChange={(position) => store.setLegend({ position })} />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-2">{t.itemsHint}</span>
        <Items disabled={disabled} />
      </div>
      <AddFeature disabled={disabled} />
    </Section>
  );
}
