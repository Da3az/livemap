import { Fragment, type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { StateBadge } from "@/components/state-badge";
import { useVersionsStrings } from "@/i18n/versions";
import type { Session, VersionRecord } from "@/model/types";
import { CopyButton } from "./copy";
import { cachePolicy, formatBytes, previousVersion, type RollbackBar, shortEtag, type Sort, type SortKey } from "./model";
import { When } from "./pointer";
import { type Rollback, RollbackPanel } from "./rollback";

/*
 * Columns, leading to trailing. As the pane narrows the storage facts give way
 * first (cache, ETag, file, then size and features); they stay readable in the
 * line under the table for the row in hand.
 */
const COL = {
  version: "w-28",
  origin: "",
  when: "w-52",
  by: "w-32",
  features: "hidden w-20 @5xl:table-cell",
  size: "hidden w-20 @5xl:table-cell",
  etag: "hidden w-36 @6xl:table-cell",
  cache: "hidden w-32 @7xl:table-cell",
  file: "hidden w-16 @6xl:table-cell",
  actions: "w-56",
} as const;
const COLUMN_COUNT = Object.keys(COL).length;

const TH = "sticky top-0 z-10 h-row border-b border-rule-strong bg-panel px-2 text-xs font-medium whitespace-nowrap text-ink-3";
const TD = "h-10 border-b border-rule px-2 align-middle";

export interface VersionRowsProps {
  /** Null only while the screen is still loading, when nothing can be asked of a row. */
  session: Session | null;
  /** Sorted for display. */
  versions: VersionRecord[];
  /** Every version, for "the one before". */
  all: readonly VersionRecord[];
  live: number | null;
  sort: Sort;
  onSort: (key: SortKey) => void;
  rollback: Rollback;
  bar: RollbackBar;
  nextVersion: number;
  viewing: number | null;
  onView: (version: number) => void;
  onCompare: (version: number) => void;
  loading: boolean;
  /** False where an empty body would be read as "no versions" when the truth is "not known". */
  showEmpty: boolean;
}

function SortHeader({ column, sort, onSort, end, className, title, children }: { column: SortKey; sort: Sort; onSort: (key: SortKey) => void; end?: boolean; className: string; title?: string; children: ReactNode }) {
  const t = useVersionsStrings();
  const active = sort.key === column;
  return (
    <th scope="col" title={title} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"} className={`${TH} ${className} ${end ? "text-end" : "text-start"}`}>
      <button type="button" onClick={() => onSort(column)} className={`-mx-1 inline-flex h-6 items-center gap-1 rounded-key px-1 font-medium hover:text-ink ${active ? "text-ink" : ""}`}>
        {children}
        <Icon name="chevron" size={10} className={`${active ? "text-ink" : "text-rule-strong"} ${active && !sort.descending ? "-rotate-90" : "rotate-90"}`} />
        <span className="sr-only">{active ? (sort.descending ? t.sortDesc : t.sortAsc) : ""}</span>
      </button>
    </th>
  );
}

function Bar({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block h-2.5 rounded-key bg-rule ${className}`} />;
}

const SKELETON = ["w-40", "w-36", "w-44", "w-36", "w-40", "w-32"];

function SkeletonRows() {
  return (
    <>
      {SKELETON.map((width, index) => (
        <tr key={index} aria-hidden="true">
          <td className={`${TD} ps-4 md:ps-5`}>
            <Bar className="w-8" />
          </td>
          <td className={TD}>
            <Bar className={width} />
          </td>
          <td className={TD}>
            <Bar className="w-40" />
          </td>
          <td className={TD}>
            <Bar className="w-24" />
          </td>
          <td className={`${TD} ${COL.features}`}>
            <Bar className="ms-auto w-8" />
          </td>
          <td className={`${TD} ${COL.size}`}>
            <Bar className="ms-auto w-12" />
          </td>
          <td className={`${TD} ${COL.etag}`}>
            <Bar className="w-24" />
          </td>
          <td className={`${TD} ${COL.cache}`}>
            <Bar className="w-20" />
          </td>
          <td className={`${TD} ${COL.file}`}>
            <Bar className="w-8" />
          </td>
          <td className={`${TD} pe-4 md:pe-5`}>
            <Bar className="ms-auto w-40" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function Origin({ record }: { record: VersionRecord }) {
  const t = useVersionsStrings();
  return <span className="tabular-nums">{record.origin.type === "publish" ? t.fromRev(record.origin.rev) : t.rolledBack(record.origin.fromVersion)}</span>;
}

const NAV = "rounded-key text-sm text-bathy underline-offset-3 hover:underline max-md:py-2";
const NAV_CURRENT = "rounded-key text-sm font-semibold text-ink underline decoration-plum decoration-2 underline-offset-3 max-md:py-2";

/** Every published version as a table, with the answer to a rollback opening under the row it was asked from. */
export function VersionsTable({ session, versions, all, live, sort, onSort, rollback, bar, nextVersion, viewing, onView, onCompare, loading, showEmpty }: VersionRowsProps) {
  const t = useVersionsStrings();
  const [current, setCurrent] = useState<number | null>(null);
  const rows = useRef(new Map<number, HTMLTableRowElement>());
  const inHand = versions.find((record) => record.version === current) ?? versions[0] ?? null;

  const move = (from: number, step: "next" | "previous" | "first" | "last"): void => {
    const index = versions.findIndex((record) => record.version === from);
    const target = step === "first" ? 0 : step === "last" ? versions.length - 1 : index + (step === "next" ? 1 : -1);
    const record = versions[Math.max(0, Math.min(versions.length - 1, target))];
    if (record) rows.current.get(record.version)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, record: VersionRecord): void => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === "ArrowDown") move(record.version, "next");
    else if (key === "ArrowUp") move(record.version, "previous");
    else if (key === "Home") move(record.version, "first");
    else if (key === "End") move(record.version, "last");
    else if (key === "Enter") onView(record.version);
    else if (key === "c") onCompare(record.version);
    else if (key === "r" && record.version !== live) rollback.open(record.version);
    else return;
    event.preventDefault();
  };

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table aria-label={t.tableLabel(versions.length)} aria-busy={loading} className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <SortHeader column="version" sort={sort} onSort={onSort} className={`${COL.version} ps-4 md:ps-5`} title={t.colVersionFull}>
                {t.colVersion}
              </SortHeader>
              <th scope="col" className={`${TH} ${COL.origin} text-start`}>
                {t.colOrigin}
              </th>
              <SortHeader column="when" sort={sort} onSort={onSort} className={COL.when}>
                {t.colWhen}
              </SortHeader>
              <SortHeader column="by" sort={sort} onSort={onSort} className={COL.by}>
                {t.colBy}
              </SortHeader>
              <SortHeader column="features" sort={sort} onSort={onSort} end className={COL.features}>
                {t.colFeatures}
              </SortHeader>
              <SortHeader column="size" sort={sort} onSort={onSort} end className={COL.size}>
                {t.colSize}
              </SortHeader>
              <th scope="col" className={`${TH} ${COL.etag} text-start`}>
                {t.colEtag}
              </th>
              <th scope="col" className={`${TH} ${COL.cache} text-start`}>
                {t.colCache}
              </th>
              <th scope="col" className={`${TH} ${COL.file} text-start`}>
                {t.colFile}
              </th>
              <th scope="col" className={`${TH} ${COL.actions} pe-4 text-end md:pe-5`}>
                {t.colActions}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows /> : null}
            {showEmpty && !loading && versions.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="border-b border-rule px-4 py-3 text-base text-ink-2 md:px-5">
                  {t.emptyRow}
                </td>
              </tr>
            ) : null}
            {versions.map((record, index) => {
              const isLive = record.version === live;
              const asked = rollback.state?.target === record.version ? rollback.state : null;
              const focusable = current === null ? index === 0 : current === record.version;
              return (
                <Fragment key={record.version}>
                  <tr
                    ref={(element) => {
                      if (element) rows.current.set(record.version, element);
                      else rows.current.delete(record.version);
                    }}
                    tabIndex={focusable ? 0 : -1}
                    aria-current={viewing === record.version ? "true" : undefined}
                    onFocus={() => setCurrent(record.version)}
                    onMouseEnter={() => setCurrent(record.version)}
                    onKeyDown={(event) => onKeyDown(event, record)}
                    className={`group cursor-default -outline-offset-2 hover:bg-well focus-visible:bg-well ${viewing === record.version ? "bg-well" : ""}`}
                  >
                    <th scope="row" className={`${TD} ps-4 text-start font-normal md:ps-5 ${viewing === record.version ? "border-s-2 border-s-survey" : ""}`}>
                      <span className="flex items-baseline gap-2">
                        <span className="w-7 text-end font-title text-lg leading-none font-semibold text-ink tabular-nums">
                          <span className="sr-only">{t.versionLabel(record.version)}</span>
                          <span aria-hidden="true">{record.version}</span>
                        </span>
                        {isLive ? <StateBadge state="live">{t.live}</StateBadge> : null}
                      </span>
                    </th>
                    <td className={`${TD} truncate text-ink-2`}>
                      <Origin record={record} />
                    </td>
                    <td className={`${TD} text-ink`}>
                      <When iso={record.publishedAt} />
                    </td>
                    <td className={`${TD} truncate text-ink-2`}>
                      <span dir="auto" title={record.publishedBy.name}>
                        {record.publishedBy.name}
                      </span>
                    </td>
                    <td className={`${TD} ${COL.features} text-end text-ink tabular-nums`}>{t.n(record.featureCount)}</td>
                    <td className={`${TD} ${COL.size} text-end text-ink tabular-nums`}>{formatBytes(record.byteSize)}</td>
                    <td className={`${TD} ${COL.etag}`}>
                      <span className="flex items-center gap-1">
                        <span title={record.etag} className="text-xs text-ink-2 tabular-nums">
                          {shortEtag(record.etag)}
                        </span>
                        <CopyButton compact text={record.etag} label={`${t.copyEtag}, ${t.versionLabel(record.version)}`} />
                      </span>
                    </td>
                    <td title={record.cacheControl} className={`${TD} ${COL.cache} truncate text-xs text-ink-2 tabular-nums`}>
                      {cachePolicy(record.cacheControl)}
                    </td>
                    <td className={`${TD} ${COL.file}`}>
                      <a href={record.url} target="_blank" rel="noreferrer" aria-label={t.fileNamed(record.version)} className="inline-flex items-center gap-1 rounded-key text-xs text-bathy underline decoration-1 underline-offset-2 hover:decoration-2">
                        json
                        <Icon name="external" size={10} />
                      </a>
                    </td>
                    <td className={`${TD} pe-4 md:pe-5`}>
                      <span className="flex items-center justify-end gap-3">
                        {/* View and Compare go somewhere, so they read as links; rolling back changes what readers see, so it is a button that asks first. */}
                        <button type="button" aria-label={t.viewNamed(record.version)} aria-pressed={viewing === record.version} onClick={() => onView(record.version)} className={viewing === record.version ? NAV_CURRENT : NAV}>
                          {viewing === record.version ? t.viewing : t.view}
                        </button>
                        <button type="button" aria-label={t.compareNamed(record.version, previousVersion(all, record.version))} onClick={() => onCompare(record.version)} className={NAV}>
                          {t.compare}
                        </button>
                        {isLive ? (
                          <span aria-hidden="true" className="w-22" />
                        ) : (
                          <button
                            type="button"
                            aria-label={t.rollBackNamed(record.version)}
                            aria-expanded={asked !== null}
                            onClick={() => (asked ? rollback.close() : rollback.open(record.version))}
                            className={`h-field w-22 shrink-0 rounded-field border px-2 text-sm font-medium -outline-offset-2 hover:border-danger hover:bg-danger-wash hover:text-danger max-md:h-10 ${asked ? "border-danger bg-danger-wash text-danger" : "border-rule-strong bg-panel text-ink"}`}
                          >
                            {t.rollBack}…
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                  {asked && session ? (
                    <tr>
                      <td colSpan={COLUMN_COUNT} className="border-b border-rule bg-panel px-4 py-2 md:px-5">
                        <div className="max-w-4xl">
                          <RollbackPanel rollback={rollback} state={asked} bar={bar} session={session} nextVersion={nextVersion} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="flex h-row shrink-0 items-center gap-x-4 overflow-hidden border-t border-rule-strong px-4 text-xs whitespace-nowrap text-ink-3 md:px-5">
        {inHand ? (
          <>
            <span className="font-medium text-ink tabular-nums">{t.version(inHand.version)}</span>
            <span className="tabular-nums" title={inHand.etag}>
              {t.etag} {shortEtag(inHand.etag)}
            </span>
            <span title={inHand.cacheControl}>
              {t.cache} {cachePolicy(inHand.cacheControl)}
            </span>
            <span className="tabular-nums">{formatBytes(inHand.byteSize)}</span>
            <span className="tabular-nums">{t.featuresCount(inHand.featureCount)}</span>
            <span className="truncate">{inHand.storageKey}</span>
          </>
        ) : null}
        <span className="ms-auto max-xl:hidden">{t.keys}</span>
      </p>
    </div>
  );
}
