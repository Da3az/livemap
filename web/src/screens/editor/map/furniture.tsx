import { cn } from "cn";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon } from "@/components/icons";
import { selectDrawOrder, selectLegend, shallowEqual, useEditorStore } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import { MapLegend } from "@/render/MapLegend";
import { MapCredits } from "@/render/MapTitleBlock";
import { ScaleBar } from "@/render/ScaleBar";
import { useEditorRuntime } from "../runtime";
import { useMapTheme } from "../shared/palette";
import { useEditorUi, type FurniturePart } from "../shared/ui";

const GAP = 8;

/**
 * How many of `blocks`, taken in order of importance, fit in `container`
 * one above the other. The first always counts. Blocks that do not fit stay
 * in the document, invisible and out of flow, so they can be measured again
 * when there is more room.
 */
function useFit(container: RefObject<HTMLElement | null>, blocks: RefObject<HTMLElement | null>[], layout: string): number {
  const [fit, setFit] = useState(blocks.length);
  useLayoutEffect(() => {
    const box = container.current;
    if (!box) return undefined;
    const measure = (): void => {
      let used = 0;
      let count = 0;
      for (const block of blocks) {
        const height = block.current?.offsetHeight ?? 0;
        if (height === 0) {
          count += 1;
          continue;
        }
        if (count > 0 && used + GAP + height > box.clientHeight) break;
        used += (used > 0 ? GAP : 0) + height;
        count += 1;
      }
      setFit(count);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    for (const block of blocks) if (block.current) observer.observe(block.current);
    measure();
    return () => observer.disconnect();
    /* The refs are stable; `layout` changes when the blocks themselves are swapped. */
  }, [container, layout]);
  return fit;
}

/**
 * Which part of the furniture the pointer is over, if any. The furniture
 * never takes pointer events from the map, so this watches the pointer
 * instead: a part the author is working under steps aside.
 */
function usePartUnderPointer(parts: Record<FurniturePart, RefObject<HTMLElement | null>>): FurniturePart | null {
  const [under, setUnder] = useState<FurniturePart | null>(null);
  useEffect(() => {
    let frame = 0;
    let x = 0;
    let y = 0;
    const check = (): void => {
      frame = 0;
      let found: FurniturePart | null = null;
      for (const part of Object.keys(parts) as FurniturePart[]) {
        const rect = parts[part].current?.getBoundingClientRect();
        if (rect && rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) found = part;
      }
      setUnder(found);
    };
    const move = (event: PointerEvent): void => {
      x = event.clientX;
      y = event.clientY;
      if (frame === 0) frame = window.requestAnimationFrame(check);
    };
    const leave = (): void => setUnder(null);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
    /* The refs are stable. */
  }, []);
  return under;
}

/**
 * One part of the furniture as it will publish. While the author draws, or
 * works with the pointer over it, it fades nearly away and offers to fold;
 * the fold button is also reachable from the keyboard.
 */
function Block({
  part,
  innerRef,
  shown,
  faded,
  children,
}: {
  part: FurniturePart;
  innerRef: RefObject<HTMLDivElement | null>;
  shown: boolean;
  faded: "drawing" | "pointer" | null;
  children: ReactNode;
}) {
  const t = useEditorStrings();
  const ui = useEditorUi();
  const name = t.map.parts[part];
  return (
    <div ref={innerRef} data-label-obstacle aria-hidden={shown ? undefined : true} className={cn("group/block relative max-w-full", !shown && "invisible absolute")}>
      <div className={cn("transition-opacity duration-200 motion-reduce:transition-none", faded === "drawing" ? "opacity-10" : faded === "pointer" ? "opacity-20" : "opacity-100")}>
        {children}
      </div>
      <button
        type="button"
        aria-label={t.map.fold(name)}
        title={t.map.fold(name)}
        onClick={() => ui.setFurniture({ ...ui.furniture, folded: { ...ui.furniture.folded, [part]: true } })}
        className={cn(
          "pointer-events-auto absolute end-1 top-1 flex h-field items-center gap-1 rounded-key border border-rule-strong bg-panel px-2 text-xs font-medium text-ink shadow-dock transition-opacity duration-100 focus-visible:opacity-100",
          faded === "pointer" ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <Icon name="chevronDown" size={12} className="rotate-180" />
        {t.map.foldShort}
      </button>
    </div>
  );
}

/** A folded part: one line at its corner, which opens the part again. */
function Tab({ part, children }: { part: FurniturePart; children: ReactNode }) {
  const t = useEditorStrings();
  const ui = useEditorUi();
  const name = t.map.parts[part];
  return (
    <button
      type="button"
      data-label-obstacle
      aria-label={t.map.unfold(name)}
      title={t.map.unfold(name)}
      onClick={() => ui.setFurniture({ ...ui.furniture, folded: { ...ui.furniture.folded, [part]: false } })}
      className="pointer-events-auto flex max-w-64 items-baseline gap-2 rounded-key border border-rule-strong bg-panel px-3 py-1 text-start text-ink hover:border-ink-3"
    >
      {children}
    </button>
  );
}

function KeyHeading() {
  const t = useEditorStrings();
  const title = useEditorStore((state) => state.doc.settings.legend.title);
  const count = useEditorStore((state) => selectLegend(state).filter((entry) => !entry.hidden).length);
  return (
    <>
      <span dir={title.dir} className="truncate font-title text-base font-semibold">
        {title.value.trim() === "" ? t.map.key : title.value}
      </span>
      <span className="shrink-0 font-ui text-xs text-ink-3 tabular-nums">{t.map.keyEntries(count)}</span>
    </>
  );
}

/** What stands in for the key when the map area is too short to show it whole. */
function FoldedKey() {
  const t = useEditorStrings();
  return (
    <div data-label-obstacle title={t.map.keyFoldedHint} className="flex items-baseline gap-2 rounded-key border border-rule-strong bg-panel px-3 py-1.5 text-ink">
      <KeyHeading />
    </div>
  );
}

/**
 * The published map's furniture, drawn by the same components the reader's
 * view uses, so the author sees the key and credits as they
 * will be. It is display only: settings are changed in the map settings pane.
 *
 * It keeps out of the author's way three ways: any part folds to a one-line
 * tab, every part fades while a shape is being drawn or the pointer is over
 * it, and the status bar switches all of it between "as published", "folded"
 * and "hidden" in one press.
 *
 * `bottom` is how far up the bottom corners start, to stand clear of the dock.
 * When the map area is too short for all of it, the credits go first and the
 * key folds to its heading. The map's title is not drawn here: readers get
 * it above the map, and the top bar already shows it.
 */
export function Furniture({ bottom }: { bottom: number }) {
  const t = useEditorStrings();
  const ui = useEditorUi();
  const { settings, dir } = useEditorStore(
    (state) => ({ settings: state.doc.settings, dir: state.doc.uiDir }),
    shallowEqual,
  );
  const features = useEditorStore(selectDrawOrder);
  /* Drawing a shape or reshaping one: the whole furniture steps aside until the gesture is over. */
  const drawing = useEditorStore((state) => state.live.draw !== null || state.view.reshapingId !== null);
  const theme = useMapTheme();
  const corner = settings.legend.position;
  const startSide = corner === "top-start" || corner === "bottom-start";
  const { folded } = ui.furniture;

  const startColumn = useRef<HTMLDivElement>(null);
  const endColumn = useRef<HTMLDivElement>(null);
  const startKeyRef = useRef<HTMLDivElement>(null);
  const creditsRef = useRef<HTMLDivElement>(null);
  const endKeyRef = useRef<HTMLDivElement>(null);
  const none = useRef<HTMLDivElement>(null);
  /* The first block always counts as fitting, so an empty one leads: then the key can fold too. */
  const noneStart = useRef<HTMLDivElement>(null);
  const layout = `${corner}-${folded.key}-${folded.credits}`;
  const startFit = useFit(startColumn, [noneStart, startKeyRef, creditsRef], layout);
  const endFit = useFit(endColumn, [none, endKeyRef], layout);
  const under = usePartUnderPointer({ key: startSide ? startKeyRef : endKeyRef, credits: creditsRef });
  const faded = (part: FurniturePart): "drawing" | "pointer" | null => (drawing ? "drawing" : under === part ? "pointer" : null);

  if (ui.furniture.hidden) return null;

  const legend = <MapLegend settings={settings} features={features} theme={theme} dir={dir} />;
  const keyFor = (ref: RefObject<HTMLDivElement | null>, fits: boolean) =>
    folded.key ? (
      <Tab part="key">
        <KeyHeading />
      </Tab>
    ) : (
      <>
        <Block part="key" innerRef={ref} shown={fits} faded={faded("key")}>
          {legend}
        </Block>
        {fits ? null : <FoldedKey />}
      </>
    );
  const startKey = startSide ? keyFor(startKeyRef, startFit >= 2) : null;
  const column = "pointer-events-none absolute top-14 z-10 flex w-80 max-w-full flex-col justify-between gap-2";

  return (
    <>
      <div ref={startColumn} className={cn(column, "start-3 items-start")} style={{ bottom }}>
        <div className="flex max-w-full flex-col items-start gap-2">
          {corner === "top-start" ? startKey : null}
        </div>
        <div className="flex max-w-full flex-col items-start gap-2">
          {corner === "bottom-start" ? startKey : null}
          {folded.credits ? (
            <Tab part="credits">
              <span className="text-xs text-ink-2">{t.map.parts.credits}</span>
            </Tab>
          ) : (
            <Block part="credits" innerRef={creditsRef} shown={startFit >= 3} faded={faded("credits")}>
              <MapCredits settings={settings} dir={dir} />
            </Block>
          )}
        </div>
      </div>
      {startSide ? null : (
        <div ref={endColumn} className={cn(column, "end-16 items-end", corner === "bottom-end" && "justify-end")} style={{ bottom }}>
          {keyFor(endKeyRef, endFit >= 2)}
        </div>
      )}
    </>
  );
}

/** The scale bar for the view on screen. */
export function LiveScaleBar() {
  const { controller } = useEditorRuntime();
  const dir = useEditorStore((state) => state.doc.uiDir);
  /* Read on every viewport change; the value itself comes from the engine. */
  useEditorStore((state) => state.live.viewport);
  const ready = useEditorStore((state) => state.live.ready);
  if (controller === null || !ready) return null;
  return <ScaleBar metresPerPixel={controller.getResolution()} dir={dir} />;
}
