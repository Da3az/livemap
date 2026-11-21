import { StateBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { useVersionsStrings } from "@/i18n/versions";
import { formatBytes, previousVersion, type SortKey } from "./model";
import { When } from "./pointer";
import { RollbackPanel } from "./rollback";
import { Origin, type VersionRowsProps } from "./table";

const SORTS: SortKey[] = ["version", "when", "by", "features", "size"];

/**
 * The versions on a phone: one block per version keeping its number, when,
 * who and whether it is live, with the same three actions and the same
 * in-place rollback as the table.
 */
const NAV = "min-h-10 rounded-key text-base text-bathy underline-offset-3 hover:underline";
const NAV_CURRENT = "min-h-10 rounded-key text-base font-semibold text-ink underline decoration-plum decoration-2 underline-offset-3";

export function VersionsList({ session, versions, all, live, sort, onSort, rollback, bar, nextVersion, viewing, onView, onCompare, loading, showEmpty }: VersionRowsProps) {
  const t = useVersionsStrings();
  const names: Record<SortKey, string> = { version: t.colVersionFull, when: t.colWhen, by: t.colBy, features: t.colFeatures, size: t.colSize };

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-rule-strong px-4 py-2 text-xs text-ink-3">
        <label htmlFor="versions-sort">{t.sortBy}</label>
        <select
          id="versions-sort"
          value={sort.key}
          onChange={(event) => {
            const key = SORTS.find((candidate) => candidate === event.target.value);
            if (key) onSort(key);
          }}
          className="h-10 rounded-field border border-rule-strong bg-panel px-2 text-base text-ink"
        >
          {SORTS.map((key) => (
            <option key={key} value={key}>
              {names[key]}
            </option>
          ))}
        </select>
        <Button variant="outline" size="touch" aria-label={`${names[sort.key]}, ${sort.descending ? t.sortDesc : t.sortAsc}`} onPress={() => onSort(sort.key)}>
          {sort.descending ? "↓" : "↑"}
        </Button>
      </div>

      {loading ? (
        <ul aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <li key={index} className="flex items-center gap-3 border-b border-rule px-4 py-4">
              <span className="block h-6 w-8 rounded-key bg-well" />
              <span className="block h-3 w-44 rounded-key bg-well" />
            </li>
          ))}
        </ul>
      ) : null}
      {showEmpty && !loading && versions.length === 0 ? <p className="border-b border-rule px-4 py-3 text-base text-ink-2">{t.emptyRow}</p> : null}

      <ol aria-label={t.tableLabel(versions.length)}>
        {versions.map((record) => {
          const isLive = record.version === live;
          const asked = rollback.state?.target === record.version ? rollback.state : null;
          return (
            <li key={record.version} className={`border-b border-rule px-4 py-2.5 ${viewing === record.version ? "bg-well" : ""}`}>
              <div className="flex items-start gap-3">
                <span className="w-9 shrink-0 text-end font-title text-xl leading-none font-semibold text-ink tabular-nums">
                  <span className="sr-only">{t.versionLabel(record.version)}</span>
                  <span aria-hidden="true">{record.version}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink">
                    <When iso={record.publishedAt} className="whitespace-normal" />
                    {isLive ? <StateBadge state="live">{t.live}</StateBadge> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-2">
                    <span dir="auto">{record.publishedBy.name}</span> · <Origin record={record} />
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3 tabular-nums">
                    {t.featuresCount(record.featureCount)} · {formatBytes(record.byteSize)}
                  </p>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-4 ps-12">
                <button type="button" aria-label={t.viewNamed(record.version)} aria-pressed={viewing === record.version} onClick={() => onView(record.version)} className={viewing === record.version ? NAV_CURRENT : NAV}>
                  {viewing === record.version ? t.viewing : t.view}
                </button>
                <button type="button" aria-label={t.compareNamed(record.version, previousVersion(all, record.version))} onClick={() => onCompare(record.version)} className={NAV}>
                  {t.compare}
                </button>
                {isLive ? null : (
                  <button
                    type="button"
                    aria-label={t.rollBackNamed(record.version)}
                    aria-expanded={asked !== null}
                    onClick={() => (asked ? rollback.close() : rollback.open(record.version))}
                    className={`ms-auto h-10 rounded-field border px-3 text-sm font-medium hover:border-danger hover:bg-danger-wash hover:text-danger ${asked ? "border-danger bg-danger-wash text-danger" : "border-rule-strong bg-panel text-ink"}`}
                  >
                    {t.rollBack}…
                  </button>
                )}
              </div>
              {asked && session ? (
                <div className="mt-2">
                  <RollbackPanel rollback={rollback} state={asked} bar={bar} session={session} nextVersion={nextVersion} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
