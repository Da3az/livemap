import { cn } from "cn";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { formatCoordinates, useEditorStoreApi, useRetryCountdown, type Refusal } from "@/editor/store";
import { useExtrasStrings, type ExtrasStrings } from "@/i18n/editor-extras";
import { useEditorRuntime } from "../../runtime";
import { IconButton } from "../shared/controls";
import { flyTo, usePlaceResults, type PlaceHit, type PlaceResults } from "./results";

function refusalText(refusal: Refusal, t: ExtrasStrings["place"]): string {
  if (refusal.code === "read_only") return t.refusedReadOnly;
  if (refusal.code === "feature_limit") return t.refusedLimit(refusal.max);
  return t.refusedOther;
}

/** The line under a place's name: where coordinates came from, or the country, and always the coordinates. */
export function PlaceMeta({ hit, t }: { hit: PlaceHit; t: ExtrasStrings["place"] }) {
  const origin = hit.source === "link" ? t.fromLink : hit.source === "coordinates" ? t.pasted : hit.context;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-2xs text-ink-3">
      <span className="truncate">{origin}</span>
      {hit.source === "gazetteer" ? (
        <span dir="ltr" className="shrink-0 tabular-nums">
          {formatCoordinates(hit.at, 3)}
        </span>
      ) : null}
    </span>
  );
}

function Status({ results, query, t }: { results: PlaceResults; query: string; t: ExtrasStrings["place"] }) {
  const seconds = useRetryCountdown(results.status === "rate_limited" ? results.retryAt : null);
  const retry = (
    <Button variant="outline" size="sm" onPress={results.retry} isDisabled={results.status === "rate_limited" && seconds > 0}>
      {t.retry}
    </Button>
  );
  let body: ReactNode = null;
  if (results.status === "short") body = <p className="px-2 py-1.5 text-xs text-ink-3">{t.short}</p>;
  else if (results.status === "searching" && results.hits.length === 0) body = <p className="px-2 py-1.5 text-xs text-ink-3">{t.searching}</p>;
  else if (results.status === "empty") {
    body = (
      <div className="px-2 py-1.5">
        <p className="text-sm font-semibold text-ink">{t.noMatch(query)}</p>
        <p className="mt-1 text-xs text-ink-2">{t.accepted}</p>
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-2">
          {t.formats.map((format) => (
            <li key={format.example} className="flex items-baseline justify-between gap-3">
              <span>{format.name}</span>
              <span dir="ltr" className="text-ink tabular-nums">
                {format.example}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (results.status === "rate_limited") {
    body = (
      <Notice tone="warning" title={t.rateLimited} action={retry} className="m-1">
        {seconds > 0 ? t.retryIn(seconds) : t.retryNow}
      </Notice>
    );
  } else if (results.status === "offline") {
    body = (
      <Notice tone="danger" title={t.offline} action={retry} className="m-1">
        {t.offlineHelp}
      </Notice>
    );
  } else if (results.status === "error") {
    body = (
      <Notice tone="danger" title={t.failed} action={retry} className="m-1">
        {t.offlineHelp}
      </Notice>
    );
  }
  return (
    <div role="status" aria-live="polite">
      {body}
    </div>
  );
}

/**
 * One field at the top of the map: a place name in Arabic or English, pasted
 * coordinates, or a Google Maps link. A result flies the map there, or is
 * dropped on the map as an icon carrying the place's name.
 */
export function PlaceSearch() {
  const store = useEditorStoreApi();
  const { controller } = useEditorRuntime();
  const t = useExtrasStrings().place;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [outcome, setOutcome] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const results = usePlaceResults(query);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const hits = results.hits;
  const current = hits[Math.min(active, hits.length - 1)];
  const showPanel = open && (query.trim() !== "" || outcome !== null);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) === false) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const go = (hit: PlaceHit): void => {
    flyTo(controller, hit);
    setOutcome(null);
    setOpen(false);
  };

  const add = (hit: PlaceHit): void => {
    const result = store.addPlace({ name: hit.name, at: hit.at });
    if (result.ok) {
      flyTo(controller, hit);
      setOutcome({ tone: "success", text: t.added(hit.name.value) });
    } else {
      setOutcome({ tone: "danger", text: refusalText(result.refusal, t) });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (hits.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (Math.min(index, hits.length - 1) + step + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      if (current === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) add(current);
      else go(current);
    } else if (event.key === "Escape") {
      if (!showPanel && query === "") return;
      event.preventDefault();
      event.stopPropagation();
      if (showPanel) setOpen(false);
      else setQuery("");
      setOutcome(null);
    }
  };

  return (
    <div ref={root} data-place-search className="relative w-full">
      <div className="flex h-row items-center gap-1.5 rounded-field border border-rule-strong bg-panel ps-2 pe-1 shadow-overlay outline-offset-1 outline-focus focus-within:outline-2">
        <Icon name="search" size={14} className="shrink-0 text-ink-3" />
        <input
          ref={input}
          role="combobox"
          aria-label={t.label}
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && current !== undefined ? `${listId}-${Math.min(active, hits.length - 1)}` : undefined}
          dir="auto"
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={t.placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOutcome(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
        {query !== "" ? (
          <IconButton
            icon="close"
            label={t.clear}
            onPress={() => {
              setQuery("");
              setOutcome(null);
              input.current?.focus();
            }}
          />
        ) : null}
      </div>

      {showPanel ? (
        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-block border border-rule-strong bg-panel shadow-overlay">
          <ul id={listId} role="listbox" aria-label={t.results} className="flex max-h-72 flex-col overflow-y-auto p-1 empty:hidden">
            {hits.map((hit, index) => {
              const isActive = index === Math.min(active, hits.length - 1);
              return (
                <li
                  key={hit.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isActive}
                  onPointerMove={() => setActive(index)}
                  onClick={() => go(hit)}
                  className={cn("flex cursor-default items-center gap-2 rounded-key py-1 ps-2 pe-1", isActive && "bg-well")}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span dir={hit.name.dir} className="truncate text-start text-sm font-medium text-ink tabular-nums">
                      {hit.name.value}
                    </span>
                    <PlaceMeta hit={hit} t={t} />
                  </span>
                  <button
                    type="button"
                    tabIndex={-1}
                    data-add-as-icon
                    onClick={(event) => {
                      event.stopPropagation();
                      add(hit);
                    }}
                    className="flex h-6 shrink-0 items-center gap-1 rounded-field border border-rule-strong bg-panel px-1.5 text-xs font-medium text-ink hover:bg-rule"
                  >
                    <Icon name="point" size={12} className="text-plum" />
                    {t.addAsIcon}
                  </button>
                </li>
              );
            })}
          </ul>
          <Status results={results} query={query.trim()} t={t} />
          {outcome !== null ? (
            <p role="status" className={cn("border-t border-rule px-3 py-1.5 text-xs font-medium", outcome.tone === "success" ? "text-success" : "text-danger")}>
              {outcome.text}
            </p>
          ) : null}
          {hits.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule px-3 py-1.5 text-2xs text-ink-3">
              <span className="flex items-center gap-1">
                <Kbd>Enter</Kbd>
                {t.hintGo}
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Shift+Enter</Kbd>
                {t.hintAdd}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
