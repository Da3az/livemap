import { cn } from "cn";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  selectTimeExtent,
  selectVisibleAtPlayhead,
  toIso,
  useEditorStore,
  useEditorStoreApi,
  useTimelinePlayback,
  type TimeExtent,
} from "@/editor/store";
import { useLang } from "@/i18n";
import { useExtrasStrings } from "@/i18n/editor-extras";
import { useEditorLayout } from "../../shared/layout";
import { Tip } from "../../shared/tip";
import { useEditorUi } from "../../shared/ui";
import { requestSettingsSection } from "../shared/bus";
import { IconButton } from "../shared/controls";
import { formatMoment, zoneName } from "../shared/format";
import { ChoiceMenu, type MenuChoiceGroup } from "../shared/overlay";
import { durationLabel, speedChoices, speedLabel as speedText } from "./durations";
import { windowChoices } from "./ticks";
import { TimelineTrack } from "./track";

const COLLAPSED_KEY = "livemap.timeline.collapsed";
/** Below this the step buttons and "All time" give their room to the track, and the readout drops its zone. */
const TIGHT_BELOW = 720;
/** Below this the reader indicator keeps its shape and loses its words, which stay in its label and tooltip. */
const ROOMY_FROM = 900;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** The exact time at the playhead and how much of the map it leaves showing. Quieter than the track it describes. */
function Readout({ compact, narrow = false }: { compact: boolean; narrow?: boolean }) {
  const t = useExtrasStrings().timeline;
  const lang = useLang();
  const playhead = useEditorStore((state) => state.timeline.playhead);
  const visible = useEditorStore(selectVisibleAtPlayhead);
  const total = visible.count + visible.outsideTime;
  const ms = playhead === null ? null : Date.parse(playhead);
  const shown = ms === null ? t.allShown(total) : t.shown(visible.count, total);
  const moment = ms === null ? t.allTime : formatMoment(ms, lang);
  if (compact) {
    return (
      <p data-timeline-readout className="min-w-0 truncate text-xs text-ink-2 tabular-nums">
        <span className="font-medium text-ink">{moment}</span>
        <span className="text-ink-3"> · {shown}</span>
      </p>
    );
  }
  return (
    <p
      data-timeline-readout
      aria-live="off"
      className={cn("flex shrink-0 flex-col text-end leading-tight tabular-nums", narrow ? "w-28" : "w-36")}
    >
      <span className="truncate text-xs font-medium text-ink">{moment}</span>
      <span className="truncate text-2xs text-ink-3">{ms === null || narrow ? shown : `${zoneName(ms, lang)} · ${shown}`}</span>
    </p>
  );
}

type ReaderState = "on" | "off" | "static" | "flat";

/**
 * Whether readers of the published map get a timeline, exactly as the embed
 * decides it: switched on, not a still picture, and more than one moment.
 * Pressing it opens Map settings at the switch.
 */
function ReadersIndicator({ extent, iconOnly }: { extent: TimeExtent; iconOnly: boolean }) {
  const t = useExtrasStrings().timeline.readers;
  const store = useEditorStoreApi();
  const ui = useEditorUi();
  const { mode } = useEditorLayout();
  const enabled = useEditorStore((state) => state.doc.settings.timeline.enabled);
  const still = useEditorStore((state) => state.doc.settings.embed.static);
  const state: ReaderState = !enabled ? "off" : still ? "static" : extent.toMs <= extent.fromMs ? "flat" : "on";
  const on = state === "on";
  const tip = { on: t.onTip, off: t.offTip, static: t.staticTip, flat: t.flatTip }[state];

  const open = (): void => {
    store.clearSelection();
    if (mode === "tablet") ui.setOverlayPane("inspector");
    else ui.setSettingsOpen(true);
    requestSettingsSection("timeline");
  };

  return (
    <Tip label={tip}>
      <Button
        variant="ghost"
        size="sm"
        onPress={open}
        aria-label={`${on ? t.on : t.off}. ${tip}`}
        data-timeline-readers={state}
        className="shrink-0 gap-1.5 px-1.5 text-2xs font-medium text-ink-2"
      >
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-pill border", on ? "border-survey bg-survey" : "border-ink-3 bg-transparent")}
        />
        {iconOnly ? null : <span className="whitespace-nowrap">{on ? t.on : t.off}</span>}
      </Button>
    </Tip>
  );
}

