import { cn } from "cn";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { shallowEqual, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useLang } from "@/i18n";
import { useExtrasStrings } from "@/i18n/editor-extras";
import type { RichText } from "@/model/types";
import { DateTimePicker } from "../../shared/date-time-picker";
import { requestSettingsSection } from "../shared/bus";
import { Section, Segmented, Toggle } from "../shared/controls";
import { effectiveDir, formatMoment, zoneName } from "../shared/format";
import { DirTextField } from "./dir-text";

type LineId = "title" | "subtitle" | "asOf" | "source" | "credit" | "note";
type BlockText = "subtitle" | "source" | "credit" | "note";

/**
 * The editor for one line, in place of the line. Enter or Escape, or focus
 * leaving it, puts the line back; every keystroke is already in the store.
 */
function InPlace({ onDone, children }: { onDone: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, [role=spinbutton]")?.focus();
  }, []);
  return (
    <div
      ref={box}
      data-in-place
      className="-mx-1 rounded-key bg-well p-1"
      onKeyDown={(event) => {
        if (event.key !== "Escape" && !(event.key === "Enter" && event.target instanceof HTMLInputElement)) return;
        event.preventDefault();
        event.stopPropagation();
        onDone();
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        /* The date picker's calendar lives in the editor's portal, outside this box. */
        if (next instanceof Node && (box.current?.contains(next) || next.parentElement?.closest("[data-editor-portal]"))) return;
        onDone();
      }}
    >
      {children}
    </div>
  );
}

/** A printed line that is also the button that edits it. Empty lines show what could go there. */
function Line({
  text,
  empty,
  label,
  onEdit,
  disabled,
  className,
  dir,
}: {
  text: string | null;
  empty: string;
  label: string;
  onEdit: () => void;
  disabled: boolean;
  className?: string;
  dir: "ltr" | "rtl";
}) {
  const t = useExtrasStrings().settings.document;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onEdit}
      aria-label={`${t.edit(label)}${text === null ? "" : `: ${text}`}`}
      className={cn(
        "-mx-1 block w-full rounded-key px-1 text-start outline-offset-1 outline-focus hover:bg-well focus-visible:outline-2 disabled:hover:bg-transparent",
        className,
      )}
    >
      {text === null ? (
        <span className="font-ui text-xs font-normal text-ink-3 italic">{empty}</span>
      ) : (
        <span dir={dir}>{text}</span>
      )}
    </button>
  );
}

function AsOfEditor({ asOf, disabled }: { asOf: string | null; disabled: boolean }) {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().settings.titleBlock;
  const playhead = useEditorStore((state) => state.timeline.playhead);
  return (
    <div className="flex flex-col gap-1.5">
      <DateTimePicker label={t.asOf} value={asOf} disabled={disabled} onChange={(next) => store.setAsOf(next)} onCommit={() => store.closeStep()} />
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" isDisabled={disabled} onPress={() => store.setAsOf(new Date().toISOString())}>
          {t.now}
        </Button>
        <Button variant="outline" size="sm" isDisabled={disabled || playhead === null} onPress={() => playhead !== null && store.setAsOf(playhead)}>
          {t.usePlayhead}
        </Button>
        <Button variant="ghost" size="sm" isDisabled={disabled || asOf === null} onPress={() => store.setAsOf(null)}>
          {t.clear}
        </Button>
      </div>
    </div>
  );
}

/**
 * The map's own document: a live miniature of the title block, the key and
 * the small print, set in the faces the published map uses. Each line is
 * the thing you edit; pressing it opens its field in place. Below it, the
 * two switches that decide what is printed and which way it reads.
 */
