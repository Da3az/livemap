import { cn } from "cn";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { selectTimeHistogram, useEditorStore, type TimeBucket, type TimeExtent } from "@/editor/store";
import type { Lang } from "@/i18n";
import { buildTicks, keySteps } from "./ticks";

/** Bars of how many features exist over time; a darker cap marks a bucket in which something begins. */
const Histogram = memo(function Histogram({ buckets }: { buckets: readonly TimeBucket[] }) {
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.active));
  return (
    <svg
      viewBox={`0 0 ${Math.max(1, buckets.length)} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="absolute inset-0 size-full rtl:-scale-x-100"
    >
      {buckets.map((bucket, index) => {
        if (bucket.active === 0) return null;
        const height = Math.max(6, (bucket.active / peak) * 100);
        return (
          <g key={bucket.fromMs}>
            <rect x={index + 0.08} y={100 - height} width={0.84} height={height} className="fill-ink-3/45" />
            {bucket.starts > 0 ? <rect x={index + 0.08} y={100 - height} width={0.84} height={8} className="fill-ink-2" /> : null}
          </g>
        );
      })}
    </svg>
  );
});

function useWidth(): [(element: HTMLDivElement | null) => void, HTMLDivElement | null, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (element === null) return undefined;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, element, width];
}

/** scrub: the playhead follows the pointer; move: the window slides whole; start / end: one edge moves, the other stays. */
type Drag = { kind: "scrub" } | { kind: "move"; grab: number } | { kind: "start" } | { kind: "end"; startMs: number };

export interface TrackProps {
  extent: TimeExtent;
  /** null: no time filter. */
  playheadMs: number | null;
  windowMs: number;
  mode: "moving" | "cumulative";
  dir: "ltr" | "rtl";
  lang: Lang;
  label: string;
  valueText: string;
  startLabel: string;
  endLabel: string;
  onSeek: (ms: number) => void;
  onWindow: (windowMs: number) => void;
  /** A drag of either edge of the window ended. */
  onWindowEnd: () => void;
  onGrab: () => void;
  onTogglePlay: () => void;
  onStepEvent: (direction: 1 | -1) => void;
}

/**
 * The timeline's track: histogram, date ticks, the window and the playhead.
 * A slider to assistive technology. Time runs from the inline start, so it
 * reads right to left in a right-to-left editor.
 */
export function TimelineTrack(props: TrackProps) {
  const { extent, playheadMs, windowMs, mode, dir, lang } = props;
  const [setRoot, root, width] = useWidth();
  const drag = useRef<Drag | null>(null);
  const span = Math.max(1, extent.toMs - extent.fromMs);

  const bucketCount = Math.max(16, Math.min(120, Math.round(width / 7)));
  const buckets = useEditorStore((state) => selectTimeHistogram(state, bucketCount));
  const ticks = useMemo(() => buildTicks(extent.fromMs, extent.toMs, width, lang), [extent.fromMs, extent.toMs, width, lang]);

  const fraction = (ms: number): number => Math.max(0, Math.min(1, (ms - extent.fromMs) / span));
  const clamp = (ms: number): number => Math.max(extent.fromMs, Math.min(extent.toMs, ms));

  const timeAt = (clientX: number): number => {
    if (root === null) return extent.fromMs;
    const rect = root.getBoundingClientRect();
    const along = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
    return extent.fromMs + (dir === "rtl" ? 1 - along : along) * span;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const at = timeAt(event.clientX);
    const part = event.target instanceof Element ? event.target.closest("[data-part]")?.getAttribute("data-part") : null;
    if (part === "start" && playheadMs !== null) {
      drag.current = { kind: "start" };
    } else if (part === "end" && playheadMs !== null && mode === "moving") {
      drag.current = { kind: "end", startMs: playheadMs - windowMs };
    } else if (mode === "moving" && playheadMs !== null && at >= playheadMs - windowMs && at <= playheadMs) {
      drag.current = { kind: "move", grab: playheadMs - at };
    } else {
      drag.current = { kind: "scrub" };
      props.onSeek(clamp(at));
    }
    props.onGrab();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current === null) return;
    const at = timeAt(event.clientX);
    const least = span / 200;
    if (current.kind === "start") {
      if (playheadMs !== null) props.onWindow(Math.max(least, Math.min(span, playheadMs - at)));
    } else if (current.kind === "end") {
      const end = clamp(Math.max(at, current.startMs + least));
      props.onWindow(Math.max(least, end - current.startMs));
      props.onSeek(end);
    } else if (current.kind === "move") {
      props.onSeek(clamp(at + current.grab));
    } else {
      props.onSeek(clamp(at));
    }
  };

  const endDrag = (): void => {
    const kind = drag.current?.kind;
    drag.current = null;
    if (kind === "start" || kind === "end") props.onWindowEnd();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const steps = keySteps(span);
    const by = event.shiftKey ? steps.coarse : steps.fine;
    const from = (sign: 1 | -1): number => playheadMs ?? (sign === 1 ? extent.fromMs : extent.toMs);
    const visual = dir === "rtl" ? -1 : 1;
    let handled = true;
    switch (event.key) {
      case "ArrowRight":
        props.onSeek(clamp(from(visual === 1 ? 1 : -1) + by * visual));
        break;
      case "ArrowLeft":
        props.onSeek(clamp(from(visual === 1 ? -1 : 1) - by * visual));
        break;
      case "ArrowUp":
        props.onSeek(clamp(from(1) + by));
        break;
      case "ArrowDown":
        props.onSeek(clamp(from(-1) - by));
        break;
      case "Home":
        props.onSeek(extent.fromMs);
        break;
      case "End":
        props.onSeek(extent.toMs);
        break;
      case "PageUp":
        props.onStepEvent(1);
        break;
      case "PageDown":
        props.onStepEvent(-1);
        break;
      case " ":
        props.onTogglePlay();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const end = playheadMs === null ? null : fraction(playheadMs);
  const start = playheadMs === null ? null : mode === "cumulative" ? 0 : fraction(playheadMs - windowMs);

  const moving = mode === "moving";
  /* A grip wide enough to take a pointer, centred on its edge; the line inside it is what shows. */
  const grip = "absolute -inset-y-0.5 z-10 flex w-3 -translate-x-1/2 cursor-ew-resize justify-center rtl:translate-x-1/2";

  return (
    <div
      ref={setRoot}
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-orientation="horizontal"
      aria-valuemin={extent.fromMs}
      aria-valuemax={extent.toMs}
      aria-valuenow={playheadMs ?? extent.toMs}
      aria-valuetext={props.valueText}
      data-timeline-track
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="relative h-11 min-w-0 flex-1 cursor-pointer touch-none rounded-key outline-offset-2 outline-focus select-none focus-visible:outline-2"
    >
      <div className="absolute inset-x-0 top-0.5 h-7 border-b border-ink-3">
        {ticks.map((tick) => (
          <span
            key={tick.ms}
            aria-hidden="true"
            style={{ insetInlineStart: `${fraction(tick.ms) * 100}%` }}
            className={cn("absolute inset-y-0 w-px", tick.major ? "bg-rule-strong" : "bg-rule")}
          />
        ))}
        <Histogram buckets={buckets} />
        {start !== null && end !== null ? (
          <div
            data-part="window"
            aria-hidden="true"
            style={{ insetInlineStart: `${start * 100}%`, width: `${Math.max(0, end - start) * 100}%` }}
            className={cn("absolute inset-y-0 border-y border-plum/40 bg-plum/15", moving && "cursor-grab")}
          />
        ) : null}
        {start !== null && moving ? (
          <span data-part="start" aria-hidden="true" title={props.startLabel} style={{ insetInlineStart: `${start * 100}%` }} className={grip}>
            <span className="h-full w-0.5 rounded-pill bg-plum/70" />
          </span>
        ) : null}
        {end !== null ? (
          <span
            data-part="end"
            aria-hidden="true"
            title={moving ? props.endLabel : undefined}
            style={{ insetInlineStart: `${end * 100}%` }}
            className={cn(grip, !moving && "cursor-pointer")}
          >
            <span className="relative h-full w-0.5 bg-plum before:absolute before:-top-px before:start-1/2 before:h-1.5 before:w-2.5 before:-translate-x-1/2 before:rounded-key before:bg-plum rtl:before:translate-x-1/2" />
          </span>
        ) : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-3">
        {ticks.map((tick) => {
          const at = fraction(tick.ms);
          return (
            <span
              key={tick.ms}
              aria-hidden="true"
              style={{ insetInlineStart: `${at * 100}%` }}
              className={cn(
                "absolute top-0 text-2xs leading-none whitespace-nowrap tabular-nums",
                tick.major ? "font-semibold text-ink-2" : "text-ink-3",
                at < 0.04 ? "" : at > 0.96 ? "-translate-x-full rtl:translate-x-full" : "-translate-x-1/2 rtl:translate-x-1/2",
              )}
            >
              {tick.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
