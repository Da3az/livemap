import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTheme } from "@/app/providers";
import type { DrawProgress, EditorController, FeatureChange, ToolId } from "@/editor/controller";
import { keyBetween } from "@/model/order";
import type { BasemapStyleId, DashStyle, FillPattern, IconId, LabelLanguage, MapFeature, PaletteSlot } from "@/model/types";
import { basemapTheme } from "@/render/basemap";
import { MapLegend } from "@/render/MapLegend";
import { MapCredits, MapTitleBlock } from "@/render/MapTitleBlock";
import { ScaleBar } from "@/render/ScaleBar";
import { FIXTURE_TIME, FIXTURE_TITLE, FIXTURE_VIEWPORT, fixtureFeatures, fixtureSettings } from "./fixtures";
import { stressFeatures } from "./fixtures-stress";
import { loseContextBriefly, runPanMeasure, runTimeFilterMeasure } from "./harness-tools";
import { createMapLibreController } from "./maplibre-controller";
import { createMockController } from "./mock-controller";
import { allCoordinates } from "./edit";

/**
 * The map engine on its own: every feature kind, every tool and every
 * controller option, with a small stand-in for the document store. A
 * developer page; it is also what the engine is checked against by screenshot.
 */

const TOOLS: ToolId[] = ["select", "area", "line", "arrow", "frontline", "point", "annotation"];
const BASEMAPS: BasemapStyleId[] = ["positron", "bright", "liberty", "dark", "fiord"];
const LANGUAGES: LabelLanguage[] = ["en", "ar", "local"];
const SLOTS: PaletteSlot[] = [1, 2, 3, 4, 5, 6, 7, 8];
const PATTERNS: FillPattern[] = ["none", "hatch", "cross", "dots"];
const DASHES: Exclude<DashStyle, object>[] = ["solid", "dashed", "dotted"];
const SYMBOLS: (IconId | "number")[] = ["pin", "strike", "hospital", "shelter", "number"];
const EXPORT_SIZES = [
  { id: "16:9", width: 1200, height: 675 },
  { id: "4:5", width: 1080, height: 1350 },
  { id: "1:1", width: 1080, height: 1080 },
];
const TIME_STEPS = 288;
/** The editor's list pane, inspector and dock plus timeline, as the harness's stand-in insets. */
const HARNESS_INSETS = { top: 0, bottom: 96, start: 288, end: 316 };
const TIME_WINDOW_HOURS = 12;

interface DrawStyle {
  slot: PaletteSlot;
  pattern: FillPattern;
  dash: Exclude<DashStyle, object>;
  head: "none" | "single" | "double";
  tapered: boolean;
  toothShape: "triangle" | "semicircle";
  facing: "left" | "right";
  symbol: IconId | "number";
}

/** The style the next drawn shape gets, as the union of fields each tool reads. */
function toDrawDefaults(style: DrawStyle, tool: ToolId): Partial<MapFeature> {
  const color = { slot: style.slot };
  const stroke = { color, width: tool === "area" ? 2 : 3, opacity: 1, dash: style.dash };
  switch (tool) {
    case "area":
      return { kind: "area", fill: { color, opacity: 0.35, pattern: style.pattern }, stroke };
    case "line":
      return { kind: "line", stroke };
    case "arrow":
      return { kind: "arrow", stroke: { ...stroke, width: 4 }, head: style.head, tapered: style.tapered };
    case "frontline":
      return { kind: "frontline", stroke, toothShape: style.toothShape, facing: style.facing };
    case "point":
      return { kind: "point", color, symbol: style.symbol === "number" ? { number: "7" } : { icon: style.symbol } };
    default:
      return {};
  }
}

function applyChange(features: MapFeature[], change: FeatureChange): MapFeature[] {
  const removed = new Set(change.delete);
  const replaced = new Map(change.put.map((feature) => [feature.id, feature]));
  const kept = features.filter((feature) => !removed.has(feature.id)).map((feature) => replaced.get(feature.id) ?? feature);
  const known = new Set(features.map((feature) => feature.id));
  return [...kept, ...change.put.filter((feature) => !known.has(feature.id))];
}