export function DocumentSection({ disabled }: { disabled: boolean }) {
  const store = useEditorStoreApi();
  const strings = useExtrasStrings();
  const t = strings.settings;
  const lang = useLang();
  const { title, block, legend, uiDir, keyCount } = useEditorStore(
    (state) => ({
      title: state.doc.title,
      block: state.doc.settings.titleBlock,
      legend: state.doc.settings.legend,
      uiDir: state.doc.uiDir,
      keyCount: state.doc.settings.legend.items.filter((item) => !item.hidden).length,
    }),
    shallowEqual,
  );
  const [editing, setEditing] = useState<LineId | null>(null);
  const done = (): void => {
    store.closeStep();
    setEditing(null);
  };

  const textLine = (id: BlockText, label: string, empty: string, className: string, placeholder?: string): ReactNode => {
    const value: RichText | null = block[id];
    if (editing === id) {
      return (
        <InPlace onDone={done}>
          <DirTextField label={label} value={value} placeholder={placeholder} disabled={disabled} onChange={(next) => store.setTitleBlock({ [id]: next })} />
        </InPlace>
      );
    }
    return (
      <Line
        text={value === null || value.value === "" ? null : value.value}
        dir={value === null ? uiDir : effectiveDir(value, uiDir)}
        empty={empty}
        label={label}
        disabled={disabled}
        onEdit={() => setEditing(id)}
        className={className}
      />
    );
  };

  const asOfMs = block.asOf === null ? null : Date.parse(block.asOf);
  const printed = block.show;
  const suggestion = t.titleBlock.noteSuggestion;

  return (
    <Section id="document" title={t.document.heading}>
      <div
        data-document-miniature
        dir={uiDir}
        className="flex flex-col gap-2 rounded-key border border-rule-strong bg-panel p-2.5"
      >
        <div className={cn("flex flex-col gap-0.5", !printed && "opacity-60")}>
          {editing === "title" ? (
            <InPlace onDone={done}>
              <DirTextField
                label={t.identity.title}
                value={title}
                serif
                disabled={disabled}
                onChange={(next) => store.setTitle(next ?? { value: "", dir: "auto" })}
              />
            </InPlace>
          ) : (
            <Line
              text={title.value === "" ? null : title.value}
              dir={effectiveDir(title, uiDir)}
              empty={t.identity.title}
              label={t.identity.title}
              disabled={disabled}
              onEdit={() => setEditing("title")}
              className="font-title text-lg leading-snug font-semibold text-ink"
            />
          )}
          {textLine("subtitle", t.titleBlock.subtitle, t.document.add.subtitle, "text-xs text-ink-2")}
          {editing === "asOf" ? (
            <InPlace onDone={done}>
              <AsOfEditor asOf={block.asOf} disabled={disabled} />
            </InPlace>
          ) : (
            <Line
              text={asOfMs === null ? null : t.document.asOfLine(`${formatMoment(asOfMs, lang)} ${zoneName(asOfMs, lang)}`)}
              dir={uiDir}
              empty={t.document.add.asOf}
              label={t.titleBlock.asOf}
              disabled={disabled}
              onEdit={() => setEditing("asOf")}
              className="text-xs font-semibold text-ink tabular-nums"
            />
          )}
          {printed ? null : <span className="text-2xs text-ink-3">{t.titleBlock.hidden}</span>}
        </div>

        <button
          type="button"
          onClick={() => requestSettingsSection("legend")}
          aria-label={t.document.openKey}
          className="-mx-1 flex items-baseline gap-2 rounded-key border-t border-rule px-1 pt-1.5 text-start outline-offset-1 outline-focus hover:bg-well focus-visible:outline-2"
        >
          <span dir={effectiveDir(legend.title, uiDir)} className={cn("font-title text-sm font-semibold text-ink", !legend.show && "text-ink-3")}>
            {legend.title.value === "" ? t.legend.heading : legend.title.value}
          </span>
          <span className="text-2xs text-ink-3 tabular-nums">{legend.show ? t.document.keyEntries(keyCount) : t.document.keyOff}</span>
        </button>

        <div className={cn("flex flex-col border-t border-rule pt-1.5", !printed && "opacity-60")}>
          {textLine("source", t.titleBlock.source, t.document.add.source, "text-2xs text-ink-2", t.titleBlock.sourcePlaceholder)}
          {textLine("credit", t.titleBlock.credit, t.document.add.credit, "text-2xs text-ink-2", t.titleBlock.creditPlaceholder)}
          {textLine("note", t.titleBlock.note, t.document.add.note, "text-2xs text-ink-2")}
          {editing === null && block.note?.value !== suggestion && !disabled ? (
            <Button
              variant="link"
              size="text"
              className="mt-0.5 self-start text-2xs"
              onPress={() => store.setTitleBlock({ note: { value: suggestion, dir: "auto" } })}
            >
              {t.titleBlock.useSuggestion(suggestion)}
            </Button>
          ) : null}
        </div>
      </div>

      <Toggle checked={block.show} disabled={disabled} onChange={(show) => store.setTitleBlock({ show })}>
        {t.titleBlock.show}
      </Toggle>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-2">{t.identity.direction}</span>
        <Segmented
          label={t.identity.direction}
          value={uiDir}
          disabled={disabled}
          onChange={(next) => store.setUiDir(next)}
          className="w-full"
          options={[
            { value: "ltr", label: strings.names.direction.ltr },
            { value: "rtl", label: strings.names.direction.rtl },
          ]}
        />
      </div>
    </Section>
  );
}

