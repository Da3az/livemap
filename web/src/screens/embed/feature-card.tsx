import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useEmbedStrings } from "@/i18n/embed";
import type { MapFeature, MapSettings, RichText } from "@/model/types";
import type { Pt } from "@/render/geo";
import { resolveDir } from "@/render/text";

export interface CardTarget {
  feature: MapFeature;
  /** Where the reader tapped, in CSS pixels from the map's top-left corner. */
  point: Pt;
}

/**
 * The text a reader may see for a feature: its published label, or an
 * annotation's own text. Never `name`, which is the editor's working title
 * for the list and can hold an internal note.
 */
export function readerText(feature: MapFeature): RichText | null {
  const text = feature.kind === "annotation" ? feature.text : feature.label;
  return text && text.value.trim() !== "" ? text : null;
}

const GAP = 12;
const MARGIN = 8;

function when(feature: MapFeature, locale: string, words: { from: string; until: string }): string | null {
  const format = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const from = feature.validFrom ? format.format(new Date(feature.validFrom)) : null;
  const to = feature.validTo ? format.format(new Date(feature.validTo)) : null;
  if (from && to) return `${from} – ${to}`;
  if (from) return `${words.from} ${from}`;
  if (to) return `${words.until} ${to}`;
  return null;
}

/**
 * What a tapped feature is called, which key entry it belongs to and when it
 * applies. One small printed label beside the tap, never a panel: it leaves
 * with the next tap, with Escape or when the map moves.
 */
export function FeatureCard({ target, settings, locale, onClose }: { target: CardTarget; settings: MapSettings; locale: string; onClose: () => void }) {
  const t = useEmbedStrings();
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const { feature, point } = target;

  useLayoutEffect(() => {
    const card = ref.current;
    const stage = card?.offsetParent;
    if (!card || !(stage instanceof HTMLElement)) return;
    const { offsetWidth: width, offsetHeight: height } = card;
    const left = Math.max(MARGIN, Math.min(stage.clientWidth - width - MARGIN, point.x - width / 2));
    const above = point.y - GAP - height;
    const top = above >= MARGIN ? above : Math.min(stage.clientHeight - height - MARGIN, point.y + GAP);
    setPlace({ left, top });
  }, [point.x, point.y, feature.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const text = readerText(feature) ?? { value: "", dir: "ltr" as const };
  const preset = feature.presetId === null ? undefined : settings.presets.find((candidate) => candidate.id === feature.presetId);
  const dates = when(feature, locale, { from: t.from, until: t.until });

  return (
    <div
      ref={ref}
      role="status"
      /* Screen coordinates of a tap: physical by nature, so not a logical inset. */
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
      className="absolute z-10 flex max-w-60 items-start gap-2 rounded-key border border-ink bg-panel py-1.5 ps-2.5 pe-1 font-ui text-ink shadow-overlay"
    >
      <div className="min-w-0">
        <p dir={resolveDir(text)} className="text-start text-sm leading-snug font-semibold">
          {text.value}
        </p>
        {preset || dates ? (
          <p className="mt-0.5 text-2xs text-ink-2 tabular-nums">
            {preset ? <span dir={resolveDir(preset.name)}>{preset.name.value}</span> : null}
            {preset && dates ? " · " : null}
            {dates}
          </p>
        ) : null}
      </div>
      <button type="button" aria-label={t.close} onClick={onClose} className="grid size-6 shrink-0 place-items-center rounded-key text-ink-3 hover:bg-well hover:text-ink">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
