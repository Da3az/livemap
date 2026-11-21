import { useMemo, useRef, useState } from "react";
import { useVersion } from "@/api/hooks";
import { useTheme } from "@/app/providers";
import { Notice } from "@/components/notice";
import { formatAbsolute } from "@/components/time";
import { Button } from "@/components/ui/button";
import { diffVersions } from "@/editor/store/diff";
import { useVersionsStrings } from "@/i18n/versions";
import type { MapDoc, MapFeature, MapVersion, VersionRecord } from "@/model/types";
import { CompareMaps, type CompareMapsHandle, type CompareSide } from "./compare-maps";
import { DiffList } from "./diff-list";
import { draftArtifact, type DraftState, type Side } from "./model";

const SELECT = "h-field rounded-field border border-rule-strong bg-panel px-2 text-sm text-ink tabular-nums max-md:h-10 max-md:text-base";

function sideValue(side: Side): string {
  return side === "draft" ? "draft" : String(side);
}

function SidePicker({ id, value, versions, live, draft, onChange }: { id: string; value: Side; versions: readonly VersionRecord[]; live: number | null; draft: DraftState; onChange: (side: Side) => void }) {
  const t = useVersionsStrings();
  return (
    <select id={id} value={sideValue(value)} onChange={(event) => onChange(event.target.value === "draft" ? "draft" : Number(event.target.value))} className={SELECT}>
      {draft.kind === "ahead" ? <option value="draft">{t.draftOption(draft.rev)}</option> : null}
      {versions.map((record) => (
        <option key={record.version} value={record.version}>
          {t.versionOption(record.version, record.version === live)}
        </option>
      ))}
    </select>
  );
}

/** One side's artifact: fetched for a published version, built from the draft for "draft". */
function useSide(map: MapDoc, features: readonly MapFeature[], side: Side) {
  const fetched = useVersion(map.id, side === "draft" ? null : side);
  const draft = useMemo(() => (side === "draft" ? draftArtifact(map, features) : null), [side, map, features]);
  const current: MapVersion | null = draft ?? fetched.data ?? null;
  /*
   * While another version loads, the one shown stays: the two maps then take
   * the new content in place instead of being torn down and rebuilt, which
   * would cost two WebGL contexts and a flash per switch.
   */
  const shown = useRef<MapVersion | null>(null);
  if (current) shown.current = current;
  const failed = side !== "draft" && fetched.isError;
  return { artifact: failed ? null : (current ?? shown.current), loading: current === null && !failed, query: side === "draft" ? null : fetched };
}

/**
 * Two versions against each other: what changed, as a list in words, beside
 * the two maps. The list drives the maps: choosing an entry brings that
 * feature into view on both and outlines it.
 */
export function CompareTab({
  map,
  features,
  versions,
  live,
  draft,
  from,
  to,
  onSides,
}: {
  map: MapDoc;
  features: readonly MapFeature[];
  /** Newest first. */
  versions: readonly VersionRecord[];
  live: number | null;
  draft: DraftState;
  from: Side;
  to: Side;
  onSides: (from: Side, to: Side) => void;
}) {
  const t = useVersionsStrings();
  const { mode } = useTheme();
  const older = useSide(map, features, from);
  const newer = useSide(map, features, to);
  const [selected, setSelected] = useState<string | null>(null);
  const maps = useRef<CompareMapsHandle>(null);

  const diff = useMemo(() => (older.artifact && newer.artifact ? diffVersions(older.artifact, newer.artifact) : null), [older.artifact, newer.artifact]);

  const describe = (side: Side, artifact: MapVersion): CompareSide => {
    if (side === "draft") return { version: artifact, name: t.draftSide(map.rev), detail: t.asWouldPublish };
    const record = versions.find((candidate) => candidate.version === side);
    const detail = record ? `${formatAbsolute(record.publishedAt, "en")} · ${record.publishedBy.name}${side === live ? ` · ${t.live}` : ""}` : "";
    return { version: artifact, name: t.version(side), detail };
  };

  const select = (id: string): void => {
    if (!diff) return;
    setSelected(id);
    const entry = diff.changed.find((candidate) => candidate.id === id);
    const feature = entry?.after ?? diff.added.find((candidate) => candidate.id === id)?.feature ?? diff.removed.find((candidate) => candidate.id === id)?.feature;
    if (feature) maps.current?.show(feature);
  };

  const fromSide = older.artifact ? describe(from, older.artifact) : null;
  const toSide = newer.artifact ? describe(to, newer.artifact) : null;
  const failed = [older.query, newer.query].find((query) => query?.isError);
  const same = sideValue(from) === sideValue(to);
  const busy = older.loading || newer.loading;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-rule-strong px-4 py-2 md:px-5">
        <label htmlFor="compare-from" className="text-sm text-ink-2">
          {t.compareFrom}
        </label>
        <SidePicker id="compare-from" value={from} versions={versions} live={live} draft={draft} onChange={(side) => onSides(side, to)} />
        <label htmlFor="compare-to" className="text-sm text-ink-2">
          {t.compareTo}
        </label>
        <SidePicker id="compare-to" value={to} versions={versions} live={live} draft={draft} onChange={(side) => onSides(from, side)} />
        <Button variant="ghost" className="max-md:h-10 max-md:px-3" onPress={() => onSides(to, from)}>
          {t.swap}
        </Button>
        {diff && fromSide && toSide && !same ? (
          <p role="status" className="ms-auto text-sm text-ink tabular-nums">
            {diff.identical ? t.identical(fromSide.name, toSide.name) : t.summary(diff.counts.added, diff.counts.removed, diff.counts.changed, diff.counts.settings)}
          </p>
        ) : null}
      </div>

      {same ? (
        <p className="px-4 py-4 text-base text-ink-2 md:px-5">{t.sameSides}</p>
      ) : failed?.isError ? (
        <div className="max-w-2xl px-4 py-4 md:px-5">
          <Notice
            tone="danger"
            title={t.compareFailed}
            action={
              <Button variant="outline" isDisabled={failed.isFetching} onPress={() => void failed.refetch()}>
                {t.retry}
              </Button>
            }
          >
            {failed.error.reason}
          </Notice>
        </div>
      ) : fromSide && toSide && diff ? (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section aria-label={t.diffLabel} aria-busy={busy} className={`${busy ? "opacity-60" : ""} order-last min-h-0 border-rule-strong md:flex-1 md:overflow-y-auto lg:order-first lg:w-88 lg:flex-none lg:shrink-0 lg:border-e`}>
            <DiffList diff={diff} from={fromSide.version} to={toSide.version} fromName={fromSide.name} toName={toSide.name} mode={mode} selected={selected} onSelect={select} />
          </section>
          <div className="sticky top-0 z-10 flex h-112 shrink-0 flex-col border-b border-rule-strong bg-panel lg:static lg:h-auto lg:min-h-0 lg:flex-1 lg:border-b-0">
            <CompareMaps from={fromSide} to={toSide} theme={mode} highlightId={selected} handleRef={maps} />
          </div>
        </div>
      ) : (
        <p aria-busy="true" className="px-4 py-4 text-base text-ink-3 md:px-5">
          {t.compareLoading}
        </p>
      )}
    </div>
  );
}
