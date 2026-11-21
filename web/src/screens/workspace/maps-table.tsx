import { Fragment, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Icon } from "@/components/icons";
import { StateBadge } from "@/components/state-badge";
import { formatAbsolute, RelativeTime } from "@/components/time";
import { Kbd } from "@/components/ui/kbd";
import { useLang } from "@/i18n";
import { useShellStrings } from "@/i18n/shell";
import type { MapSummary, Session } from "@/model/types";
import { formatCentre, isNear, publishState, type Sort, type SortKey } from "./model";
import { type Body, type Item, LoadError, NoMatch, OutcomeNotice, OwnershipMark, PersonName, RowActions, TitleText } from "./rows";
import type { ArchiveActions } from "./use-archive";

/*
 * Columns, leading to trailing. Rev., Dir. and By give way first as the pane
 * narrows; what they hold is still in the line under the table for the row in
 * hand. They are left out rather than hidden, so a row that spans the table
 * spans exactly the columns that are there.
 */
const COL = {
  title: "",
  state: "w-40",
  features: "w-28",
  rev: "w-20",
  dir: "w-12",
  updated: "w-24",
  by: "w-32",
  actions: "w-48",
} as const;

interface Columns {
  /** Rev. and Dir. */
  detail: boolean;
  by: boolean;
  count: number;
}

/** Pane widths in CSS pixels at which the optional columns fit beside a readable title. */
const WIDTH_FOR_BY = 880;
const WIDTH_FOR_DETAIL = 1010;

