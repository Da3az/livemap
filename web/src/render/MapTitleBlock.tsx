import type { MapSettings, RichText } from "@/model/types";
import { formatAsOf, langForDir, sourceLine } from "./furniture";

/**
 * The published map's heading: title in the news serif, subtitle and the
 * "as of" stamp beneath. Hard-edged, like a printed panel.
 */
export function MapTitleBlock({ title, settings, dir }: { title: RichText; settings: MapSettings; dir: "ltr" | "rtl" }) {
  const block = settings.titleBlock;
  if (!block.show) return null;
  return (
    <header dir={dir} className="max-w-md rounded-key border border-rule-strong bg-panel px-3 py-2.5 text-ink">
      <h1 dir={title.dir} className="text-start font-title text-xl font-semibold">
        {title.value}
      </h1>
      {block.subtitle && (
        <p dir={block.subtitle.dir} className="mt-0.5 text-start font-ui text-sm text-ink-2">
          {block.subtitle.value}
        </p>
      )}
      {block.asOf && (
        <p className="mt-0.5 font-ui text-xs font-medium text-ink-2 tabular-nums">
          <time dateTime={block.asOf}>{formatAsOf(block.asOf, langForDir(dir))}</time>
        </p>
      )}
    </header>
  );
}

/** Source, credit and the "approximate" note: the small print that sits at the foot of the map. */
export function MapCredits({ settings, dir }: { settings: MapSettings; dir: "ltr" | "rtl" }) {
  const block = settings.titleBlock;
  if (!block.show) return null;
  const lines = [block.source ? sourceLine(block.source, langForDir(dir)) : null, block.credit, block.note].flatMap((line) => (line ? [line] : []));
  if (lines.length === 0) return null;
  return (
    <footer dir={dir} className="max-w-sm rounded-key border border-rule-strong bg-panel px-3 py-2 font-ui text-xs text-ink-2">
      {lines.map((line) => (
        <p key={line.value} dir={line.dir} className="text-start">
          {line.value}
        </p>
      ))}
    </footer>
  );
}
