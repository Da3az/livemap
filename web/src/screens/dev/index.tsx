import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { MockControl } from "@/api/mock/control";
import { CATALOGUE, directionsOf, HEIGHTS, recipeFor, stateUrl, WIDTHS } from "./catalogue";
import { describeStep, runSteps, waitForPage, type StepReport } from "./runner";
import type { Dir, ScreenDef, StateDef, Step, Theme, Width } from "./types";

/**
 * /dev/states — every screen in every state, each reachable by link and
 * viewable in place, one iframe at a time (browsers cap live WebGL contexts).
 * States that need interaction are driven inside the iframe by the same
 * steps `scripts/screenshots.mjs` runs.
 */

const THEME_KEY = "livemap.theme";
const NO_STEPS: readonly Step[] = [];

interface Entry {
  screen: ScreenDef;
  state: StateDef;
  key: string;
}

const ENTRIES: Entry[] = CATALOGUE.flatMap((screen) => screen.states.map((state) => ({ screen, state, key: `${screen.id}/${state.id}` })));

function isWidth(value: number): value is Width {
  return WIDTHS.some((width) => width === value);
}

/* ------------------------------------------------------- frame realm */

type FrameWindow = Window & typeof globalThis;
type Importer = (path: string) => Promise<unknown>;

/** `import()` evaluated in the iframe's realm, so modules resolve to the iframe's instances. */
function importIn(win: FrameWindow): Importer {
  const make = new win.Function("path", "return import(path)") as Importer;
  return (path) => make(path);
}

function hasKey<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

async function frameMock(win: FrameWindow): Promise<MockControl> {
  const module = await importIn(win)("/src/api/mock/index.ts").catch(() => null);
  if (!hasKey(module, "mockControl")) throw new Error("the mock control is reachable only from the dev server");
  return module.mockControl as MockControl;
}

async function frameServer(win: FrameWindow): Promise<{ publishMap: (id: string) => unknown }> {
  const module = await importIn(win)("/src/api/mock/server.ts").catch(() => null);
  if (!hasKey(module, "server") || !hasKey(module.server, "publishMap") || typeof module.server.publishMap !== "function") {
    throw new Error("the mock server is reachable only from the dev server");
  }
  const server = module.server;
  const publish = module.server.publishMap;
  return { publishMap: (id) => publish.call(server, id) };
}

/* ---------------------------------------------------------- controls */

function Segmented<T extends string | number>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      <span className="text-xs text-ink-3">{label}</span>
      <span className="flex rounded-field border border-rule">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className="h-field px-2 text-xs tabular-nums text-ink-2 first:rounded-s-field last:rounded-e-field hover:bg-well focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40 aria-checked:bg-ink aria-checked:text-panel"
          >
            {option.label}
          </button>
        ))}
      </span>
    </div>
  );
}

function StepsReadout({ steps, report }: { steps: readonly Step[]; report: StepReport | null }) {
  if (steps.length === 0) return <span className="text-xs text-ink-3">No steps: the URL alone reaches this state.</span>;
  let line: ReactNode;
  if (report === null) line = <span className="text-ink-3">Steps waiting for the page…</span>;
  else if (report.phase === "running") line = <span className="text-warning">Steps running: {report.index + 1} of {report.total} · {describeStep(report.step)}</span>;
  else if (report.phase === "done") line = <span className="text-success">Steps done: {report.total} of {report.total}</span>;
  else
    line = (
      <span className="text-danger">
        Failed at step {report.index + 1} of {report.total} ({describeStep(report.step)}): {report.message}
      </span>
    );
  return (
    <span role="status" className="text-xs">
      {line}
    </span>
  );
}

/* ------------------------------------------------------------ viewer */

interface ViewerProps {
  entry: Entry;
  width: Width;
  dir: Dir;
  theme: Theme;
  run: number;
}

