import { cn } from "cn";
import { useEffect, useState } from "react";
import { selectCounts, selectVisibleAtPlayhead, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useLang } from "@/i18n";
import { useEditorStrings } from "@/i18n/editor";
import { useEditorRuntime } from "../runtime";
import { formatInteger, formatLngLat } from "../shared/format";
import { useEditorLayout } from "../shared/layout";
import { FURNITURE_FOLDED, FURNITURE_HIDDEN, FURNITURE_PUBLISHED, useEditorUi } from "../shared/ui";

/** CSS pixels per metre of screen, for the representative fraction. */
const PIXELS_PER_METRE = 96 / 0.0254;

function roundScale(value: number): number {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return Math.round(value / magnitude) * magnitude;
}

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("flex items-baseline gap-1.5 whitespace-nowrap", className)}>
      <span className="text-ink-3">{label}</span>
      <span className="font-medium text-ink-2 tabular-nums">{children}</span>
    </span>
  );
}

/** Pointer coordinates that copy on click. With no pointer over the map, the centre of the view. */
function Coordinates({ height }: { height: string }) {
  const t = useEditorStrings();
  const pointer = useEditorStore((state) => state.live.pointer?.at ?? null);
  const centre = useEditorStore((state) => state.live.viewport?.center ?? state.doc.settings.openingView.center);
  const [copied, setCopied] = useState(false);
  const at = pointer ?? centre;
  const text = formatLngLat(at);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = (): void => {
    void navigator.clipboard.writeText(`${at[1].toFixed(5)}, ${at[0].toFixed(5)}`).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={t.status.copyHint}
      className={cn("flex min-w-56 items-center gap-1.5 rounded-key px-1.5 text-start whitespace-nowrap hover:bg-well", height)}
    >
      <span className="text-ink-3">{pointer ? t.status.pointer : t.status.centre}</span>
      <span dir="ltr" className="font-medium text-ink-2 tabular-nums">
        {text}
      </span>
      <span role="status" className="text-success">
        {copied ? t.status.copied : ""}
      </span>
    </button>
  );
}

/**
 * One press to see the map exactly as it will publish, one to fold every part
 * to a tab, one to put it all away. When parts were folded one by one, none
 * of the three is pressed.
 */
function FurnitureSwitch({ height }: { height: string }) {
  const t = useEditorStrings();
  const ui = useEditorUi();
  const views = { published: FURNITURE_PUBLISHED, folded: FURNITURE_FOLDED, hidden: FURNITURE_HIDDEN } as const;
  const { hidden, folded } = ui.furniture;
  const all = Object.values(folded);
  const current = hidden ? "hidden" : all.every(Boolean) ? "folded" : all.some(Boolean) ? null : "published";
  return (
    <span role="group" aria-label={t.status.furniture} title={t.status.furnitureHint} className="flex items-center gap-1 whitespace-nowrap max-md:hidden">
      <span className="px-1 text-ink-3 max-lg:hidden">{t.status.furniture}</span>
      {(Object.keys(views) as (keyof typeof views)[]).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={current === view}
          onClick={() => ui.setFurniture(views[view])}
          className={cn(
            "rounded-key px-1.5 font-medium text-ink-2 hover:bg-well aria-pressed:bg-ink aria-pressed:text-panel",
            height,
          )}
        >
          {t.status.furnitureViews[view]}
        </button>
      ))}
    </span>
  );
}

/** The readouts along the bottom: where the pointer is, zoom and scale, how much is on the map, and what the map is set to. */
export function StatusBar() {
  const t = useEditorStrings();
  const lang = useLang();
  const store = useEditorStoreApi();
  const { controller } = useEditorRuntime();
  const { touch } = useEditorLayout();
  const zoom = useEditorStore((state) => state.live.viewport?.zoom ?? state.doc.settings.openingView.zoom);
  const ready = useEditorStore((state) => state.live.ready);
  const counts = useEditorStore(selectCounts);
  const visible = useEditorStore(selectVisibleAtPlayhead);
  const snapping = useEditorStore((state) => state.view.snapping);
  const labels = useEditorStore((state) => state.doc.settings.basemap.labelLanguage);
  const readOnly = useEditorStore((state) => state.access.readOnly !== null);
  const penMode = useEditorStore((state) => state.view.penMode);
  const penOn = penMode === "on";
  const height = touch ? "h-11" : "h-6";
  const scale = controller && ready ? roundScale(controller.getResolution() * PIXELS_PER_METRE) : null;

  return (
    <footer className={cn("flex shrink-0 items-center gap-4 overflow-hidden border-t border-rule bg-panel ps-1.5 pe-3 text-xs", touch ? "h-11" : "h-7")}>
      <Coordinates height={height} />
      <Cell label={t.status.zoom}>{zoom.toFixed(1)}</Cell>
      {scale ? (
        <Cell label={t.status.scale} className="max-md:hidden">
          <span dir="ltr">1:{formatInteger(scale, lang)}</span>
        </Cell>
      ) : null}
      <span className="ms-auto flex items-center gap-4">
        <span className={cn("font-medium whitespace-nowrap tabular-nums", counts.limit.status === "ok" ? "text-ink-2" : "text-warning")}>
          {counts.limit.status === "ok" ? t.status.features(counts.features) : t.status.featuresOfLimit(counts.features, counts.limit.max)}
          {counts.hidden > 0 ? <span className="text-ink-3"> · {t.status.hidden(counts.hidden)}</span> : null}
          {visible.outsideTime > 0 ? <span className="text-ink-3"> · {t.status.outsideTime(visible.outsideTime)}</span> : null}
        </span>
        <Cell label={t.status.labels} className="max-lg:hidden">
          {t.status.labelLanguage[labels]}
        </Cell>
        <FurnitureSwitch height={height} />
        {/* Pen mode turns itself on at the first stylus contact; it shows from then on, or wherever a finger is the pointer. */}
        {touch || penMode !== "auto" ? (
          <button
            type="button"
            aria-pressed={penOn}
            disabled={readOnly}
            title={penOn ? t.dock.penOn : t.dock.penOff}
            onClick={() => store.setPenMode(penOn ? "off" : "on")}
            className={cn("flex items-center gap-1.5 rounded-key px-1.5 whitespace-nowrap hover:bg-well disabled:pointer-events-none", height)}
          >
            <span className="text-ink-3">{t.dock.pen}</span>
            <span className="font-medium text-ink-2">{penOn ? t.status.on : t.status.off}</span>
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={snapping}
          disabled={readOnly}
          onClick={() => store.setSnapping(!snapping)}
          className={cn("flex items-center gap-1.5 rounded-key px-1.5 whitespace-nowrap hover:bg-well disabled:pointer-events-none", height)}
        >
          <span className="text-ink-3">{t.status.snapping}</span>
          <span className="font-medium text-ink-2">{snapping ? t.status.on : t.status.off}</span>
        </button>
      </span>
    </footer>
  );
}