function timeWindowAt(step: number): { from: string; to: string } {
  const start = Date.parse(FIXTURE_TIME.from);
  const span = Date.parse(FIXTURE_TIME.to) - start;
  const to = start + (span * step) / TIME_STEPS;
  return { from: new Date(to - TIME_WINDOW_HOURS * 3_600_000).toISOString(), to: new Date(to).toISOString() };
}

function formatMeasure(progress: DrawProgress | null): string {
  if (!progress) return "not drawing";
  const parts = [`${progress.tool}: ${progress.points} points`];
  if (progress.lengthMetres !== null) parts.push(`${(progress.lengthMetres / 1000).toFixed(2)} km`);
  if (progress.areaSquareMetres !== null) parts.push(`${(progress.areaSquareMetres / 1_000_000).toFixed(2)} km²`);
  if (progress.canFinish) parts.push("can finish");
  return parts.join(" · ");
}

/* ----------------------------------------------------------------- controls */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-rule px-3 py-2.5">
      <h2 className="mb-1.5 text-2xs font-semibold tracking-wide text-plum uppercase">{title}</h2>
      <div className="flex flex-wrap gap-1">{children}</div>
    </section>
  );
}

function Press({ label, onPress, pressed, disabled }: { label: string; onPress: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={pressed}
      disabled={disabled}
      className={`h-field rounded-field border px-2 text-xs font-medium disabled:opacity-50 ${
        pressed ? "border-survey bg-survey text-on-survey" : "border-rule-strong bg-panel text-ink hover:bg-well"
      }`}
    >
      {label}
    </button>
  );
}

