import { Button } from "@/components/ui/button";
import { selectTimeExtent, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useExtrasStrings } from "@/i18n/editor-extras";
import { Check, Hint, Row, Section, Segmented, Toggle } from "../shared/controls";
import { isMac } from "../shared/format";
import { ChoiceMenu } from "../shared/overlay";
import { durationLabel, speedChoices, speedLabel } from "../timeline/durations";
import { windowChoices } from "../timeline/ticks";

/** How the published map behaves inside an article. */
export function EmbedSection({ disabled }: { disabled: boolean }) {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().settings.embed;
  const embed = useEditorStore((state) => state.doc.settings.embed);
  const keyShown = useEditorStore((state) => state.doc.settings.legend.show);
  return (
    <Section id="embed" title={t.heading} summary={embed.static ? t.static : t.themes[embed.theme]}>
      <div className="flex flex-col gap-1">
        <Check checked={embed.legend} disabled={disabled} onChange={(legend) => store.setEmbed({ legend })}>
          {t.legend}
          {embed.legend && !keyShown ? <Hint>{t.legendOff}</Hint> : null}
        </Check>
        <Check checked={embed.scaleBar} disabled={disabled} onChange={(scaleBar) => store.setEmbed({ scaleBar })}>
          {t.scaleBar}
        </Check>
        <Check checked={embed.zoomButtons} disabled={disabled || embed.static} onChange={(zoomButtons) => store.setEmbed({ zoomButtons })}>
          {t.zoomButtons}
        </Check>
        <Check
          checked={embed.cooperativeGestures}
          disabled={disabled || embed.static}
          onChange={(cooperativeGestures) => store.setEmbed({ cooperativeGestures })}
        >
          {t.cooperative(isMac() ? "⌘" : "Ctrl")}
          <Hint>{t.cooperativeHint}</Hint>
        </Check>
        <Check checked={embed.static} disabled={disabled} onChange={(isStatic) => store.setEmbed({ static: isStatic })}>
          {t.static}
          <Hint>{t.staticHint}</Hint>
        </Check>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-2">{t.theme}</span>
        <Segmented
          label={t.theme}
          value={embed.theme}
          disabled={disabled}
          className="w-full"
          onChange={(theme) => store.setEmbed({ theme })}
          options={[
            { value: "light", label: t.themes.light },
            { value: "dark", label: t.themes.dark },
            { value: "auto", label: t.themes.auto },
          ]}
        />
      </div>
    </Section>
  );
}

/** Whether readers get the timeline, and how it plays for them. */
export function ReaderTimelineSection({ disabled }: { disabled: boolean }) {
  const store = useEditorStoreApi();
  const strings = useExtrasStrings();
  const t = strings.settings.readerTimeline;
  const timeline = useEditorStore((state) => state.doc.settings.timeline);
  const extent = useEditorStore(selectTimeExtent);
  const dated = extent !== null;
  const span = extent === null ? null : extent.toMs - extent.fromMs;
  const off = disabled || !timeline.enabled;
  return (
    <Section id="timeline" title={t.heading} summary={timeline.enabled ? speedLabel(timeline.speed, strings.timeline) : strings.timeline.readers.off}>
      <Toggle checked={timeline.enabled} disabled={disabled} onChange={(enabled) => store.setTimelineSettings({ enabled })}>
        {t.enabled}
      </Toggle>
      {timeline.enabled && !dated ? <Hint>{t.noDates}</Hint> : null}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-2">{t.mode}</span>
        <Segmented
          label={t.mode}
          value={timeline.mode}
          disabled={off}
          className="w-full"
          onChange={(mode) => store.setTimelineSettings({ mode })}
          options={[
            { value: "moving", label: strings.timeline.moving },
            { value: "cumulative", label: strings.timeline.cumulative },
          ]}
        />
        <Hint>{timeline.mode === "moving" ? t.movingHint : t.cumulativeHint}</Hint>
      </div>
      <Row label={t.speed}>
        <ChoiceMenu
          label={t.speed}
          placement="bottom end"
          groups={[
            {
              id: "speed",
              heading: t.speed,
              value: String(timeline.speed),
              choices: speedChoices(timeline.speed).map((speed) => ({ value: String(speed), label: speedLabel(speed, strings.timeline) })),
            },
          ]}
          onChoose={(_group, value) => store.setTimelineSettings({ speed: Number(value) })}
        >
          <Button variant="outline" size="sm" isDisabled={off} className="tabular-nums">
            {speedLabel(timeline.speed, strings.timeline)}
          </Button>
        </ChoiceMenu>
      </Row>
      {timeline.mode === "moving" ? (
        <div className="flex flex-col gap-1">
          <Row label={t.window}>
            <ChoiceMenu
              label={t.window}
              placement="bottom end"
              groups={[
                {
                  id: "window",
                  heading: t.window,
                  value: String(timeline.windowMs),
                  choices: windowChoices(span, timeline.windowMs).map((width) => ({ value: String(width), label: durationLabel(width, strings.timeline) })),
                },
              ]}
              onChoose={(_group, value) => store.setTimeWindow(Number(value))}
            >
              <Button variant="outline" size="sm" isDisabled={off} className="tabular-nums">
                {durationLabel(timeline.windowMs, strings.timeline)}
              </Button>
            </ChoiceMenu>
          </Row>
          <Hint>{t.windowHint}</Hint>
        </div>
      ) : null}
    </Section>
  );
}