function Scrubber({ extent }: { extent: TimeExtent }) {
  const store = useEditorStoreApi();
  const t = useExtrasStrings().timeline;
  const lang = useLang();
  const dir = useEditorStore((state) => state.doc.uiDir);
  const playhead = useEditorStore((state) => state.timeline.playhead);
  const windowMs = useEditorStore((state) => state.doc.settings.timeline.windowMs);
  const mode = useEditorStore((state) => state.doc.settings.timeline.mode);
  const playheadMs = playhead === null ? null : Date.parse(playhead);
  return (
    <TimelineTrack
      extent={extent}
      playheadMs={playheadMs}
      windowMs={windowMs}
      mode={mode}
      dir={dir}
      lang={lang}
      label={t.position}
      valueText={playheadMs === null ? t.allTime : formatMoment(playheadMs, lang)}
      startLabel={t.windowStart}
      endLabel={t.windowEnd}
      onSeek={(ms) => store.setPlayhead(toIso(ms))}
      onWindow={(width) => store.setTimeWindow(width)}
      onWindowEnd={() => store.closeStep()}
      onGrab={() => store.pause()}
      onTogglePlay={() => store.togglePlay()}
      onStepEvent={(direction) => store.stepPlayhead(direction)}
    />
  );
}

/**
 * The timeline bar under the tool dock. It always works for the author:
 * scrubbing and playback move the store's playhead, which filters the map
 * whatever readers get. Whether readers get a timeline is a Map settings
 * choice; the bar only reports it. Mode and speed are the map's own
 * timeline settings, so they are what readers get too.
 */
