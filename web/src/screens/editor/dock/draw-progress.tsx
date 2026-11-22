import { useEffect, useRef, useState } from "react";
import type { ToolId } from "@/editor/controller";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/editor/store";
import { useLang } from "@/i18n";
import { useEditorStrings, type EditorStrings } from "@/i18n/editor";
import { useEditorRuntime } from "../runtime";
import { formatArea, formatLength } from "../shared/format";
import { useEditorLayout } from "../shared/layout";

const ARROW_HINT_KEY = "livemap.hint.arrow-drag";

/** The arrow tool says once that a drag draws an arrow; after that the plain hint is enough. */
function arrowHintSeen(): boolean {
  try {
    return window.localStorage.getItem(ARROW_HINT_KEY) !== null;
  } catch {
    return true;
  }
}

function rememberArrowHint(): void {
  try {
    window.localStorage.setItem(ARROW_HINT_KEY, "1");
  } catch {
    /* Shown again next time. */
  }
}

interface Situation {
  tool: ToolId;
  points: number;
  canFinish: boolean;
  touch: boolean;
  crosshair: boolean;
  arrowHint: boolean;
}

function hintFor(t: EditorStrings["draw"], s: Situation): string {
  const single = s.tool === "point" || s.tool === "annotation";
  if (s.crosshair) return single ? t.crosshairPlace : t.crosshairHint;
  if (s.tool === "point") return t.placeIcon;
  if (s.tool === "annotation") return t.placeText;
  if (s.points === 0) {
    if (s.tool === "arrow") return s.arrowHint ? t.arrowDragHint : t.startArrow;
    return s.tool === "area" ? t.startArea : t.startLine;
  }
  if (!s.canFinish) return t.addPoints;
  if (s.tool === "area") return s.touch ? t.closeAreaTouch : t.closeArea;
  return s.touch ? t.finishLineTouch : t.finishLine;
}

/**
 * What the active drawing tool expects next, the length and area so far, and
 * the buttons a touch screen or a keyboard has no gesture for: Finish and
 * Cancel, and with keyboard placement Add point and Undo point. What happens
 * during keyboard placement is also said aloud, in the map's language.
 */
export function DrawProgress() {
  const t = useEditorStrings();
  const lang = useLang();
  const { controller } = useEditorRuntime();
  const { touch } = useEditorLayout();
  const tool = useEditorStore((state) => state.tool);
  const draw = useEditorStore((state) => state.live.draw);
  const crosshair = useEditorStore((state) => state.live.crosshair);
  const featureCount = useEditorStore((state) => state.doc.features.size);
  const [arrowHint, setArrowHint] = useState(() => !arrowHintSeen());
  const announcement = useAnnouncement(t.draw.announce, crosshair, draw?.points ?? 0, draw !== null, featureCount);

  /* Shown until the arrow tool is first left; remembered from then on. */
  useEffect(() => {
    if (tool !== "arrow" || !arrowHint) return undefined;
    rememberArrowHint();
    return () => setArrowHint(false);
  }, [tool, arrowHint]);

  const announcer = (
    <span aria-live="polite" className="sr-only">
      {announcement}
    </span>
  );
  /* The live region stays mounted whatever the tool, or a change of tool would swallow what it was saying. */
  if (tool === "select") return <>{announcer}</>;
  const points = draw?.points ?? 0;
  const size = touch ? "touch" : "sm";
  const drawing = draw !== null && points > 0;
  const single = tool === "point" || tool === "annotation";

  return (
    <>
      {announcer}
      <div className="pointer-events-auto flex min-h-8 max-w-full items-center gap-3 rounded-pill border border-rule-strong bg-panel py-1 ps-3.5 pe-1.5 text-xs shadow-dock">
        <span role="status" className="min-w-0 truncate font-medium text-ink">
          {hintFor(t.draw, {
            tool,
            points,
            canFinish: draw?.canFinish ?? false,
            touch,
            crosshair,
            arrowHint,
          })}
        </span>
        {drawing ? (
          <span className="flex shrink-0 items-center gap-2 text-ink-2 tabular-nums">
            <span>{t.draw.points(points)}</span>
            {draw.lengthMetres !== null && draw.lengthMetres > 0 ? <span>{formatLength(draw.lengthMetres, lang)}</span> : null}
            {draw.areaSquareMetres !== null && draw.areaSquareMetres > 0 ? <span>{formatArea(draw.areaSquareMetres, lang)}</span> : null}
          </span>
        ) : null}
        <span className="flex shrink-0 items-center gap-1">
          {crosshair ? (
            <>
              <Button size={size} className="rounded-pill" onPress={() => controller?.placeAtCrosshair()}>
                {single ? t.draw.placeHere : t.draw.addPoint}
              </Button>
              {single ? null : (
                <Button
                  size={size}
                  variant="outline"
                  className="rounded-pill"
                  isDisabled={!drawing}
                  onPress={() => controller?.undoPoint()}
                >
                  {t.draw.undoPoint}
                </Button>
              )}
            </>
          ) : (
            <Button size={size} variant="ghost" className="rounded-pill" onPress={() => controller?.setCrosshair(true)}>
              {t.draw.useKeyboard}
            </Button>
          )}
          {drawing ? (
            <>
              <Button
                size={size}
                variant={crosshair ? "outline" : "default"}
                className="rounded-pill"
                isDisabled={!draw.canFinish}
                onPress={() => controller?.finish()}
              >
                {t.draw.finish}
              </Button>
              <Button size={size} variant="ghost" className="rounded-pill" onPress={() => controller?.cancel()}>
                {t.draw.cancel}
              </Button>
            </>
          ) : crosshair ? (
            <Button size={size} variant="ghost" className="rounded-pill" onPress={() => controller?.setCrosshair(false)}>
              {t.draw.cancel}
            </Button>
          ) : null}
        </span>
      </div>
    </>
  );
}

/**
 * What keyboard placement just did, as one sentence for the live region: a
 * point added or taken back, the shape finished or the drawing cancelled.
 * Quiet unless keyboard placement is, or was just, on.
 */
function useAnnouncement(
  t: EditorStrings["draw"]["announce"],
  crosshair: boolean,
  points: number,
  drawing: boolean,
  features: number,
): string {
  const [message, setMessage] = useState("");
  const last = useRef({ crosshair, points, drawing, features });
  useEffect(() => {
    const before = last.current;
    last.current = { crosshair, points, drawing, features };
    if (!crosshair && !before.crosshair) return;
    /* A finished shape can also end keyboard placement, when the tool goes back to Select: say what was made. */
    if (features > before.features) setMessage(t.finished);
    else if (before.drawing && !drawing) setMessage(t.cancelled);
    else if (crosshair !== before.crosshair) setMessage(crosshair ? t.on : t.off);
    else if (points > before.points) setMessage(t.added(points));
    else if (points < before.points) setMessage(t.removed(points));
  }, [t, crosshair, points, drawing, features]);
  return message;
}
