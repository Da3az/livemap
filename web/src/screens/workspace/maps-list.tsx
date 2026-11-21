import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router";
import { Icon } from "@/components/icons";
import { StateBadge } from "@/components/state-badge";
import { formatAbsolute, RelativeTime } from "@/components/time";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLang } from "@/i18n";
import { useShellStrings } from "@/i18n/shell";
import type { Session } from "@/model/types";
import { formatCentre, isNear, publishState, type Sort, type SortKey } from "./model";
import { type Body, type Item, LoadError, NoMatch, OutcomeNotice, OwnershipMark, RowActions, TitleText } from "./rows";
import type { ArchiveActions } from "./use-archive";

const SORT_KEYS: SortKey[] = ["updated", "title", "features"];

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-x-3 border-t border-rule py-1.5">
      <dt className="text-xs text-ink-3">{term}</dt>
      <dd className="col-span-2 text-sm tabular-nums text-ink">{children}</dd>
    </div>
  );
}

function MapEntry({ session, item, archivedView, actions }: { session: Session; item: Item; archivedView: boolean; actions: ArchiveActions }) {
  const t = useShellStrings();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const { map } = item;
  const state = publishState(map, t.ws);
  const featureLimit = session.limits.maxFeaturesPerMap;
  const nearLimit = isNear(map.featureCount, featureLimit) || map.featureCount >= featureLimit;

  return (
    <li className="border-b border-rule">
      <div className="flex items-stretch">
        <Link to={`/maps/${map.id}`} className="flex min-w-0 flex-1 flex-col gap-1 py-2.5 ps-4 -outline-offset-2">
          <TitleText map={map} className="line-clamp-2 text-base text-ink" />
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-2">
            <StateBadge state={state.state}>
              <span className="tabular-nums">{state.label}</span>
            </StateBadge>
            <RelativeTime iso={map.updatedAt} className="tabular-nums" />
            <OwnershipMark session={session} map={map} />
          </span>
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={t.ws.detailsNamed(map.title.value)}
          onClick={() => setOpen((value) => !value)}
          className="grid w-12 shrink-0 place-items-center text-ink-3 -outline-offset-2"
        >
          <Icon name="chevron" className={open ? "-rotate-90" : "rotate-90"} />
        </button>
      </div>

      {open ? (
        <div id={detailsId} className="bg-well px-4 pb-3">
          <dl>
            <Detail term={t.ws.colFeatures}>
              <span className={nearLimit ? "font-semibold text-warning" : undefined}>
                {nearLimit ? t.ws.featuresOf(map.featureCount, featureLimit) : t.n(map.featureCount)}
              </span>
            </Detail>
            <Detail term={t.ws.colRevFull}>{t.n(map.rev)}</Detail>
            <Detail term={t.ws.colDirFull}>{map.uiDir === "rtl" ? t.ws.rtlFull : t.ws.ltrFull}</Detail>
            <Detail term={t.ws.colUpdated}>{formatAbsolute(map.updatedAt, lang)}</Detail>
            <Detail term={t.ws.updatedByLabel}>
              <bdi>{map.updatedBy}</bdi>
            </Detail>
            <Detail term={t.ws.createdBy}>
              <bdi>{map.createdBy.name}</bdi>
            </Detail>
            <Detail term={t.ws.centre}>
              {formatCentre(map.thumbnail.center)} · {t.ws.zoom(map.thumbnail.zoom.toFixed(1))}
            </Detail>
          </dl>
          <div className="mt-2 flex flex-wrap gap-1 border-t border-rule pt-2">
            <RowActions session={session} item={item} archivedView={archivedView} actions={actions} tabIndex={0} />
          </div>
        </div>
      ) : null}

      {item.outcome ? (
        <div className="px-4 pb-3">
          <OutcomeNotice item={item} actions={actions} stacked />
        </div>
      ) : null}
    </li>
  );
}

/**
 * The same maps on a phone: title, state and when it last changed; the rest,
 * and the actions, behind each row's disclosure.
 */
export function MapsList({
  session,
  body,
  archivedView,
  sort,
  onSort,
  actions,
  empty,
}: {
  session: Session | null;
  body: Body;
  archivedView: boolean;
  sort: Sort;
  onSort: (key: SortKey) => void;
  actions: ArchiveActions;
  empty: ReactNode;
}) {
  const t = useShellStrings();
  const names: Record<SortKey, string> = { updated: t.ws.sortUpdated, title: t.ws.sortTitle, features: t.ws.sortFeatures };

  return (
    <div>
      <div className={`items-center justify-between gap-3 border-b border-rule-strong px-4 py-2 ${body.kind === "rows" || body.kind === "loading" ? "flex" : "hidden"}`}>
        <span className="text-xs font-medium text-ink-3">{t.ws.sortBy}</span>
        <ToggleGroup aria-label={t.ws.sortBy} spacing={0} selectionMode="single" selectedKeys={[sort.key]}>
          {SORT_KEYS.map((key) => (
            <ToggleGroupItem key={key} id={key} className="h-row px-3" onPress={() => onSort(key)}>
              {names[key]}
              {sort.key === key ? (
                <>
                  <Icon name="chevron" size={10} className={sort.descending ? "rotate-90" : "-rotate-90"} />
                  <span className="sr-only">{sort.descending ? t.ws.sortDesc : t.ws.sortAsc}</span>
                </>
              ) : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {body.kind === "loading" ? (
        <ul aria-busy="true">
          <li className="sr-only" role="status">
            {t.ws.loading}
          </li>
          {["w-4/5", "w-3/5", "w-full", "w-2/3", "w-1/2", "w-3/4"].map((width) => (
            <li key={width} aria-hidden="true" className="flex flex-col gap-2.5 border-b border-rule px-4 py-3.5">
              <span className={`h-3 rounded-key bg-rule ${width}`} />
              <span className="h-2.5 w-2/5 rounded-key bg-rule" />
            </li>
          ))}
        </ul>
      ) : null}
      {body.kind === "error" ? (
        <div className="px-4 py-3">
          <LoadError body={body} />
        </div>
      ) : null}
      {body.kind === "empty" ? empty : null}
      {body.kind === "nomatch" ? (
        <div className="px-4">
          <NoMatch body={body} />
        </div>
      ) : null}
      {body.kind === "rows" && session ? (
        <ul aria-label={t.ws.tableLabel(archivedView ? t.ws.archived : t.ws.active, body.items.length)}>
          {body.items.map((item) =>
            item.outcome?.kind === "done" || !item.present ? (
              <li key={item.map.id} className="border-b border-rule px-4 py-3">
                <OutcomeNotice item={item} actions={actions} stacked />
              </li>
            ) : (
              <MapEntry key={item.map.id} session={session} item={item} archivedView={archivedView} actions={actions} />
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
