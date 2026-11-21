import type { ToolId } from "@/editor/controller";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/editor/store";
import { useLang } from "@/i18n";
import { useEditorStrings, type EditorStrings } from "@/i18n/editor";
import { useEditorRuntime } from "../runtime";
import { formatArea, formatLength } from "../shared/format";
import { useEditorLayout } from "../shared/layout";

function hintFor(t: EditorStrings["draw"], tool: ToolId, points: number, canFinish: boolean): string {
  if (tool === "point") return t.placeIcon;
  if (tool === "annotation") return t.placeText;
  if (points === 0) return tool === "arrow" ? t.startArrow : tool === "area" ? t.startArea : t.startLine;
  if (!canFinish) return t.addPoints;
  return tool === "area" ? t.closeArea : t.finishLine;
}

/**
 * What the active drawing tool expects next, the length and area so far, and
 * Finish and Cancel — which a touch screen has no keys for.
 */
export function DrawProgress() {
  const t = useEditorStrings();
  const lang = useLang();
  const { controller } = useEditorRuntime();
  const { touch } = useEditorLayout();
  const tool = useEditorStore((state) => state.tool);
  const draw = useEditorStore((state) => state.live.draw);
  if (tool === "select") return null;
  const points = draw?.points ?? 0;
  const size = touch ? "touch" : "sm";
  const drawing = draw !== null && points > 0;

  return (
    <div
      role="status"
      className="pointer-events-auto flex min-h-8 max-w-full items-center gap-3 rounded-pill border border-rule-strong bg-panel py-1 ps-3.5 pe-1.5 text-xs shadow-dock"
    >
      <span className="min-w-0 truncate font-medium text-ink">{hintFor(t.draw, tool, points, draw?.canFinish ?? false)}</span>
      {drawing ? (
        <span className="flex shrink-0 items-center gap-2 text-ink-2 tabular-nums">
          <span>{t.draw.points(points)}</span>
          {draw.lengthMetres !== null && draw.lengthMetres > 0 ? <span>{formatLength(draw.lengthMetres, lang)}</span> : null}
          {draw.areaSquareMetres !== null && draw.areaSquareMetres > 0 ? <span>{formatArea(draw.areaSquareMetres, lang)}</span> : null}
        </span>
      ) : null}
      {drawing ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button size={size} className="rounded-pill" isDisabled={!draw.canFinish} onPress={() => controller?.finish()}>
            {t.draw.finish}
          </Button>
          <Button size={size} variant="ghost" className="rounded-pill" onPress={() => controller?.cancel()}>
            {t.draw.cancel}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
