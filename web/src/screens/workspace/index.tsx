import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useMaps, useSession } from "@/api/hooks";
import { AppHeader } from "@/components/app-header";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useShellStrings } from "@/i18n/shell";
import type { Session } from "@/model/types";
import { MapsList } from "./maps-list";
import { MapsTable } from "./maps-table";
import { DEFAULT_SORT, foldForSearch, matchesSearch, nextSort, type Sort, sortMaps } from "./model";
import { NewMapPanel } from "./new-map";
import { NarrowNotes, Rail, UsageReadout, usageTone } from "./rail";
import type { Body, Item } from "./rows";
import { useArchiveActions } from "./use-archive";

const TOUCH_BUTTON = "max-md:h-10 max-md:px-4 max-md:text-base";

/** True from the tablet width up, where the maps are a table; below it they are a list. */
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

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function WorkspaceScreen({ session }: { session: Session }) {
  const t = useShellStrings();
  const [params, setParams] = useSearchParams();
  const archivedView = params.get("view") === "archived";
  const query = params.get("q") ?? "";
  const wantsNew = params.get("new") === "1";

  const active = useMaps({ archived: false });
  const archived = useMaps({ archived: true });
  const list = archivedView ? archived : active;
  const actions = useArchiveActions();
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const isTable = useIsTableWidth();

  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);

  const canCreate = session.capabilities.includes("map:create");
  const full = usageTone(session) === "full";

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value === null) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const folded = foldForSearch(query);
  const total = list.data?.length ?? null;

  const body = useMemo<Body>(() => {
    if (list.isPending) return { kind: "loading" };
    if (list.isError) {
      return { kind: "error", error: list.error, errorAt: list.errorUpdatedAt, fetching: list.isFetching, onRetry: () => void list.refetch() };
    }
    const present = new Set(list.data.map((map) => map.id));
    const items: Item[] = list.data.map((map) => {
      const outcome = actions.outcomes[map.id];
      return { map, present: true, pending: actions.pending[map.id], outcome: outcome?.view === archivedView ? outcome : undefined };
    });
    for (const outcome of Object.values(actions.outcomes)) {
      if (outcome.view === archivedView && !present.has(outcome.map.id)) {
        items.push({ map: outcome.map, present: false, pending: actions.pending[outcome.map.id], outcome });
      }
    }
    if (items.length === 0) return { kind: "empty" };
    const matching = items.filter((item) => matchesSearch(item.map, folded));
    if (matching.length === 0) return { kind: "nomatch", query, onClear: () => setParam("q", null) };
    const order = new Map(sortMaps(matching.map((item) => item.map), sort).map((map, index) => [map.id, index]));
    matching.sort((a, b) => (order.get(a.map.id) ?? 0) - (order.get(b.map.id) ?? 0));
    return { kind: "rows", items: matching };
    // `list` is a new object each render; its fields below are what the body is made from.
  }, [list.isPending, list.isError, list.error, list.errorUpdatedAt, list.isFetching, list.data, list.refetch, actions.outcomes, actions.pending, archivedView, folded, query, sort, setParam]);

  /* With an empty workspace the form already stands where the rows would be, so it is not opened twice. */
  const emptyWithForm = body.kind === "empty" && !archivedView && canCreate && !full;
  const panelOpen = wantsNew && canCreate && !full && !emptyWithForm;

  const openNew = useCallback(() => {
    if (!canCreate || full) return;
    if (emptyWithForm) titleRef.current?.focus();
    else setParam("new", "1");
  }, [canCreate, full, emptyWithForm, setParam]);

  const closeNew = useCallback(() => {
    setParam("new", null);
    newButtonRef.current?.focus();
  }, [setParam]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        openNew();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openNew]);

  const counts = { active: active.data?.length ?? null, archived: archived.data?.length ?? null };
  const shown = body.kind === "rows" ? body.items.filter((item) => item.present).length : 0;

  const empty = emptyWithForm ? (
    <NewMapPanel embedded lead={t.ws.emptyActive} titleRef={titleRef} />
  ) : (
    <p className="px-4 py-5 text-base text-ink-2 md:px-5">{archivedView ? t.ws.emptyArchived : t.ws.emptyActiveReadOnly}</p>
  );

  return (
    <div className="flex h-dvh flex-col bg-page">
      <AppHeader session={session} />
      <div className="flex min-h-0 flex-1">
        <Rail session={session} archivedView={archivedView} counts={counts} canCreate={canCreate} onView={(next) => setParam("view", next ? "archived" : null)} />

        <main className="@container flex min-w-0 flex-1 flex-col overflow-y-auto bg-panel md:overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-2 md:min-h-12 md:px-5">
            <h1 className="font-title text-lg font-medium text-ink">{t.ws.title}</h1>

            <ToggleGroup
              aria-label={t.ws.views}
              spacing={0}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[archivedView ? "archived" : "active"]}
              onSelectionChange={(keys) => setParam("view", [...keys][0] === "archived" ? "archived" : null)}
              className="xl:hidden"
            >
              <ToggleGroupItem id="active" className="gap-1.5 max-md:h-row">
                {t.ws.active}
                <span className="tabular-nums opacity-70">{counts.active ?? ""}</span>
              </ToggleGroupItem>
              <ToggleGroupItem id="archived" className="gap-1.5 max-md:h-row">
                {t.ws.archived}
                <span className="tabular-nums opacity-70">{counts.archived ?? ""}</span>
              </ToggleGroupItem>
            </ToggleGroup>

            <span className="ms-auto flex items-baseline gap-1.5 text-xs text-ink-3 xl:hidden">
              {t.ws.usage}
              <UsageReadout session={session} />
            </span>

            <div className="flex w-full items-center gap-2 md:ms-auto md:w-auto xl:ms-auto">
              {query.length > 0 && total !== null ? (
                <span role="status" className="text-xs tabular-nums text-ink-3 max-md:hidden">
                  {t.ws.matches(shown, total)}
                </span>
              ) : null}
              <div className="relative min-w-0 flex-1 md:w-64 md:flex-none">
                <Icon name="search" size={14} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                <Input
                  ref={searchRef}
                  type="search"
                  dir="auto"
                  value={query}
                  aria-label={t.ws.search}
                  placeholder={t.ws.searchPlaceholder}
                  autoComplete="off"
                  onChange={(event) => setParam("q", event.target.value.length > 0 ? event.target.value : null)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      if (query.length > 0) setParam("q", null);
                      else event.currentTarget.blur();
                    } else if (event.key === "ArrowDown" && firstRowRef.current) {
                      event.preventDefault();
                      firstRowRef.current.focus();
                    }
                  }}
                  className="ps-7 pe-8 max-md:h-10 max-md:text-lg"
                />
                {query.length > 0 ? (
                  <button
                    type="button"
                    aria-label={t.ws.clearSearch}
                    onClick={() => {
                      setParam("q", null);
                      searchRef.current?.focus();
                    }}
                    className="absolute end-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-key text-ink-3 hover:text-ink"
                  >
                    <Icon name="close" size={12} />
                  </button>
                ) : (
                  <Kbd className="absolute end-2 top-1/2 -translate-y-1/2 max-md:hidden">/</Kbd>
                )}
              </div>
              {canCreate ? (
                <Button ref={newButtonRef} className={`gap-2 ${TOUCH_BUTTON}`} isDisabled={full} aria-expanded={emptyWithForm ? undefined : panelOpen} onPress={openNew}>
                  {t.ws.newMap}
                  <Kbd className="border-on-survey/50 text-on-survey max-md:hidden">N</Kbd>
                </Button>
              ) : null}
            </div>
          </div>

          <NarrowNotes session={session} />

          {full && canCreate ? (
            <div className="shrink-0 border-b border-rule px-4 py-2 md:px-5">
              <Notice tone="danger" title={t.ws.fullTitle(session.limits.maxMaps)} className="max-w-2xl">
                {t.ws.fullBody}
              </Notice>
            </div>
          ) : null}

          {panelOpen ? (
            <div className="shrink-0">
              <NewMapPanel embedded={false} titleRef={titleRef} onCancel={closeNew} />
            </div>
          ) : null}

          {isTable ? (
            <MapsTable
              session={session}
              body={body}
              archivedView={archivedView}
              sort={sort}
              onSort={(key) => setSort((current) => nextSort(current, key))}
              actions={actions}
              empty={empty}
              firstRowRef={firstRowRef}
            />
          ) : (
            <MapsList
              session={session}
              body={body}
              archivedView={archivedView}
              sort={sort}
              onSort={(key) => setSort((current) => nextSort(current, key))}
              actions={actions}
              empty={empty}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function Workspace() {
  const session = useSession();

  if (session.isSuccess) return <WorkspaceScreen session={session.data} />;

  if (session.isError && session.error.code === "unauthorised") {
    return <Navigate to="/" replace state={{ notice: session.error.reason }} />;
  }

  return <WorkspacePending />;
}

/** Before the session is known: the same header and columns, with nothing in them yet, or why they could not be filled. */
function WorkspacePending() {
  const t = useShellStrings();
  const session = useSession();
  const isTable = useIsTableWidth();
  const actions = useArchiveActions();
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const body: Body = { kind: "loading" };

  return (
    <div className="flex h-dvh flex-col bg-page">
      <AppHeader />
      <main className="@container flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel md:overflow-hidden">
        <div className="flex min-h-12 shrink-0 items-center border-b border-rule px-4 md:px-5">
          <h1 className="font-title text-lg font-medium text-ink">{t.ws.title}</h1>
        </div>
        {session.isError ? (
          <div className="max-w-2xl px-4 py-4 md:px-5">
            <Notice
              tone="danger"
              title={t.ws.sessionFailedTitle}
              action={
                <Button variant="outline" className={TOUCH_BUTTON} isDisabled={session.isFetching} onPress={() => void session.refetch()}>
                  {t.ws.retry}
                </Button>
              }
            >
              {session.error.code === "network" ? t.ws.loadNetworkBody : session.error.reason}
            </Notice>
          </div>
        ) : isTable ? (
          <MapsTable session={null} body={body} archivedView={false} sort={DEFAULT_SORT} onSort={() => undefined} actions={actions} empty={null} firstRowRef={firstRowRef} />
        ) : (
          <MapsList session={null} body={body} archivedView={false} sort={DEFAULT_SORT} onSort={() => undefined} actions={actions} empty={null} />
        )}
      </main>
    </div>
  );
}
