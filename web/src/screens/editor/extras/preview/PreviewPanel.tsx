import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, useTheme } from "@/app/providers";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/notice";
import { StateBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { selectDraftStatus, shallowEqual, useEditorStore, useEditorStoreApi, useRetryCountdown, type PublishState } from "@/editor/store";
import { useExtrasStrings, type ExtrasStrings } from "@/i18n/editor-extras";
import { MapViewer } from "@/screens/embed/viewer";
import { Segmented } from "../shared/controls";
import { draftArtifact } from "./build-version";

type Device = "phone" | "tablet" | "desktop" | "custom";
const DEVICES: Record<Exclude<Device, "custom">, { width: number; height: number }> = {
  phone: { width: 390, height: 640 },
  tablet: { width: 834, height: 640 },
  desktop: { width: 1200, height: 720 },
};
const MIN_WIDTH = 280;
const MAX_WIDTH = 2400;
const NAMES_SHOWN = 6;

function customWidth(text: string): number | null {
  const value = Math.round(Number(text));
  return Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH ? value : null;
}

/** What the last attempt to publish came to, said in place. */
function PublishOutcome({ state, t }: { state: PublishState; t: ExtrasStrings["preview"] }) {
  const seconds = useRetryCountdown(state.kind === "rate_limited" ? state.retryAt : null);
  switch (state.kind) {
    case "idle":
    case "publishing":
      return null;
    case "published":
      return (
        <Notice tone="success" title={t.published(state.version)}>
          {t.publishedHelp}
        </Notice>
      );
    case "unchanged":
      return (
        <Notice tone="info" title={t.unchanged}>
          {t.unchangedHelp(state.version)}
        </Notice>
      );
    case "save_failed":
      return <Notice tone="danger" title={t.saveFailed}>{t.saveFailedHelp}</Notice>;
    case "quota_exceeded":
      return <Notice tone="danger" title={t.quota}>{state.reason}</Notice>;
    case "rate_limited":
      return <Notice tone="warning" title={t.rateLimited}>{seconds > 0 ? t.retryIn(seconds) : t.retryNow}</Notice>;
    case "not_permitted":
      return <Notice tone="danger" title={t.notPermitted}>{state.reason}</Notice>;
    case "signed_out":
      return <Notice tone="danger" title={t.signedOut} />;
    case "offline":
      return <Notice tone="danger" title={t.offline}>{t.offlineHelp}</Notice>;
    case "unknown":
      return <Notice tone="danger" title={t.failed}>{state.message}</Notice>;
  }
}

/** What would go out, plainly, and the button that sends it. */
function PublishSummary({ count, leftOut }: { count: number; leftOut: { id: string; name: string; dir: "ltr" | "rtl" | "auto" }[] }) {
  const store = useEditorStoreApi();
  const api = useApi();
  const t = useExtrasStrings().preview;
  const draft = useEditorStore(selectDraftStatus);
  const publish = useEditorStore((state) => state.publish);
  const access = useEditorStore((state) => state.access);
  const next = (draft.liveVersion ?? 0) + 1;
  const publishing = publish.kind === "publishing";
  const blocked = access.readOnly !== null ? t.readOnly : access.canPublish ? null : t.cannotPublish;

  return (
    <aside aria-label={t.summary} className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-rule bg-panel p-3 @3xl:w-72 @3xl:border-s @3xl:border-t-0">
      <h3 className="text-xs font-semibold text-plum">{t.summary}</h3>
      {draft.state === "never_published" ? (
        <StateBadge state="draft">{t.never}</StateBadge>
      ) : draft.state === "live" ? (
        <StateBadge state="live">
          <span className="tabular-nums">{t.live(draft.liveVersion ?? 0)}</span>
        </StateBadge>
      ) : (
        <StateBadge state="draft">
          <span className="tabular-nums">{t.ahead(draft.liveVersion ?? 0)}</span>
        </StateBadge>
      )}
      <div className="flex flex-col gap-1 text-sm">
        <p data-preview-count>
          <span className="font-semibold tabular-nums">{t.features(count)}</span>
          <span className="text-ink-2"> {draft.state === "live" ? t.isLive(draft.liveVersion ?? 0) : t.wouldPublish(next)}</span>
        </p>
        {leftOut.length === 0 ? (
          <p className="text-xs text-ink-3">{t.nothingHidden}</p>
        ) : (
          <div data-preview-left-out className="flex flex-col gap-1 rounded-block bg-well p-2">
            <p className="text-xs font-semibold tabular-nums">{t.leftOut(leftOut.length)}</p>
            <ul className="flex flex-col text-xs text-ink-2">
              {leftOut.slice(0, NAMES_SHOWN).map((feature) => (
                <li key={feature.id} dir={feature.dir} className="truncate text-start">
                  {feature.name}
                </li>
              ))}
            </ul>
            {leftOut.length > NAMES_SHOWN ? <p className="text-xs text-ink-3 tabular-nums">{t.andMore(leftOut.length - NAMES_SHOWN)}</p> : null}
          </div>
        )}
        {draft.unsaved ? <p className="text-xs text-ink-2">{t.savesFirst}</p> : null}
      </div>
      <PublishOutcome state={publish} t={t} />
      <div className="flex flex-col gap-1">
        <Button size="lg" isDisabled={publishing || blocked !== null} onPress={() => void store.publish(api)} className="rounded-pill font-semibold" data-preview-publish>
          {publishing ? t.publishing : draft.state === "draft_ahead" ? t.publishChanges : t.publish}
        </Button>
        {blocked !== null ? <p className="text-xs text-ink-2">{blocked}</p> : null}
      </div>
    </aside>
  );
}

/**
 * What a reader will see, before publishing: the draft built into the
 * artifact the publish pipeline would make, shown by the reader's own viewer
 * at a phone, tablet, desktop or chosen width. One map at a time.
 */
export function PreviewPanel({ onClose }: { onClose: () => void }) {
  const strings = useExtrasStrings();
  const t = strings.preview;
  const { mode } = useTheme();
  const narrow = window.matchMedia("(max-width: 39.99rem)").matches;
  const [device, setDevice] = useState<Device>(narrow ? "phone" : "desktop");
  const [custom, setCustom] = useState("600");
  const state = useEditorStore(
    (current) => ({ doc: current.doc, meta: current.meta, windowMs: current.doc.settings.timeline.windowMs, playhead: current.timeline.playhead }),
    shallowEqual,
  );
  const embedTheme = state.doc.settings.embed.theme;
  const [theme, setTheme] = useState<"light" | "dark">(embedTheme === "auto" ? mode : embedTheme);

  /* Rebuilt only when the document changes; the time stamp is the moment the preview opened. */
  const [openedAt] = useState(() => new Date().toISOString());
  const artifact = useMemo(() => draftArtifact(state.doc, state.meta, openedAt), [state.doc, state.meta, openedAt]);

  /* The frame is shown at its true size; when the window is narrower than the device, the stage scrolls. */
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY);
  /*
   * The reader's map is a second WebGL context. It is made only once the
   * stage has been laid out with real room, so opening the preview paints
   * the frame first, and it goes with the panel when the preview closes.
   */
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (stage === null) return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      setRoom(stage.clientWidth);
      if (stage.clientWidth > 0 && stage.clientHeight > 0) {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => setShown(true));
      }
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [stage]);

  /* Focus moves into the preview and, when it closes, back to whatever opened it. */
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    heading.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const typed = customWidth(custom);
  const size = device === "custom" ? { width: typed ?? 600, height: 640 } : DEVICES[device];
  const leftOut = artifact.leftOut.map((feature) => ({ id: feature.id, name: feature.name.value, dir: feature.name.dir }));

  return (
    <section
      aria-label={t.title}
      data-preview-panel
      className="@container relative flex size-full flex-col bg-page text-ink"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule bg-panel px-3 py-1.5">
        <h2 ref={heading} tabIndex={-1} className="font-title text-lg font-semibold outline-none">
          {t.title}
        </h2>
        <Segmented
          label={t.device}
          value={device}
          onChange={setDevice}
          options={[
            { value: "phone", label: t.devices.phone },
            { value: "tablet", label: t.devices.tablet },
            { value: "desktop", label: t.devices.desktop },
            { value: "custom", label: t.devices.custom },
          ]}
        />
        {device === "custom" ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            {t.width}
            <input
              type="number"
              inputMode="numeric"
              min={MIN_WIDTH}
              max={MAX_WIDTH}
              value={custom}
              aria-invalid={typed === null}
              onChange={(event) => setCustom(event.target.value)}
              className="h-field w-20 rounded-field border border-rule-strong bg-panel px-1.5 text-end text-sm text-ink tabular-nums aria-invalid:border-danger"
            />
            {t.px}
          </label>
        ) : null}
        <Segmented
          label={t.theme}
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: t.light },
            { value: "dark", label: t.dark },
          ]}
        />
        <Button variant="outline" onPress={onClose} className="ms-auto" data-preview-close>
          <Icon name="close" size={12} />
          {t.close}
        </Button>
      </header>
      {/* Narrow, the frame and the summary stack and the whole panel scrolls; wide, they sit side by side and the stage scrolls alone. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @3xl:flex-row @3xl:overflow-hidden">
        <div ref={setStage} className="flex min-w-0 shrink-0 flex-col gap-1.5 overflow-x-auto p-3 @3xl:min-h-0 @3xl:flex-1 @3xl:overflow-auto">
          <p className="shrink-0 text-xs text-ink-3 tabular-nums">
            {t.frame(size.width)}
            {embedTheme === "auto" ? ` · ${t.themeAuto}` : theme !== embedTheme ? ` · ${t.themeDiffers(strings.settings.embed.themes[embedTheme])}` : ""}
            {size.width + 24 > room ? ` · ${t.scrolls}` : ""}
          </p>
          <div
            data-preview-frame
            style={{ width: size.width, height: size.height }}
            className="mx-auto min-h-80 shrink-0 @3xl:max-h-full overflow-hidden rounded-key border border-rule-strong bg-panel shadow-overlay"
          >
            {shown ? (
              <MapViewer
                key={`${device}:${size.width}`}
                version={artifact.version}
                theme={theme}
                timeWindowMs={state.windowMs}
                initialTime={state.playhead ?? undefined}
                className="size-full"
              />
            ) : null}
          </div>
        </div>
        <PublishSummary count={artifact.version.features.length} leftOut={leftOut} />
      </div>
    </section>
  );
}