function columnsFor(width: number): Columns {
  const detail = width >= WIDTH_FOR_DETAIL;
  const by = width >= WIDTH_FOR_BY;
  return { detail, by, count: 5 + (detail ? 2 : 0) + (by ? 1 : 0) };
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const TH = "sticky top-0 z-10 h-row border-b border-rule-strong bg-panel px-2 text-xs font-medium whitespace-nowrap text-ink-3";
const TD = "h-row border-b border-rule px-2 align-middle";

function SortHeader({
  column,
  sort,
  onSort,
  end,
  className,
  children,
}: {
  column: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  end?: boolean;
  className: string;
  children: ReactNode;
}) {
  const t = useShellStrings();
  const active = sort.key === column;
  return (
    <th scope="col" aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"} className={`${TH} ${className} ${end ? "text-end" : "text-start"}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`-mx-1 inline-flex h-6 items-center gap-1 rounded-key px-1 font-medium hover:text-ink ${active ? "text-ink" : ""}`}
      >
        {children}
        <Icon
          name="chevron"
          size={10}
          className={`${active ? "text-ink" : "text-rule-strong"} ${active && !sort.descending ? "-rotate-90" : "rotate-90"}`}
        />
        <span className="sr-only">{active ? (sort.descending ? t.ws.sortDesc : t.ws.sortAsc) : ""}</span>
      </button>
    </th>
  );
}

function Bar({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block h-2 rounded-key bg-rule ${className}`} />;
}

const SKELETON_TITLES = ["w-3/5", "w-4/5", "w-2/5", "w-3/4", "w-1/2", "w-2/3", "w-3/5", "w-1/3"];

function SkeletonRows({ cols }: { cols: Columns }) {
  return (
    <>
      {SKELETON_TITLES.map((width, index) => (
        <tr key={index} aria-hidden="true">
          <td className={`${TD} ps-4 md:ps-5`}>
            {/* the title line is taller, as the serif title is */}
            <Bar className={`h-3 ${width}`} />
          </td>
          <td className={`${TD} ${COL.state}`}>
            <span className="flex items-center gap-1.5">
              <span className="size-3 shrink-0 rounded-pill border border-rule-strong" />
              <Bar className="w-20" />
            </span>
          </td>
          <td className={`${TD} ${COL.features}`}>
            <Bar className="ms-auto w-10" />
          </td>
          {cols.detail ? (
            <>
              <td className={`${TD} ${COL.rev}`}>
                <Bar className="ms-auto w-6" />
              </td>
              <td className={`${TD} ${COL.dir}`}>
                <Bar className="w-6" />
              </td>
            </>
          ) : null}
          <td className={`${TD} ${COL.updated}`}>
            <Bar className="w-16" />
          </td>
          {cols.by ? (
            <td className={`${TD} ${COL.by}`}>
              <Bar className="w-24" />
            </td>
          ) : null}
          <td className={`${TD} ${COL.actions} pe-3 md:pe-4`}>
            {/* where Open, Versions and Archive will stand, with the rule before Archive */}
            <span className="flex items-center justify-end gap-3">
              <Bar className="w-8" />
              <Bar className="w-12" />
              <span className="flex h-4 items-center border-s border-rule ps-2.5">
                <Bar className="w-10" />
              </span>
            </span>
          </td>
        </tr>
      ))}
    </>
  );
}

/*
 * The revision, and how far the draft has run past what readers see. The state
 * column already names the live version; this says how much is unpublished.
 */
function RevisionCell({ map }: { map: MapSummary }) {
  const t = useShellStrings();
  const ahead = map.publishedRev !== null && !map.archived ? map.rev - map.publishedRev : 0;
  return (
    <span className="inline-flex items-baseline justify-end gap-1.5">
      {ahead > 0 ? (
        <span className="text-xs font-medium text-state-draft" title={t.ws.revAhead(ahead)}>
          +{t.n(ahead)}
          <span className="sr-only"> {t.ws.revAhead(ahead)},</span>
        </span>
      ) : null}
      <span>{t.n(map.rev)}</span>
    </span>
  );
}

function FullRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="border-b border-rule px-4 py-2 md:px-5">
        {children}
      </td>
    </tr>
  );
}

function MapRow({
  cols,
  session,
  item,
  archivedView,
  actions,
  current,
  rowRef,
  onCurrent,
  onLeave,
  onHover,
  onMove,
}: {
  cols: Columns;
  session: Session;
  item: Item;
  archivedView: boolean;
  actions: ArchiveActions;
  current: boolean;
  rowRef: (element: HTMLTableRowElement | null) => void;
  onCurrent: () => void;
  onLeave: () => void;
  onHover: (hovering: boolean) => void;
  onMove: (step: "next" | "previous" | "first" | "last") => void;
}) {
  const t = useShellStrings();
  const navigate = useNavigate();
  const { map } = item;
  const state = publishState(map, t.ws);
  const featureLimit = session.limits.maxFeaturesPerMap;
  const nearLimit = isNear(map.featureCount, featureLimit) || map.featureCount >= featureLimit;

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>): void => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown":
        onMove("next");
        break;
      case "ArrowUp":
        onMove("previous");
        break;
      case "Home":
        onMove("first");
        break;
      case "End":
        onMove("last");
        break;
      case "Enter":
        void navigate(`/maps/${map.id}`);
        break;
      case "v":
      case "V":
        void navigate(`/maps/${map.id}/versions`);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onClick = (event: MouseEvent<HTMLTableRowElement>): void => {
    if (event.target instanceof Element && event.target.closest("a, button")) return;
    void navigate(`/maps/${map.id}`);
  };

  return (
    <tr
      ref={rowRef}
      tabIndex={current ? 0 : -1}
      onFocus={onCurrent}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onLeave();
      }}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className="group cursor-default -outline-offset-2 hover:bg-well focus-visible:bg-well"
    >
      <th scope="row" className={`${TD} py-1 ps-4 text-start font-normal md:ps-5`}>
        <span className="flex min-w-0 items-center gap-2">
          <TitleText map={map} className={`min-w-0 text-base text-ink ${cols.by ? "block truncate" : "line-clamp-2"}`} />
          <OwnershipMark session={session} map={map} />
        </span>
      </th>
      <td className={`${TD} ${COL.state}`}>
        <StateBadge state={state.state}>
          <span className="tabular-nums">{state.label}</span>
        </StateBadge>
      </td>
      <td className={`${TD} ${COL.features} text-end text-sm tabular-nums ${nearLimit ? "font-semibold text-warning" : "text-ink-2"}`}>
        {nearLimit ? (
          <span title={t.ws.featuresNear(featureLimit)}>
            {t.ws.featuresOf(map.featureCount, featureLimit)}
            <span className="sr-only">. {t.ws.featuresNear(featureLimit)}</span>
          </span>
        ) : (
          t.n(map.featureCount)
        )}
      </td>
      {cols.detail ? (
        <>
          <td className={`${TD} ${COL.rev} text-end text-sm tabular-nums text-ink-2`}>
            <RevisionCell map={map} />
          </td>
          <td className={`${TD} ${COL.dir} text-xs text-ink-3`}>
            <abbr title={map.uiDir === "rtl" ? t.ws.rtlFull : t.ws.ltrFull} className="no-underline">
              {map.uiDir === "rtl" ? t.ws.rtl : t.ws.ltr}
            </abbr>
          </td>
        </>
      ) : null}
      <td className={`${TD} ${COL.updated} text-xs tabular-nums whitespace-nowrap text-ink-2`}>
        <RelativeTime iso={map.updatedAt} />
      </td>
      {cols.by ? (
        <td className={`${TD} ${COL.by} text-xs text-ink-2`}>
          <PersonName name={map.updatedBy} className="block truncate" />
        </td>
      ) : null}
      <td className={`${TD} ${COL.actions} pe-3 md:pe-4`}>
        <span className="flex justify-end">
          <RowActions session={session} item={item} archivedView={archivedView} actions={actions} tabIndex={current ? 0 : -1} />
        </span>
      </td>
    </tr>
  );
}

/** The line under the table: everything about the row in hand, or how the table is ordered and driven. */
function Margin({ session, map, count, sort }: { session: Session | null; map: MapSummary | null; count: number | null; sort: Sort }) {
  const t = useShellStrings();
  const lang = useLang();
  const sortName = sort.key === "title" ? t.ws.sortTitle : sort.key === "features" ? t.ws.sortFeatures : t.ws.sortUpdated;

  return (
    <div className="flex min-h-12 shrink-0 flex-wrap content-center items-baseline gap-x-5 gap-y-0.5 border-t border-rule-strong bg-panel px-4 py-1.5 text-xs text-ink-3 md:px-5">
      {map && session ? (
        <>
          <TitleText map={map} className="text-sm text-ink" />
          <span className="tabular-nums">
            {t.ws.centre} {formatCentre(map.thumbnail.center)} · {t.ws.zoom(map.thumbnail.zoom.toFixed(1))}
          </span>
          <span className="tabular-nums">
            {t.ws.rev(map.rev)} · {map.uiDir === "rtl" ? t.ws.rtlFull : t.ws.ltrFull}
          </span>
          <span className="tabular-nums">
            {t.ws.updatedBy(formatAbsolute(map.updatedAt, lang), "")}
            <bdi>{map.updatedBy}</bdi>
          </span>
          <span>
            {t.ws.createdBy} <bdi>{map.createdBy.name}</bdi>
          </span>
          <span dir="ltr">
            /{session.tenant.slug}/{map.slug}
          </span>
        </>
      ) : (
        <>
          {count !== null ? <span className="tabular-nums">{t.ws.footerIdle(count, `${sortName.toLowerCase()}, ${sort.descending ? t.ws.sortDesc : t.ws.sortAsc}`)}</span> : null}
          <span className="ms-auto flex flex-wrap items-center gap-x-3 xl:hidden">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> {t.ws.keyMove}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd> {t.ws.open}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>V</Kbd> {t.ws.versions}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>/</Kbd> {t.ws.keySearch}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The workspace as a table. The header and its columns are always there:
 * loading, empty and failed are what the body holds, not a different screen.
 */
export function MapsTable({
  session,
  body,
  archivedView,
  sort,
  onSort,
  actions,
  empty,
  firstRowRef,
}: {
  /** null while the session itself is still loading: the header and the skeleton need nothing from it. */
  session: Session | null;
  body: Body;
  archivedView: boolean;
  sort: Sort;
  onSort: (key: SortKey) => void;
  actions: ArchiveActions;
  /** What stands where the rows would be when there are none. */
  empty: ReactNode;
  /** Lets the search field hand focus down into the rows. */
  firstRowRef: RefObject<HTMLTableRowElement | null>;
}) {
  const t = useShellStrings();
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const paneRef = useRef<HTMLDivElement>(null);
  const cols = columnsFor(useWidth(paneRef));
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const items = body.kind === "rows" ? body.items : [];
  const mapRows = items.filter((item) => item.present && item.outcome?.kind !== "done");
  const current = mapRows.find((item) => item.map.id === currentId) ?? mapRows[0];
  const inHand = mapRows.find((item) => item.map.id === hoverId) ?? mapRows.find((item) => item.map.id === focusId);

  const move = (from: string, step: "next" | "previous" | "first" | "last"): void => {
    const index = mapRows.findIndex((item) => item.map.id === from);
    const target =
      step === "first" ? 0 : step === "last" ? mapRows.length - 1 : Math.min(mapRows.length - 1, Math.max(0, index + (step === "next" ? 1 : -1)));
    const next = mapRows[target];
    if (!next) return;
    setCurrentId(next.map.id);
    rows.current.get(next.map.id)?.focus();
  };

  return (
    <>
      <div ref={paneRef} className="min-h-0 flex-1 overflow-auto">
        <table
          aria-label={t.ws.tableLabel(archivedView ? t.ws.archived : t.ws.active, mapRows.length)}
          aria-busy={body.kind === "loading"}
          className="w-full table-fixed border-separate border-spacing-0"
        >
          <thead>
            <tr>
              <SortHeader column="title" sort={sort} onSort={onSort} className={`${COL.title} ps-4 md:ps-5`}>
                {t.ws.colTitle}
              </SortHeader>
              <th scope="col" className={`${TH} ${COL.state} text-start`}>
                {t.ws.colState}
              </th>
              <SortHeader column="features" sort={sort} onSort={onSort} end className={COL.features}>
                {t.ws.colFeatures}
              </SortHeader>
              {cols.detail ? (
                <>
                  <th scope="col" className={`${TH} ${COL.rev} text-end`}>
                    <abbr title={t.ws.colRevFull} className="no-underline">
                      {t.ws.colRev}
                    </abbr>
                  </th>
                  <th scope="col" className={`${TH} ${COL.dir} text-start`}>
                    <abbr title={t.ws.colDirFull} className="no-underline">
                      {t.ws.colDir}
                    </abbr>
                  </th>
                </>
              ) : null}
              <SortHeader column="updated" sort={sort} onSort={onSort} className={COL.updated}>
                {t.ws.colUpdated}
              </SortHeader>
              {cols.by ? (
                <th scope="col" className={`${TH} ${COL.by} text-start`}>
                  {t.ws.colBy}
                </th>
              ) : null}
              <th scope="col" className={`${TH} ${COL.actions} pe-4 md:pe-5`}>
                <span className="sr-only">{t.ws.colActions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {body.kind === "loading" ? (
              <>
                <tr>
                  <td colSpan={cols.count} className="sr-only" role="status">
                    {t.ws.loading}
                  </td>
                </tr>
                <SkeletonRows cols={cols} />
              </>
            ) : null}
            {body.kind === "error" ? (
              <FullRow span={cols.count}>
                <div className="max-w-2xl py-1">
                  <LoadError body={body} />
                </div>
              </FullRow>
            ) : null}
            {body.kind === "empty" ? (
              <tr>
                <td colSpan={cols.count} className="border-b border-rule p-0">
                  {empty}
                </td>
              </tr>
            ) : null}
            {body.kind === "nomatch" ? (
              <FullRow span={cols.count}>
                <NoMatch body={body} />
              </FullRow>
            ) : null}
            {items.map((item) => {
              if (!session) return null;
              if (item.outcome?.kind === "done" || !item.present) {
                return (
                  <FullRow key={item.map.id} span={cols.count}>
                    <OutcomeNotice item={item} actions={actions} />
                  </FullRow>
                );
              }
              const isCurrent = current?.map.id === item.map.id;
              return (
                <Fragment key={item.map.id}>
                  <MapRow
                    cols={cols}
                    session={session}
                    item={item}
                    archivedView={archivedView}
                    actions={actions}
                    current={isCurrent}
                    rowRef={(element) => {
                      if (element) rows.current.set(item.map.id, element);
                      else rows.current.delete(item.map.id);
                      if (mapRows[0]?.map.id === item.map.id) firstRowRef.current = element;
                    }}
                    onCurrent={() => {
                      setCurrentId(item.map.id);
                      setFocusId(item.map.id);
                    }}
                    onLeave={() => setFocusId((id) => (id === item.map.id ? null : id))}
                    onHover={(hovering) => setHoverId((id) => (hovering ? item.map.id : id === item.map.id ? null : id))}
                    onMove={(step) => move(item.map.id, step)}
                  />
                  {item.outcome ? (
                    <FullRow span={cols.count}>
                      <OutcomeNotice item={item} actions={actions} />
                    </FullRow>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Margin session={session} map={inHand?.map ?? null} count={body.kind === "rows" ? mapRows.length : null} sort={sort} />
    </>
  );
}