export function Timeline() {
  useTimelinePlayback();
  const store = useEditorStoreApi();
  const t = useExtrasStrings().timeline;
  const extent = useEditorStore(selectTimeExtent);
  const settings = useEditorStore((state) => state.doc.settings.timeline);
  const playing = useEditorStore((state) => state.timeline.playing);
  const filtering = useEditorStore((state) => state.timeline.playhead !== null);
  const windowMs = useEditorStore((state) => state.doc.settings.timeline.windowMs);
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(TIGHT_BELOW);
  const tight = width < TIGHT_BELOW;
  const roomy = width >= ROOMY_FROM;

  useEffect(() => {
    if (root === null) return undefined;
    const observer = new ResizeObserver(() => setWidth(root.clientWidth));
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);

  const setCollapsed = (next: boolean): void => {
    setCollapsedState(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* not persisted; it still applies for this visit */
    }
  };

  const usable = extent !== null;
  const canPlay = usable && extent.toMs > extent.fromMs;
  const span = extent === null ? 0 : extent.toMs - extent.fromMs;
  const locked = readOnly ? t.readOnly : undefined;

  const menu: MenuChoiceGroup<string>[] = [
    {
      id: "mode",
      heading: t.mode,
      value: settings.mode,
      choices: [
        { value: "moving", label: t.moving, disabledReason: locked },
        { value: "cumulative", label: t.cumulative, disabledReason: locked },
      ],
    },
  ];
  if (settings.mode === "moving" && span > 0) {
    menu.push({
      id: "window",
      heading: t.windowWidth,
      value: String(windowMs),
      choices: windowChoices(span, windowMs).map((choice) => ({ value: String(choice), label: durationLabel(choice, t), disabledReason: locked })),
    });
  }
  menu.push({
    id: "speed",
    heading: t.speed,
    value: String(settings.speed),
    choices: speedChoices(settings.speed).map((speed) => ({ value: String(speed), label: speedText(speed, t), disabledReason: locked })),
  });
  menu.push({
    id: "action",
    heading: t.stamp,
    value: null,
    choices: [{ value: "asOf", label: t.setAsOf, disabledReason: locked ?? (filtering ? undefined : t.needsPlayhead) }],
  });
  if (tight) menu.push({ id: "filter", heading: t.filter, value: filtering ? null : "off", choices: [{ value: "off", label: t.allTime }] });

  const onChoose = (groupId: string, value: string): void => {
    if (groupId === "mode" && (value === "moving" || value === "cumulative")) store.setTimelineSettings({ mode: value });
    else if (groupId === "speed") store.setTimelineSettings({ speed: Number(value) });
    else if (groupId === "window") store.setTimeWindow(Number(value));
    else if (groupId === "filter") store.setPlayhead(filtering ? null : (extent?.to ?? null));
    else if (groupId === "action") {
      const playhead = store.getState().timeline.playhead;
      if (playhead !== null) store.setAsOf(playhead);
    }
  };

  const playButton = (
    <Button
      variant={playing ? "default" : "outline"}
      size="sm"
      isDisabled={!canPlay}
      onPress={() => store.togglePlay()}
      className="shrink-0 rounded-pill"
      data-timeline-play
    >
      <Icon name={playing ? "pause" : "play"} size={12} className={playing ? undefined : "rtl:-scale-x-100"} />
      {playing ? t.pause : t.play}
    </Button>
  );

  if (collapsed) {
    return (
      <section ref={setRoot} aria-label={t.label} className="flex h-row w-fit max-w-full items-center gap-2 rounded-pill border border-rule-strong bg-panel ps-3 pe-1">
        <span className="text-xs font-semibold text-plum">{t.label}</span>
        {usable ? <Readout compact /> : <p className="truncate text-xs text-ink-3">{t.noDatesShort}</p>}
        {usable ? playButton : null}
        <IconButton icon="chevron" label={t.expand} onPress={() => setCollapsed(false)} iconClassName="-rotate-90" />
      </section>
    );
  }

  return (
    <section
      ref={setRoot}
      aria-label={t.label}
      className="flex h-14 w-full items-center gap-2 rounded-pill border border-rule-strong bg-panel ps-2.5 pe-1.5"
    >
      {playButton}
      {tight ? null : (
        <div className="flex shrink-0">
          <IconButton icon="stepNext" label={t.previousChange} disabled={!usable} onPress={() => store.stepPlayhead(-1)} iconClassName="-scale-x-100 rtl:scale-x-100" />
          <IconButton icon="stepNext" label={t.nextChange} disabled={!usable} onPress={() => store.stepPlayhead(1)} iconClassName="rtl:-scale-x-100" />
        </div>
      )}

      {extent === null ? (
        <div className="flex h-10 min-w-0 flex-1 items-center border-b border-rule-strong">
          <p className="truncate text-xs text-ink-3">{t.noDates}</p>
        </div>
      ) : (
        <>
          <Scrubber extent={extent} />
          <Readout compact={false} narrow={tight} />
          {tight ? null : (
            <Button
              variant="outline"
              size="sm"
              aria-pressed={!filtering}
              onPress={() => store.setPlayhead(filtering ? null : extent.to)}
              className={cn("shrink-0", !filtering && "border-ink bg-ink text-panel hover:bg-ink hover:text-panel")}
              data-timeline-alltime
            >
              {t.allTime}
            </Button>
          )}
          <ReadersIndicator extent={extent} iconOnly={!roomy} />
          <ChoiceMenu label={t.more} groups={menu} onChoose={onChoose} placement="top end">
            <Button variant="ghost" size="icon-sm" aria-label={t.more} className="shrink-0">
              <Icon name="more" size={14} />
            </Button>
          </ChoiceMenu>
        </>
      )}
      <IconButton icon="chevron" label={t.collapse} onPress={() => setCollapsed(true)} iconClassName="rotate-90" className="shrink-0" />
    </section>
  );
}
