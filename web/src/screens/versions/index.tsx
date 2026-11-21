import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { type MapDetail, useMap, useSession, useVersions, type VersionList } from "@/api/hooks";
import { AppHeader } from "@/components/app-header";
import { Notice } from "@/components/notice";
import { StateBadge } from "@/components/state-badge";
import { LinkButton } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useVersionsStrings } from "@/i18n/versions";
import type { Session } from "@/model/types";
import { CompareTab } from "./compare";
import { EmbedTab } from "./embed-tab";
import { VersionsList } from "./list";
import { DEFAULT_SORT, defaultSides, draftState, nextSort, parseSide, previousVersion, rollbackBar, type Side, type Sort, sortVersions } from "./model";
import { PointerDiagram } from "./pointer";
import { useRollback } from "./rollback";
import { LoadProblem, PendingScreen } from "./states";
import { VersionsTable } from "./table";
import { ViewPane } from "./view-pane";

type Tab = "history" | "compare" | "embed";

function useIsTableWidth(): boolean {
  const query = "(min-width: 48rem)";
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

function sideParam(side: Side): string {
  return side === "draft" ? "draft" : String(side);
}

function VersionsScreen({ session, detail, list }: { session: Session; detail: MapDetail; list: VersionList }) {
  const t = useVersionsStrings();
  const { map, features } = detail;
  const { pointer, versions } = list;
  const [params, setParams] = useSearchParams();
  const isTable = useIsTableWidth();
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const rollback = useRollback(map.id);

  const tabParam = params.get("tab");
  const tab: Tab = tabParam === "compare" || tabParam === "embed" ? tabParam : "history";
  const known = useMemo(() => new Set(versions.map((record) => record.version)), [versions]);
  const draft = draftState(map);
  const draftAhead = draft.kind === "ahead" && !map.archived;
  const live = versions.find((record) => record.version === pointer.version) ?? null;
  const sorted = useMemo(() => sortVersions(versions, sort), [versions, sort]);
  const nextVersion = versions.reduce((highest, record) => Math.max(highest, record.version), 0) + 1;
  const limit = session.limits.maxVersionsPerMap;

  const patch = useCallback(
    (changes: Record<string, string | null>) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  /* `?v=N` is accepted as a short form of `?view=N`. */
  const viewing = parseSide(params.get("view") ?? params.get("v"), known, false);
  const viewed = typeof viewing === "number" ? (versions.find((record) => record.version === viewing) ?? null) : null;

  const fallback = defaultSides(versions, pointer.version, draftAhead);
  const from = parseSide(params.get("a"), known, draftAhead) ?? fallback?.from ?? null;
  const to = parseSide(params.get("b"), known, draftAhead) ?? fallback?.to ?? null;

  const compare = (fromSide: Side, toSide: Side) => patch({ tab: "compare", a: sideParam(fromSide), b: sideParam(toSide), view: null });
  /* A version against the one before it; the first version has none, so it goes against the draft or itself. */
  const compareVersion = (version: number) => {
    const previous = previousVersion(versions, version);
    if (previous !== null) compare(previous, version);
    else compare(version, draftAhead ? "draft" : version);
  };

  const rows = {
    session,
    versions: sorted,
    all: versions,
    live: pointer.version,
    sort,
    onSort: (key: Sort["key"]) => setSort((current) => nextSort(current, key)),
    rollback,
    bar: rollbackBar(session, map, versions.length),
    nextVersion,
    viewing: viewed?.version ?? null,
    onView: (version: number) => patch({ view: viewed?.version === version ? null : String(version), v: null }),
    onCompare: compareVersion,
    loading: false,
    showEmpty: true,
  };
  const canPublish = session.capabilities.includes("map:publish");

  return (
    <div className="flex h-dvh flex-col bg-page">
      <AppHeader session={session}>
        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-rule-strong max-md:hidden" />
        <Link to={`/maps/${map.id}`} dir={map.title.dir} title={t.backToEditor} className="min-w-0 truncate rounded-key font-title text-lg text-ink hover:underline max-md:hidden">
          {map.title.value.trim() === "" ? t.untitled : map.title.value}
        </Link>
      </AppHeader>

      <main className="@container flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel md:overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-2 md:min-h-12 md:px-5">
          <h1 className="font-title text-lg font-medium text-ink">{t.title}</h1>
          <ToggleGroup
            aria-label={t.tabs}
            spacing={0}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[tab]}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              patch({ tab: next === "compare" || next === "embed" ? next : null });
            }}
          >
            <ToggleGroupItem id="history" className="max-md:h-10 max-md:px-3">
              {t.tabHistory}
            </ToggleGroupItem>
            <ToggleGroupItem id="compare" className="max-md:h-10 max-md:px-3">
              {t.tabCompare}
            </ToggleGroupItem>
            <ToggleGroupItem id="embed" className="max-md:h-10 max-md:px-3">
              {t.tabEmbed}
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-xs text-ink-3 tabular-nums">{limit === null ? t.count(versions.length) : t.countOf(versions.length, limit)}</span>
          {map.archived ? <StateBadge state="archived">{t.archivedBanner}</StateBadge> : null}
          <LinkButton variant="outline" href={`/maps/${map.id}`} className="ms-auto max-md:h-10 max-md:px-4">
            {t.openEditor}
          </LinkButton>
          <p dir={map.title.dir} className="w-full truncate font-title text-base text-ink-2 md:hidden">
            {map.title.value}
          </p>
        </div>

        {map.archived ? (
          <div className="shrink-0 border-b border-rule px-4 py-2 md:px-5">
            <Notice tone="info" title={t.archivedBanner} className="max-w-4xl">
              {t.archivedBannerBody}
            </Notice>
          </div>
        ) : !canPublish ? (
          <div className="shrink-0 border-b border-rule px-4 py-2 md:px-5">
            <Notice tone="info" title={t.readOnlyBanner(session.role)} className="max-w-4xl">
              {t.readOnlyBannerBody}
            </Notice>
          </div>
        ) : null}

        {tab === "history" ? (
          <>
            <PointerDiagram map={map} pointer={pointer} live={live} draft={draft} onCompareDraft={() => (pointer.version !== null ? compare(pointer.version, "draft") : undefined)} />
            <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
              {viewed ? <ViewPane key={viewed.version} mapId={map.id} record={viewed} live={viewed.version === pointer.version} onClose={() => patch({ view: null })} /> : null}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:order-first">{isTable ? <VersionsTable {...rows} /> : <VersionsList {...rows} />}</div>
            </div>
          </>
        ) : tab === "compare" ? (
          from !== null && to !== null ? (
            <CompareTab map={map} features={features} versions={versions} live={pointer.version} draft={draftAhead ? draft : { kind: "never", rev: map.rev }} from={from} to={to} onSides={(a, b) => patch({ a: sideParam(a), b: sideParam(b) })} />
          ) : (
            <p className="max-w-prose px-4 py-4 text-base text-ink-2 md:px-5">{t.nothingToCompare}</p>
          )
        ) : (
          <EmbedTab map={map} tenantSlug={session.tenant.slug} liveVersion={pointer.version} />
        )}
      </main>
    </div>
  );
}

export default function Versions() {
  const { id } = useParams();
  const session = useSession();
  const detail = useMap(session.isSuccess ? id : undefined);
  const list = useVersions(session.isSuccess ? id : undefined);

  if (session.isError && session.error.code === "unauthorised") {
    return <Navigate to="/" replace state={{ notice: session.error.reason }} />;
  }
  if (session.isSuccess && detail.isSuccess && list.isSuccess) {
    return <VersionsScreen session={session.data} detail={detail.data} list={list.data} />;
  }
  const failed = [session, detail, list].find((query) => query.isError);
  return (
    <PendingScreen session={session.data ?? null} mapId={id ?? ""}>
      {failed?.isError ? (
        <LoadProblem
          error={failed.error}
          failedAt={failed.errorUpdatedAt}
          fetching={failed.isFetching}
          onRetry={() => {
            for (const query of [session, detail, list]) if (query.isError) void query.refetch();
          }}
        />
      ) : null}
    </PendingScreen>
  );
}
