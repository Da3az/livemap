import { type ReactNode, useMemo, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";
import type { ChangedFeature, DiffFeature, VersionDiff } from "@/editor/store/diff";
import { useVersionsStrings } from "@/i18n/versions";
import type { FeatureKind, MapVersion, RichText } from "@/model/types";
import { basemapTheme } from "@/render/basemap";
import { FeatureSwatch } from "@/render/FeatureSwatch";
import type { ThemeMode } from "@/render/palette";
import { usePalette } from "@/render/use-palette";
import { ChangeDetail, shapeSummary, type Looks } from "./change-detail";

const KIND_ICON: Record<FeatureKind, IconName> = { area: "area", line: "line", arrow: "arrow", frontline: "frontline", point: "point", annotation: "annotation" };

type Mark = "added" | "removed" | "changed" | "replaced";
const MARK: Record<Mark, { icon: IconName; color: string }> = {
  added: { icon: "plus", color: "text-success" },
  removed: { icon: "minus", color: "text-danger" },
  changed: { icon: "stateDraft", color: "text-warning" },
  replaced: { icon: "chevron", color: "text-plum" },
};

function Heading({ mark, children, count }: { mark?: Mark; children: ReactNode; count: number }) {
  const t = useVersionsStrings();
  return (
    <h3 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-2xs font-semibold tracking-wide text-plum uppercase">
      {mark ? <Icon name={MARK[mark].icon} size={12} className={MARK[mark].color} /> : null}
      {children}
      <span className="font-medium text-ink-3 tabular-nums">{count === 0 ? t.none : t.n(count)}</span>
    </h3>
  );
}

/** A row that shows a feature on both maps when chosen. Its body says what changed. */
function Entry({ id, name, selected, onSelect, lead, children }: { id: string; name: RichText; selected: boolean; onSelect: (id: string) => void; lead: ReactNode; children?: ReactNode }) {
  const t = useVersionsStrings();
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t.showOnMaps(name.value)}
        onClick={() => onSelect(id)}
        className={`flex min-h-row w-full items-start gap-2 rounded-block border px-2 py-1 text-start -outline-offset-2 max-md:min-h-11 ${selected ? "border-survey bg-well" : "border-transparent hover:bg-well"}`}
      >
        <span className="mt-px flex shrink-0 items-center">{lead}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-5 text-ink">
            <bdi dir={name.dir}>{name.value}</bdi>
          </span>
          {children}
        </span>
      </button>
    </li>
  );
}

/** A feature that left the map and the one that took its place on the timeline: one change, not two. */
interface Replacement {
  id: string;
  removed: DiffFeature;
  added: DiffFeature;
}

function pairReplacements(diff: VersionDiff): { replacements: Replacement[]; added: DiffFeature[]; removed: DiffFeature[] } {
  const removedByLineage = new Map<string, DiffFeature>();
  for (const entry of diff.removed) if (entry.feature.lineageId) removedByLineage.set(entry.feature.lineageId, entry);
  const replacements: Replacement[] = [];
  const paired = new Set<string>();
  for (const entry of diff.added) {
    const lineage = entry.feature.lineageId;
    const removed = lineage ? removedByLineage.get(lineage) : undefined;
    if (!removed || paired.has(removed.id)) continue;
    paired.add(removed.id);
    paired.add(entry.id);
    replacements.push({ id: entry.id, removed, added: entry });
  }
  return { replacements, added: diff.added.filter((entry) => !paired.has(entry.id)), removed: diff.removed.filter((entry) => !paired.has(entry.id)) };
}

/**
 * What differs between two versions: features added and removed (each with
 * its real look), features replaced by their next state, features changed
 * (each change shown, not named: swatches, outlines, old and new text), then
 * the settings. Choosing a feature shows it on both maps.
 */
export function DiffList({
  diff,
  from,
  to,
  fromName,
  toName,
  mode,
  selected,
  onSelect,
}: {
  diff: VersionDiff;
  from: MapVersion;
  to: MapVersion;
  fromName: string;
  toName: string;
  /** The interface theme; the swatches use the palette the newer basemap is drawn with. */
  mode: ThemeMode;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useVersionsStrings();
  const root = useRef<HTMLDivElement>(null);
  const palette = usePalette(root, basemapTheme(to.settings.basemap.styleId, mode));
  const looks: Looks = { before: from.settings, after: to.settings, palette, dir: to.uiDir };
  const { replacements, added, removed } = useMemo(() => pairReplacements(diff), [diff]);

  const swatch = (entry: DiffFeature, settings: MapVersion["settings"]) => <FeatureSwatch sample={entry.feature} settings={settings} palette={palette} dir={looks.dir} />;
  const only = (entries: DiffFeature[], settings: MapVersion["settings"]) =>
    entries.map((entry) => <Entry key={entry.id} id={entry.id} name={entry.name} selected={selected === entry.id} onSelect={onSelect} lead={swatch(entry, settings)} />);
  const changed = (entry: ChangedFeature) => (
    <Entry key={entry.id} id={entry.id} name={entry.name} selected={selected === entry.id} onSelect={onSelect} lead={<Icon name={KIND_ICON[entry.kind]} size={14} className="mt-0.5 text-ink-3" />}>
      <ChangeDetail entry={entry} looks={looks} />
    </Entry>
  );

  if (diff.identical) {
    return <p className="px-4 py-4 text-base text-ink-2">{t.identical(fromName, toName)}</p>;
  }
  return (
    <div ref={root} className="pb-3">
      {diff.counts.changed > 0 ? (
        <>
          <Heading mark="changed" count={diff.counts.changed}>
            {t.changedHeading}
          </Heading>
          <ul className="px-2">{diff.changed.map(changed)}</ul>
        </>
      ) : null}
      {replacements.length > 0 ? (
        <>
          <Heading mark="replaced" count={replacements.length}>
            {t.replacedHeading}
          </Heading>
          <ul className="px-2">
            {replacements.map((pair) => (
              <Entry key={pair.id} id={pair.id} name={pair.added.name} selected={selected === pair.id} onSelect={onSelect} lead={swatch(pair.added, to.settings)}>
                <span className="block text-xs text-ink-2">
                  <bdi dir={pair.removed.name.dir} className="text-ink-3 line-through">
                    {pair.removed.name.value}
                  </bdi>{" "}
                  · <span className="tabular-nums">{shapeSummary(pair.removed.feature, pair.added.feature)}</span>
                </span>
              </Entry>
            ))}
          </ul>
        </>
      ) : null}
      <Heading mark="added" count={added.length}>
        {t.added} <span className="font-medium normal-case">{t.inVersion(toName)}</span>
      </Heading>
      <ul className="px-2">{only(added, to.settings)}</ul>
      <Heading mark="removed" count={removed.length}>
        {t.removed} <span className="font-medium normal-case">{t.inVersion(toName)}</span>
      </Heading>
      <ul className="px-2">{only(removed, from.settings)}</ul>
      <Heading count={diff.counts.settings}>{t.settingsHeading}</Heading>
      <dl className="px-4">
        {diff.settings.map((change) => (
          <div key={change.area} className="border-b border-rule py-1.5 last:border-b-0">
            <dt className="text-sm font-medium text-ink">{change.label.en}</dt>
            {change.details.map((detail) => (
              <dd key={detail.en} dir="auto" className="text-xs text-ink-2">
                {detail.en}
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </div>
  );
}