function Choice<T extends string | number>({ name, options, value, onChange }: { name: string; options: readonly T[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-1">
      {options.map((option) => (
        <Press key={option} label={String(option)} pressed={option === value} onPress={() => onChange(option)} />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- page */

export default function EngineHarness() {
  const { mode: theme, setChoice: setTheme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const [controller, setController] = useState<EditorController | null>(null);

  const [engine, setEngine] = useState<"maplibre" | "mock">("maplibre");
  const [interactive, setInteractive] = useState(true);
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  const [basemap, setBasemap] = useState<{ styleId: BasemapStyleId; labelLanguage: LabelLanguage }>({ styleId: "positron", labelLanguage: "en" });
  const [features, setFeatures] = useState<MapFeature[]>(fixtureFeatures);
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<ToolId>("select");
  const [reshaping, setReshaping] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(true);
  /* Stands in for the editor's panes: 288 at the start, 316 at the end, the dock and timeline below. */
  const [insetsOn, setInsetsOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [drawStyle, setDrawStyle] = useState<DrawStyle>({ slot: 1, pattern: "none", dash: "solid", head: "single", tapered: false, toothShape: "triangle", facing: "left", symbol: "pin" });
  const [timeStep, setTimeStep] = useState<number | null>(null);
  const [exportSize, setExportSize] = useState("16:9");
  const [exportRatio, setExportRatio] = useState<1 | 2>(1);
  const [exportFurniture, setExportFurniture] = useState(true);
  const [exportTheme, setExportTheme] = useState<"light" | "dark" | undefined>(undefined);
  const [exported, setExported] = useState<{ url: string; bytes: number; width: number; height: number } | null>(null);
  const [exporting, setExporting] = useState(false);

  const [progress, setProgress] = useState<DrawProgress | null>(null);
  const [pointer, setPointer] = useState("");
  const [resolution, setResolution] = useState(0);
  const [zoom, setZoom] = useState(FIXTURE_VIEWPORT.zoom);
  const [log, setLog] = useState<string[]>([]);
  const [measured, setMeasured] = useState("");
  const [gestures, setGestures] = useState({ updates: 0, commits: 0 });

  const [longLegend, setLongLegend] = useState(false);
  const settings = useMemo(() => {
    const base = { ...fixtureSettings(dir), basemap };
    if (!longLegend) return base;
    /* Fifteen rows, each a single feature, to see the key wrap on an exported image. */
    const items = fixtureFeatures()
      .filter((feature) => feature.kind !== "annotation")
      .slice(0, 15)
      .map((feature) => ({ ref: { featureId: feature.id }, label: feature.label ?? feature.name, hidden: false }));
    return { ...base, legend: { ...base.legend, items } };
  }, [dir, basemap, longLegend]);
  const title = FIXTURE_TITLE[dir];
  const note = useCallback((line: string) => setLog((lines) => [line, ...lines].slice(0, 14)), []);

  /* Read by the effect that creates the controller, which must not re-run when these change. */
  const latest = useRef({ settings, features, theme, dir, title });
  latest.current = { settings, features, theme, dir, title };

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const initial = latest.current;
    const factory = engine === "mock" ? createMockController : createMapLibreController;
    const created = factory({ container: element, viewport: FIXTURE_VIEWPORT, ...initial, interactive });
    const off = [
      created.on("ready", () => note("ready")),
      created.on("change", (change) => {
        setFeatures((current) => applyChange(current, change));
        setGestures((count) => (change.gesture === "commit" ? { ...count, commits: count.commits + 1 } : { ...count, updates: count.updates + 1 }));
        if (change.gesture === "commit") {
          const points = change.put.map((feature) => allCoordinates(feature).length).join("/");
          note(`change commit: put ${change.put.length}${points ? ` (${points} points)` : ""}, delete ${change.delete.length}`);
        }
      }),
      created.on("select", (ids, mode) => {
        setSelection((current) => {
          if (mode === "replace") return ids;
          if (mode === "add") return [...new Set([...current, ...ids])];
          return [...current.filter((id) => !ids.includes(id)), ...ids.filter((id) => !current.includes(id))];
        });
        note(`select ${mode}: ${ids.join(", ") || "nothing"}`);
      }),
      created.on("tool", (next) => {
        setTool(next);
        note(`tool: ${next}`);
      }),
      created.on("reshape", (id) => {
        setReshaping(id);
        note(`reshape: ${id ?? "off"}`);
      }),
      created.on("draw", setProgress),
      created.on("pointer", (info) => setPointer(info.at ? `${info.at[0].toFixed(4)}, ${info.at[1].toFixed(4)}${info.hitIds[0] ? ` · over ${info.hitIds[0]}` : ""}` : "")),
      created.on("viewport", (viewport) => {
        setZoom(viewport.zoom);
        setResolution(created.getResolution());
      }),
      created.on("problem", (problem) => note(`problem ${problem.code}: ${problem.detail}`)),
    ];
    setResolution(created.getResolution());
    setController(created);
    return () => {
      for (const unsubscribe of off) unsubscribe();
      created.destroy();
      setController(null);
    };
  }, [engine, interactive, note]);

  useEffect(() => controller?.setFeatures(features), [controller, features]);
  useEffect(() => controller?.setSettings(settings), [controller, settings]);
  useEffect(() => controller?.setTheme(theme), [controller, theme]);
  useEffect(() => controller?.setDir(dir), [controller, dir]);
  useEffect(() => controller?.setDocument({ title }), [controller, title]);
  useEffect(() => controller?.setSelection(selection), [controller, selection]);
  useEffect(() => controller?.setTool(tool), [controller, tool]);
  useEffect(() => controller?.setReshaping(reshaping), [controller, reshaping]);
  useEffect(() => controller?.setSnapping(snapping), [controller, snapping]);
  useEffect(() => controller?.setRendering(!paused), [controller, paused]);
  useEffect(() => controller?.setInsets(insetsOn ? HARNESS_INSETS : { top: 0, bottom: 0, start: 0, end: 0 }), [controller, insetsOn]);
  useEffect(() => controller?.setDrawDefaults(toDrawDefaults(drawStyle, tool)), [controller, drawStyle, tool]);
  useEffect(() => controller?.setTimeFilter(timeStep === null ? null : timeWindowAt(timeStep)), [controller, timeStep]);

  const updateSelected = (change: (feature: MapFeature) => MapFeature) =>
    setFeatures((current) => current.map((feature) => (selection.includes(feature.id) ? change(feature) : feature)));

  const reorderSelected = (where: "front" | "back") => {
    const orders = features.map((feature) => feature.order).sort();
    const first = orders[0] ?? null;
    const last = orders[orders.length - 1] ?? null;
    updateSelected((feature) => ({ ...feature, order: where === "front" ? keyBetween(last, null) : keyBetween(null, first) }));
  };

  const runExport = async () => {
    if (!controller) return;
    const size = EXPORT_SIZES.find((candidate) => candidate.id === exportSize) ?? EXPORT_SIZES[0];
    if (!size) return;
    setExporting(true);
    try {
      const blob = await controller.exportImage({ width: size.width, height: size.height, pixelRatio: exportRatio, furniture: exportFurniture, ...(exportTheme ? { theme: exportTheme } : {}) });
      setExported((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { url: URL.createObjectURL(blob), bytes: blob.size, width: size.width * exportRatio, height: size.height * exportRatio };
      });
      note(`export: ${blob.size} bytes`);
    } catch (error) {
      note(`export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const measureTimeFilter = () => {
    if (!controller) return;
    runTimeFilterMeasure(controller, (step) => timeWindowAt(step % TIME_STEPS), (result) => {
      setMeasured(`${features.length} features · ${result}`);
      setTimeStep(null);
    });
  };
  const measurePan = () => {
    if (controller) runPanMeasure(controller, (result) => setMeasured(`${features.length} features · ${result}`));
  };
  const loseContext = () => loseContextBriefly(container.current);

  const selected = features.find((feature) => feature.id === selection[0]);
  const legendCorner = { "top-start": "top-3 start-3", "top-end": "top-3 end-3", "bottom-start": "bottom-24 start-3", "bottom-end": "bottom-24 end-3" }[settings.legend.position];

  return (
    <div className="flex h-dvh bg-page font-ui text-sm text-ink">
      <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-e border-rule bg-panel">
        <header className="border-b border-rule px-3 py-2.5">
          <h1 className="font-title text-lg font-semibold">Map engine harness</h1>
          <p className="text-xs text-ink-3 tabular-nums">
            {features.length} features · {selection.length} selected · zoom {zoom.toFixed(2)}
          </p>
          <p data-gestures className="text-xs text-ink-3 tabular-nums">
            {gestures.updates} updates · {gestures.commits} commits reported
          </p>
          <p data-readout className="text-xs text-ink-2 tabular-nums">
            {formatMeasure(progress)}
            {pointer && ` · ${pointer}`}
          </p>
        </header>

        <Section title="Tool">
          <Choice name="Tool" options={TOOLS} value={tool} onChange={setTool} />
          <Press label="Finish" onPress={() => controller?.finish()} disabled={!progress?.canFinish} />
          <Press label="Cancel" onPress={() => controller?.cancel()} />
          <Press label="Snapping" pressed={snapping} onPress={() => setSnapping((on) => !on)} />
        </Section>

        <Section title="Selection">
          <Press label="Reshape" pressed={reshaping !== null} disabled={selection.length !== 1 && reshaping === null} onPress={() => setReshaping(reshaping === null ? (selection[0] ?? null) : null)} />
          <Press label="To front" disabled={selection.length === 0} onPress={() => reorderSelected("front")} />
          <Press label="To back" disabled={selection.length === 0} onPress={() => reorderSelected("back")} />
          <Press label="Lock" disabled={selection.length === 0} onPress={() => updateSelected((feature) => ({ ...feature, locked: !feature.locked }))} />
          <Press label="Hide" disabled={selection.length === 0} onPress={() => updateSelected((feature) => ({ ...feature, hidden: true }))} />
          <Press label="Delete" disabled={selection.length === 0} onPress={() => setFeatures((current) => current.filter((feature) => !selection.includes(feature.id)))} />
          <Press label="Fit selection" disabled={selection.length === 0} onPress={() => controller?.fitFeatures(selection)} />
          <Press label="Select none" onPress={() => setSelection([])} />
        </Section>

        <Section title="Next shape">
          <Choice name="Colour slot" options={SLOTS} value={drawStyle.slot} onChange={(slot) => setDrawStyle((style) => ({ ...style, slot }))} />
          <Choice name="Pattern" options={PATTERNS} value={drawStyle.pattern} onChange={(pattern) => setDrawStyle((style) => ({ ...style, pattern }))} />
          <Choice name="Dash" options={DASHES} value={drawStyle.dash} onChange={(dash) => setDrawStyle((style) => ({ ...style, dash }))} />
          <Choice name="Arrow head" options={["none", "single", "double"] as const} value={drawStyle.head} onChange={(head) => setDrawStyle((style) => ({ ...style, head }))} />
          <Press label="Tapered" pressed={drawStyle.tapered} onPress={() => setDrawStyle((style) => ({ ...style, tapered: !style.tapered }))} />
          <Choice name="Teeth" options={["triangle", "semicircle"] as const} value={drawStyle.toothShape} onChange={(toothShape) => setDrawStyle((style) => ({ ...style, toothShape }))} />
          <Choice name="Facing" options={["left", "right"] as const} value={drawStyle.facing} onChange={(facing) => setDrawStyle((style) => ({ ...style, facing }))} />
          <Choice name="Point symbol" options={SYMBOLS} value={drawStyle.symbol} onChange={(symbol) => setDrawStyle((style) => ({ ...style, symbol }))} />
        </Section>

        <Section title="Appearance">
          <Choice name="Theme" options={["light", "dark"] as const} value={theme} onChange={setTheme} />
          <Choice name="Direction" options={["ltr", "rtl"] as const} value={dir} onChange={setDir} />
        </Section>

        <Section title="Basemap">
          <Choice name="Basemap" options={BASEMAPS} value={basemap.styleId} onChange={(styleId) => setBasemap((current) => ({ ...current, styleId }))} />
          <Choice name="Label language" options={LANGUAGES} value={basemap.labelLanguage} onChange={(labelLanguage) => setBasemap((current) => ({ ...current, labelLanguage }))} />
        </Section>

        <Section title="View">
          <Press label="Fit all" onPress={() => controller?.fitFeatures()} />
          <Press label="Opening view" onPress={() => controller?.setViewport(FIXTURE_VIEWPORT)} />
          <Press label="Zoom in" onPress={() => controller?.setViewport({ zoom: zoom + 1 }, { animate: true })} />
          <Press label="Zoom out" onPress={() => controller?.setViewport({ zoom: zoom - 1 }, { animate: true })} />
          <Press label="Rotate 30°" onPress={() => controller?.setViewport({ bearing: controller.getViewport().bearing + 30 })} />
          <Press label="Pitch 45°" onPress={() => controller?.setViewport({ pitch: controller.getViewport().pitch === 45 ? 0 : 45 })} />
          <Press label="Pane insets" pressed={insetsOn} onPress={() => setInsetsOn((on) => !on)} />
          <Press label="Paused" pressed={paused} onPress={() => setPaused((on) => !on)} />
          <Press label="Lose context" onPress={loseContext} />
        </Section>

        <Section title="Time">
          <Press label="All time" pressed={timeStep === null} onPress={() => setTimeStep(null)} />
          <label className="flex w-full flex-col gap-1 text-xs text-ink-2 tabular-nums">
            {timeStep === null ? "No filter" : `${TIME_WINDOW_HOURS} h window ending ${timeWindowAt(timeStep).to.slice(0, 16).replace("T", " ")} UTC`}
            <input type="range" min={0} max={TIME_STEPS} value={timeStep ?? TIME_STEPS} onChange={(event) => setTimeStep(Number(event.target.value))} aria-label="Time filter" className="w-full accent-plum" />
          </label>
        </Section>

        <Section title="Export">
          <Choice name="Export size" options={EXPORT_SIZES.map((size) => size.id)} value={exportSize} onChange={setExportSize} />
          <Choice name="Pixel ratio" options={[1, 2] as const} value={exportRatio} onChange={setExportRatio} />
          <Press label="Furniture" pressed={exportFurniture} onPress={() => setExportFurniture((on) => !on)} />
          <Press label="Long legend" pressed={longLegend} onPress={() => setLongLegend((on) => !on)} />
          <Press label="Export dark" pressed={exportTheme === "dark"} onPress={() => setExportTheme((value) => (value === "dark" ? undefined : "dark"))} />
          <Press label="Export light" pressed={exportTheme === "light"} onPress={() => setExportTheme((value) => (value === "light" ? undefined : "light"))} />
          <Press label={exporting ? "Exporting…" : "Export PNG"} disabled={exporting || !controller} onPress={() => void runExport()} />
          {exported && (
            <a href={exported.url} download="livemap-export.png" data-export-result className="block w-full text-xs text-bathy underline tabular-nums">
              <img src={exported.url} alt="The exported map" className="mb-1 w-full rounded-key border border-rule-strong" />
              {exported.width} × {exported.height} px · {(exported.bytes / 1024).toFixed(0)} KB
            </a>
          )}
        </Section>

        <Section title="Engine">
          <Choice name="Controller" options={["maplibre", "mock"] as const} value={engine} onChange={setEngine} />
          <Press label="Interactive" pressed={interactive} onPress={() => setInteractive((on) => !on)} />
          <Press label="Fixture" onPress={() => setFeatures(fixtureFeatures())} />
          <Press label="500 features" onPress={() => setFeatures(stressFeatures(500))} />
          <Press label="500 labelled" onPress={() => setFeatures(stressFeatures(500, { labelled: true }))} />
          <Press label="Measure pan" onPress={measurePan} />
          <Press label="Measure time filter" onPress={measureTimeFilter} />
          {measured && (
            <p data-measured className="w-full text-xs text-ink-2 tabular-nums">
              {measured}
            </p>
          )}
        </Section>

        {selected && (
          <Section title="Selected feature">
            <pre data-selected-feature className="max-h-40 w-full overflow-auto rounded-field bg-well p-2 font-ui text-2xs whitespace-pre-wrap text-ink-2 tabular-nums">
              {JSON.stringify(selected, null, 1)}
            </pre>
          </Section>
        )}

        <section className="px-3 py-2.5">
          <h2 className="mb-1.5 text-2xs font-semibold tracking-wide text-plum uppercase">Events</h2>
          <ol data-event-log className="flex flex-col gap-0.5 text-xs text-ink-2">
            {log.map((line, index) => (
              <li key={`${log.length - index}-${line}`} className="break-words">
                {line}
              </li>
            ))}
          </ol>
        </section>
      </aside>

      <main dir={dir} className="relative min-w-0 flex-1">
        {/* MapLibre makes its container `position: relative`, so the positioning lives on a wrapper. */}
        <div className="absolute inset-0">
          <div ref={container} data-engine-map className="size-full" />
        </div>
        <div className="pointer-events-none absolute start-3 top-3">
          <MapTitleBlock title={title} settings={settings} dir={dir} />
        </div>
        <div className={`pointer-events-none absolute ${legendCorner}`}>
          <MapLegend settings={settings} features={features} theme={basemapTheme(basemap.styleId, theme)} dir={dir} />
        </div>
        <div className="pointer-events-none absolute start-3 bottom-3">
          <MapCredits settings={settings} dir={dir} />
        </div>
        <div className="pointer-events-none absolute end-3 bottom-10">
          <ScaleBar metresPerPixel={resolution} dir={dir} />
        </div>
        {insetsOn ? (
          <>
            <div data-inset="start" className="pointer-events-none absolute inset-y-0 start-0 w-list border-e-2 border-dashed border-plum" />
            <div data-inset="end" className="pointer-events-none absolute inset-y-0 end-0 w-inspector border-s-2 border-dashed border-plum" />
            <div data-inset="bottom" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 border-t-2 border-dashed border-plum" />
          </>
        ) : null}
      </main>
    </div>
  );
}
