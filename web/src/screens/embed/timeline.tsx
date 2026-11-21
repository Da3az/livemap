import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { isValidInWindow } from "@/editor/store/time";
import { LOCALE, useLang } from "@/i18n";
import { useEmbedStrings } from "@/i18n/embed";
import type { MapFeature } from "@/model/types";
import type { Playback } from "./use-playback";

const SLIDER_STEPS = 240;
const HOUR = 3_600_000;
const ANNOUNCE_EVERY_MS = 4_000;

const PILL =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-pill border border-rule-strong bg-panel ps-3 pe-4 text-sm font-semibold text-ink select-none hover:bg-well active:bg-rule disabled:opacity-50";

/** What a screen reader hears: said at once when the reader moves the playhead, and every few seconds during playback. */
function useAnnouncement(text: string, playing: boolean): string {
  const [announced, setAnnounced] = useState("");
  const lastAt = useRef(0);
  useEffect(() => {
    const wait = playing ? ANNOUNCE_EVERY_MS - (performance.now() - lastAt.current) : 400;
    const id = window.setTimeout(
      () => {
        lastAt.current = performance.now();
        setAnnounced(text);
      },
      Math.max(0, wait),
    );
    return () => window.clearTimeout(id);
  }, [text, playing]);
  return announced;
}

/**
 * The reader's timeline: play or step, a scrubber over the map's whole span
 * with a histogram of when things begin, and the moment being shown, exactly.
 * Time runs with the reading direction, so right to left on an Arabic map.
 */
export function ReaderTimeline({ playback, features, dir }: { playback: Playback; features: readonly MapFeature[]; dir: "ltr" | "rtl" }) {
  const t = useEmbedStrings();
  const lang = useLang();
  const track = useRef<HTMLDivElement>(null);
  const { extent, buckets, playheadMs, playing, mode, windowMs } = playback;
  const span = extent.toMs - extent.fromMs;
  const fraction = (playheadMs - extent.fromMs) / span;
  const windowFrom = mode === "moving" ? Math.max(extent.fromMs, playheadMs - windowMs) : extent.fromMs;
  const windowFraction = (windowFrom - extent.fromMs) / span;

  const formats = useMemo(() => {
    const exact = new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
    const tick = new Intl.DateTimeFormat(LOCALE[lang], span < 48 * HOUR ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" });
    return { exact, tick };
  }, [lang, span]);

  const exact = formats.exact.format(playheadMs);
  const prefix = mode === "cumulative" ? t.upTo : t.windowTo(windowMs >= HOUR ? Math.round(windowMs / HOUR) : windowMs / HOUR);
  const shown = useMemo(
    () => features.filter((feature) => isValidInWindow(feature, playback.window)).length,
    /* Recounted when the text a listener would hear changes, not on every frame. */
    [features, exact],
  );
  const announced = useAnnouncement(t.showing(`${prefix} ${exact}`, shown), playing);

  const tallest = Math.max(1, ...buckets.map((bucket) => bucket.starts));

  const seekTo = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const along = (event.clientX - box.left) / box.width;
    const forward = Math.max(0, Math.min(1, dir === "rtl" ? 1 - along : along));
    playback.seek(extent.fromMs + forward * span);
  };

  return (
    <section aria-label={t.timeline} className="shrink-0 border-t border-rule bg-panel px-3 pt-2 pb-1.5 font-ui @md:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {playback.reducedMotion ? (
          <div className="flex shrink-0 gap-1.5">
            <button type="button" className={`${PILL} ps-2.5`} disabled={playheadMs <= extent.fromMs} onClick={() => playback.step(-1)}>
              <Icon name="chevron" size={14} className="rotate-180 rtl:rotate-0" />
              {t.earlier}
            </button>
            <button type="button" className={`${PILL} flex-row-reverse ps-4 pe-2.5`} disabled={playback.atEnd} onClick={() => playback.step(1)}>
              <Icon name="chevron" size={14} className="rtl:rotate-180" />
              {t.later}
            </button>
          </div>
        ) : (
          <button type="button" className={PILL} onClick={playback.toggle}>
            <Icon name={playing ? "pause" : "play"} size={14} />
            {playing ? t.pause : playback.atEnd ? t.replay : t.play}
          </button>
        )}

        <p className="ms-auto min-w-0 flex-1 basis-0 text-end text-sm leading-tight text-ink tabular-nums @md:order-last @md:ms-0 @md:flex-none @md:basis-auto">
          <span className="block text-2xs text-ink-3">{prefix}</span>
          <time dateTime={new Date(playheadMs).toISOString()} className="font-semibold">
            {exact}
          </time>
        </p>

        <div
          ref={track}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekTo(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) seekTo(event);
          }}
          className="relative order-last h-12 min-w-0 basis-full cursor-pointer touch-pan-y rounded-key select-none has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus @md:order-none @md:flex-1 @md:basis-0"
        >
          {mode === "moving" ? (
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-4 bg-plum/15"
              style={{ insetInlineStart: `${windowFraction * 100}%`, inlineSize: `${(fraction - windowFraction) * 100}%` }}
            />
          ) : null}
          <div aria-hidden="true" className="absolute inset-x-0 top-1 bottom-4 flex items-end gap-px">
            {buckets.map((bucket) => {
              const inWindow = bucket.fromMs < playheadMs && bucket.toMs > windowFrom;
              return (
                <span
                  key={bucket.fromMs}
                  className={`min-w-0 flex-1 ${inWindow ? "bg-plum" : "bg-rule-strong"}`}
                  style={{ blockSize: bucket.starts === 0 ? 0 : `${Math.max(8, (bucket.starts / tallest) * 100)}%` }}
                />
              );
            })}
          </div>
          <span aria-hidden="true" className="absolute inset-x-0 bottom-4 h-px bg-rule-strong" />
          <span aria-hidden="true" className="absolute top-0 bottom-2 w-0" style={{ insetInlineStart: `${fraction * 100}%` }}>
            <span className="absolute inset-y-0 start-0 w-0.5 -translate-x-1/2 bg-plum rtl:translate-x-1/2" />
            <span className="absolute start-0 bottom-0 size-3.5 -translate-x-1/2 rounded-pill border-2 border-panel bg-plum rtl:translate-x-1/2" />
          </span>
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex justify-between text-2xs leading-none text-ink-3 tabular-nums">
            <span>{formats.tick.format(extent.fromMs)}</span>
            <span>{formats.tick.format(extent.toMs)}</span>
          </div>
          <input
            type="range"
            dir={dir}
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={Math.round(fraction * SLIDER_STEPS)}
            aria-label={t.time}
            aria-valuetext={`${prefix} ${exact}`}
            onChange={(event) => playback.seek(extent.fromMs + (Number(event.target.value) / SLIDER_STEPS) * span)}
            className="pointer-events-none absolute inset-0 size-full opacity-0"
          />
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {announced}
      </p>
    </section>
  );
}