function Viewer({ entry, width, dir, theme, run }: ViewerProps) {
  const recipe = recipeFor(entry.state, dir);
  const steps = recipe.steps ?? NO_STEPS;
  const height = HEIGHTS[width];
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [report, setReport] = useState<StepReport | null>(null);

  const src = useMemo(() => {
    const url = stateUrl(recipe);
    /* The embed takes its theme from the reader's system or from ?theme=; the app shell from storage. */
    return entry.screen.id === "embed" ? `${url}&theme=${theme}` : url;
  }, [recipe, entry.screen.id, theme]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(() => {
      const fit = Math.min(1, (box.clientWidth - 16) / width, (box.clientHeight - 16) / height);
      setScale(Math.max(0.2, fit));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [width, height]);

  /* The theme reaches the app through its stored choice, read once when it starts. Put the gallery's own choice back once it has. */
  useEffect(() => {
    let previous: string | null = null;
    try {
      previous = window.localStorage.getItem(THEME_KEY);
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable: the frame follows the system */
    }
    const frame = frameRef.current;
    if (!frame) return undefined;
    const controller = new AbortController();
    setReport(null);
    const restore = () => {
      try {
        if (previous === null) window.localStorage.removeItem(THEME_KEY);
        else window.localStorage.setItem(THEME_KEY, previous);
      } catch {
        /* nothing to put back */
      }
    };
    const onLoad = () => {
      const win = frame.contentWindow as FrameWindow | null;
      if (!win) return;
      void (async () => {
        try {
          await waitForPage(win, undefined);
          restore();
          if (controller.signal.aborted) return;
          await waitForPage(win, recipe.ready);
          if (steps.length === 0 || controller.signal.aborted) return;
          await runSteps(win, steps, { mock: () => frameMock(win), server: () => frameServer(win), signal: controller.signal, onReport: (next) => !controller.signal.aborted && setReport(next) });
        } catch (error) {
          restore();
          if (!controller.signal.aborted) setReport({ phase: "failed", index: 0, total: steps.length, step: steps[0] ?? { do: "wait", ms: 0 }, message: error instanceof Error ? error.message : String(error) });
        }
      })();
    };
    frame.addEventListener("load", onLoad, { once: true });
    return () => {
      controller.abort();
      frame.removeEventListener("load", onLoad);
      restore();
    };
    // `src` and `run` decide when the frame reloads; the recipe is part of `src`.
  }, [src, run, theme, recipe.ready, steps]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-row shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-3 py-1">
        <StepsReadout steps={steps} report={report} />
        <span className="ms-auto text-xs tabular-nums text-ink-3">
          {width} × {height} at {Math.round(scale * 100)}%
        </span>
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden bg-well">
        <div className="absolute top-2 start-2" style={{ width, height, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <iframe
            key={`${src}#${run}`}
            ref={frameRef}
            title={`${entry.screen.title}: ${entry.state.title}`}
            src={src}
            width={width}
            height={height}
            className="block border border-rule-strong bg-panel"
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- index */

function matches(entry: Entry, query: string): boolean {
  if (query === "") return true;
  const recipe = entry.state.ltr;
  const haystack = [entry.screen.title, entry.state.id, entry.state.title, entry.state.how, recipe.path, entry.state.rtl?.path ?? ""].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

function stepsSummary(steps: readonly Step[] | undefined): string {
  if (!steps || steps.length === 0) return "";
  return steps.map(describeStep).join(" → ");
}

export default function DevStates() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [screenFilter, setScreenFilter] = useState<string>("all");
  const [run, setRun] = useState(0);

  const selectedKey = params["*"] ?? "";
  const selected = ENTRIES.find((entry) => entry.key === selectedKey && !entry.state.linkOnly) ?? null;
  const widthParam = Number(search.get("w") ?? 1440);
  const width: Width = isWidth(widthParam) ? widthParam : 1440;
  const theme: Theme = search.get("theme") === "dark" ? "dark" : "light";
  const dirs = selected ? directionsOf(selected.state) : (["ltr"] as Dir[]);
  const dir: Dir = search.get("dir") === "rtl" && dirs.includes("rtl") ? "rtl" : "ltr";

  const setOption = (key: string, value: string) =>
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const shown = ENTRIES.filter((entry) => (screenFilter === "all" || entry.screen.id === screenFilter) && matches(entry, query));
  const counts = CATALOGUE.map((screen) => ({ id: screen.id, title: screen.title, count: screen.states.length }));

  useEffect(() => {
    document.title = selected ? `${selected.key} · states` : "States · livemap dev";
  }, [selected]);

  return (
    <div className="flex h-dvh bg-page font-ui text-sm text-ink">
      <aside className="flex w-1/3 min-w-96 max-w-2xl shrink-0 flex-col border-e border-rule bg-panel">
        <header className="flex shrink-0 flex-col gap-2 border-b border-rule px-3 py-2">
          <div className="flex items-baseline gap-2">
            <h1 className="font-title text-lg font-medium">States</h1>
            <span className="text-xs tabular-nums text-ink-3">
              {shown.length} of {ENTRIES.length}
            </span>
            <span className="ms-auto flex gap-3 text-xs">
              <Link className="text-bathy underline" to="/dev/kit">
                Kit
              </Link>
              <Link className="text-bathy underline" to="/dev/engine?persona=owner">
                Engine
              </Link>
              <Link className="text-bathy underline" to="/dev/extras?persona=owner">
                Extras
              </Link>
            </span>
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter: state, URL switch, step…"
            aria-label="Filter states"
            className="h-field rounded-field border border-rule-strong bg-panel px-2 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-focus"
          />
          <div role="radiogroup" aria-label="Screen" className="flex flex-wrap gap-1">
            {[{ id: "all", title: "All", count: ENTRIES.length }, ...counts].map((screen) => (
              <button
                key={screen.id}
                type="button"
                role="radio"
                aria-checked={screenFilter === screen.id}
                onClick={() => setScreenFilter(screen.id)}
                className="h-field rounded-field border border-rule px-2 text-xs text-ink-2 hover:bg-well focus-visible:outline-2 focus-visible:outline-focus aria-checked:border-ink aria-checked:bg-ink aria-checked:text-panel"
              >
                {screen.title} <span className="tabular-nums opacity-70">{screen.count}</span>
              </button>
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-panel text-start text-ink-3">
              <tr className="border-b border-rule">
                <th className="px-3 py-1 text-start font-medium">Screen</th>
                <th className="px-2 py-1 text-start font-medium">State</th>
                <th className="px-2 py-1 text-start font-medium">How it is reached</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => {
                const current = entry.key === selected?.key;
                const recipe = entry.state.ltr;
                const target = entry.state.linkOnly ? recipe.path : `/dev/states/${entry.key}?${search.toString()}`;
                return (
                  <tr key={entry.key} aria-current={current || undefined} data-current={current || undefined} className="border-b border-rule align-top data-current:bg-selected">
                    <td className="px-3 py-1 text-ink-3">{entry.screen.title}</td>
                    <td className="px-2 py-1">
                      <Link to={target} className="font-medium text-bathy hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                        {entry.state.title}
                      </Link>
                      {entry.state.rtl ? <span className="ms-1 text-ink-3">LTR/RTL</span> : null}
                      {entry.state.linkOnly ? <span className="ms-1 text-ink-3">page</span> : null}
                      {entry.state.blocked ? <span className="ms-1 text-danger">blocked</span> : null}
                    </td>
                    <td className="px-2 py-1 text-ink-2">
                      <div>{entry.state.how}</div>
                      <div className="break-all text-ink-3 tabular-nums">{recipe.path}</div>
                      {recipe.steps?.length ? (
                        <div title={stepsSummary(recipe.steps)} className="line-clamp-1 text-ink-3">
                          {recipe.steps.length} step{recipe.steps.length > 1 ? "s" : ""}: {stepsSummary(recipe.steps)}
                        </div>
                      ) : null}
                      {entry.state.blocked ? <div className="text-danger">{entry.state.blocked}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-topbar shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule bg-panel px-3 py-1.5">
          <h2 className="font-title text-lg font-medium">{selected ? `${selected.screen.title}: ${selected.state.title}` : "Pick a state"}</h2>
          <Segmented label="Width" value={width} options={WIDTHS.map((w) => ({ value: w, label: String(w) }))} onChange={(w) => setOption("w", String(w))} />
          <Segmented
            label="Direction"
            value={dir}
            disabled={dirs.length < 2}
            options={[
              { value: "ltr", label: "LTR" },
              { value: "rtl", label: "RTL" },
            ]}
            onChange={(d) => setOption("dir", d)}
          />
          <Segmented
            label="Theme"
            value={theme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(t) => setOption("theme", t)}
          />
          {selected ? (
            <span className="ms-auto flex items-center gap-3 text-xs">
              <button type="button" onClick={() => setRun((value) => value + 1)} className="h-field rounded-field border border-rule-strong px-2 hover:bg-well focus-visible:outline-2 focus-visible:outline-focus">
                Run again
              </button>
              <a className="text-bathy underline" href={stateUrl(recipeFor(selected.state, dir))} target="_blank" rel="noreferrer">
                Open the page
              </a>
              <button type="button" onClick={() => void navigate(`/dev/states?${search.toString()}`)} className="text-ink-3 hover:text-ink">
                Close
              </button>
            </span>
          ) : null}
        </div>
        {selected?.state.blocked ? (
          <p className="px-3 py-2 text-xs text-danger">Not reachable yet: {selected.state.blocked}</p>
        ) : null}
        {selected ? (
          <Viewer key={`${selected.key}/${width}/${dir}/${theme}`} entry={selected} width={width} dir={dir} theme={theme} run={run} />
        ) : (
          <p className="px-3 py-3 text-sm text-ink-2">Choose a state from the index. Only one is shown at a time, since each live map holds one of the browser's few WebGL contexts.</p>
        )}
      </main>
    </div>
  );
}
