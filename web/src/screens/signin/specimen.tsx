import { useConfig, usePublished } from "@/api/hooks";
import { useTheme } from "@/app/providers";
import { StateBadge } from "@/components/state-badge";
import { formatAbsolute } from "@/components/time";
import { useShellStrings } from "@/i18n/shell";
import type { RichText } from "@/model/types";
import { BasemapAttribution, MapViewer } from "@/screens/embed/viewer";

function Caption({ text, className }: { text: RichText; className?: string }) {
  return (
    <span dir={text.dir} className={className}>
      {text.value}
    </span>
  );
}

/** A live published map under the forms: what the product makes, before signing in. */
export function PublishedSpecimen() {
  const specimen = useConfig().data?.specimen ?? null;
  /* The server names the map to show (SPECIMEN_MAP); without one the page has no picture. */
  return specimen ? <Specimen tenantSlug={specimen.tenantSlug} mapSlug={specimen.mapSlug} /> : <div aria-hidden="true" className="mt-10 border-t border-rule-strong" />;
}

function Specimen({ tenantSlug, mapSlug }: { tenantSlug: string; mapSlug: string }) {
  const t = useShellStrings();
  const { mode } = useTheme();
  const published = usePublished(tenantSlug, mapSlug);

  /* Waiting holds the picture's place quietly; a failure or an unpublished map leaves only the rule. */
  if (published.isPending) return <div aria-hidden="true" className="mt-10 h-80 border-t border-rule-strong md:h-96 xl:h-128" />;
  if (published.isError || published.data === null) return <div aria-hidden="true" className="mt-10 border-t border-rule-strong" />;

  const version = published.data;
  const block = version.settings.titleBlock;
  const lines = [block.source, block.credit].flatMap((line) => (line && line.value.trim() !== "" ? [line] : []));

  return (
    <figure aria-label={t.signin.specimenLabel(version.title.value)} className="mt-10 border-t border-rule-strong pt-5">
      <figcaption className="flex flex-col gap-1">
        <Caption text={version.title} className="font-title text-lg font-medium text-ink" />
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3 tabular-nums">
          <StateBadge state="live">{t.signin.specimenLive(version.version)}</StateBadge>
          {block.asOf ? <span>{t.signin.specimenAsOf(formatAbsolute(block.asOf, "en"))}</span> : null}
        </span>
      </figcaption>
      <MapViewer
        version={version}
        static
        furniture="map"
        theme={mode}
        zoomButtons={false}
        panButtons={false}
        className="mt-3 h-80 rounded-key border border-rule md:h-96 xl:h-128"
      />
      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-2xs text-ink-3">
        {lines.map((line) => (
          <Caption key={line.value} text={line} />
        ))}
        <BasemapAttribution className="ms-auto" />
      </p>
    </figure>
  );
}
