import { cn } from "cn";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { selectDrawOrder, useEditorStore, useEditorStoreApi, type Mixed } from "@/editor/store";
import { useLang } from "@/i18n";
import { useInspectorStrings } from "@/i18n/editor-inspector";
import type { IsoDateTime } from "@/model/types";
import { DateTimePicker } from "../shared/date-time-picker";
import { formatDayTime } from "../shared/format";
import { useEditorLayout } from "../shared/layout";
import { Caption, Section } from "./parts";
import type { SectionProps } from "./style-sections";

/** One end of a feature's life on the timeline, or left open. */
function Moment({
  label,
  value,
  empty,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: Mixed<IsoDateTime | null>;
  empty: string;
  onChange: (iso: IsoDateTime | null) => void;
  onCommit: () => void;
  disabled: boolean;
}) {
  const t = useInspectorStrings();
  const { touch } = useEditorLayout();
  const iso = value.state === "value" ? value.value : null;
  const mixed = value.state === "mixed";
  return (
    <div className="flex items-center gap-2">
      <Caption className="w-10 shrink-0">{label}</Caption>
      <DateTimePicker label={label} value={iso} disabled={disabled} onChange={onChange} onCommit={onCommit} className="flex-1" />
      {iso !== null ? (
        <Button variant="ghost" size={touch ? "icon-lg" : "icon"} aria-label={t.time.clear(label)} isDisabled={disabled} onPress={() => { onChange(null); onCommit(); }} className={touch ? "size-11" : undefined}>
          <Icon name="close" size={14} />
        </Button>
      ) : (
        <span className="w-16 shrink-0 text-end text-2xs text-ink-3">{mixed ? t.mixed : empty}</span>
      )}
    </div>
  );
}

/**
 * When the selection exists on the timeline, "continue from here" at the
 * playhead, and the sequence of states it belongs to.
 */
export function TimeSection({ summary, disabled }: SectionProps) {
  const t = useInspectorStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const { touch } = useEditorLayout();
  const playhead = useEditorStore((state) => state.timeline.playhead);
  const ordered = useEditorStore(selectDrawOrder);
  const commit = (): void => store.closeStep();

  const lineageId = summary.lineageId.state === "value" ? summary.lineageId.value : null;
  const selected = new Set(summary.ids);
  const siblings = lineageId === null ? [] : ordered.filter((feature) => feature.lineageId === lineageId && !selected.has(feature.id));
  const sorted = [...siblings].sort((a, b) => (a.validFrom ?? "").localeCompare(b.validFrom ?? ""));
  const canLink = summary.count > 1 && (summary.lineageId.state === "mixed" || lineageId === null);
  const size = touch ? "touch" : "sm";

  return (
    <Section title={t.time.heading}>
      <Moment label={t.time.from} value={summary.validFrom} empty={t.time.always} disabled={disabled} onChange={(validFrom) => store.setValidity({ validFrom })} onCommit={commit} />
      <Moment label={t.time.until} value={summary.validTo} empty={t.time.openEnded} disabled={disabled} onChange={(validTo) => store.setValidity({ validTo })} onCommit={commit} />

      {summary.single ? (
        <div className="flex flex-col gap-1">
          <Button variant="outline" size={size} isDisabled={disabled || playhead === null} onPress={() => store.continueFromHere()} className="self-start">
            {t.time.continue}
            {playhead !== null ? <span className="font-normal text-ink-3 tabular-nums">{formatDayTime(playhead, lang)}</span> : null}
          </Button>
          {playhead === null ? <p className="text-2xs text-ink-3">{t.time.needsPlayhead}</p> : null}
        </div>
      ) : null}

      {lineageId !== null || canLink ? (
        <div className="flex flex-col gap-1 border-t border-rule pt-2">
          <div className="flex items-center gap-2">
            <Caption className="font-medium text-ink">{t.time.lineage}</Caption>
            {lineageId !== null ? <span className="min-w-0 flex-1 truncate text-2xs text-ink-3">{sorted.length === 0 && summary.count > 1 ? t.time.lineageSelected(summary.count) : t.time.lineageOf(sorted.length)}</span> : <span className="flex-1" />}
            {canLink ? (
              <Button variant="link" size="text" className="text-xs" isDisabled={disabled} onPress={() => store.linkLineage()}>
                {t.time.link}
              </Button>
            ) : null}
            {lineageId !== null ? (
              <Button variant="link" size="text" className="text-xs" isDisabled={disabled} onPress={() => store.setLineage(null)}>
                {t.time.unlink}
              </Button>
            ) : null}
          </div>
          {sorted.length > 0 ? (
            <ol className="flex flex-col">
              {sorted.map((feature) => (
                <li key={feature.id}>
                  <button
                    type="button"
                    onClick={() => store.select([feature.id])}
                    className={cn("flex w-full items-center gap-2 rounded-key px-1 text-start text-xs text-ink hover:bg-well", touch ? "min-h-11" : "min-h-6")}
                  >
                    <span dir={feature.name.dir} className="min-w-0 flex-1 truncate">
                      {feature.name.value}
                    </span>
                    <span className="shrink-0 text-ink-3 tabular-nums">{feature.validFrom ? formatDayTime(feature.validFrom, lang) : t.time.always}</span>
                  </button>
                </li>
              ))}
              <li>
                <Button variant="link" size="text" className="px-1 text-xs" onPress={() => store.select([...summary.ids, ...sorted.map((feature) => feature.id)])}>
                  {t.time.selectAll}
                </Button>
              </li>
            </ol>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
