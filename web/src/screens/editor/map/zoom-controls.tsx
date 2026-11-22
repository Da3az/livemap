import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatShortcut, shortcutFor, useEditorStore } from "@/editor/store";
import { useEditorStrings } from "@/i18n/editor";
import { useEditorRuntime } from "../runtime";
import { isMac } from "../shared/format";
import { useEditorLayout } from "../shared/layout";
import { Tip } from "../shared/tip";
import { LiveScaleBar } from "./furniture";
import { Icon, type IconName } from "@/components/icons";

/** A pan button moves the view by this share of the map's width or height. */
const PAN_SHARE = 1 / 3;

/**
 * Up, down, left and right, and the opening view in the middle: the map can be
 * moved without dragging (WCAG 2.2, 2.5.7). Compass directions, so the pad is
 * never mirrored: west stays on the left in the right-to-left editor.
 */
function PanPad() {
  const t = useEditorStrings();
  const { controller } = useEditorRuntime();
  const { touch } = useEditorLayout();
  const opening = useEditorStore((state) => state.doc.settings.openingView);
  const cell = cn("rounded-none border-0", touch ? "size-11" : "size-7");
  const button = (label: string, icon: IconName, onPress: () => void) => (
    <Button variant="ghost" className={cell} aria-label={label} isDisabled={controller === null} onPress={onPress}>
      <Icon name={icon} size={14} />
    </Button>
  );
  return (
    <div role="group" aria-label={t.map.panGroup} dir="ltr" className="pointer-events-auto grid grid-cols-3 overflow-hidden rounded-key border border-rule-strong bg-panel">
      <span aria-hidden="true" />
      {button(t.map.panNorth, "panUp", () => controller?.panBy(0, -PAN_SHARE))}
      <span aria-hidden="true" />
      {button(t.map.panWest, "panLeft", () => controller?.panBy(-PAN_SHARE, 0))}
      {button(t.map.openingView, "recentre", () => controller?.setViewport(opening, { animate: true }))}
      {button(t.map.panEast, "panRight", () => controller?.panBy(PAN_SHARE, 0))}
      <span aria-hidden="true" />
      {button(t.map.panSouth, "panDown", () => controller?.panBy(0, PAN_SHARE))}
      <span aria-hidden="true" />
    </div>
  );
}

/** Zoom in, zoom out and fit everything, with the scale bar beneath. Map furniture: small and hard-edged. */
export function ZoomControls({ bottom }: { bottom: number }) {
  const t = useEditorStrings();
  const { controller } = useEditorRuntime();
  const { touch } = useEditorLayout();
  const zoom = useEditorStore((state) => state.live.viewport?.zoom ?? state.doc.settings.openingView.zoom);
  const hasFeatures = useEditorStore((state) => state.doc.features.size > 0);
  const step = (by: number): void => controller?.setViewport({ zoom: zoom + by }, { animate: true });
  const square = cn("rounded-none border-0 text-base font-semibold", touch ? "size-11" : "size-field");

  return (
    <div className="pointer-events-none absolute end-3 z-10 flex flex-col items-end gap-2" style={{ bottom }}>
      <div className="pointer-events-auto flex flex-col divide-y divide-rule-strong overflow-hidden rounded-key border border-rule-strong bg-panel">
        <Button variant="ghost" className={square} aria-label={t.map.zoomIn} isDisabled={controller === null} onPress={() => step(1)}>
          +
        </Button>
        <Button variant="ghost" className={square} aria-label={t.map.zoomOut} isDisabled={controller === null} onPress={() => step(-1)}>
          −
        </Button>
      </div>
      <PanPad />
      <Tip label={t.map.fitTip} keys={formatShortcut(shortcutFor("view.zoomToFit")?.keys ?? "", isMac())}>
        <Button
          variant="outline"
          className={cn("pointer-events-auto rounded-key px-2 text-xs", touch ? "h-11" : "h-field")}
          isDisabled={controller === null || !hasFeatures}
          onPress={() => controller?.fitFeatures()}
        >
          {t.map.fit}
        </Button>
      </Tip>
      <LiveScaleBar />
    </div>
  );
}
