import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import type { EditorController } from "@/editor/controller";
import { formatCoordinates, useEditorStore, useEditorStoreApi } from "@/editor/store";
import { useExtrasStrings } from "@/i18n/editor-extras";
import type { LngLat, Viewport } from "@/model/types";
import { lngLatToMerc, mercToLngLat } from "@/render/geo";
import { useEditorRuntime } from "../../runtime";
import { Row, Section, Toggle } from "../shared/controls";

/** Nominal sizes of the published map in an article, in CSS pixels. The embed itself is responsive. */
const FRAMES = [
  { id: "desktop", width: 1200, height: 675 },
  { id: "phone", width: 390, height: 520 },
] as const;

/** The corners of what a frame of this size shows when it opens on `view`. */
function frameCorners(view: Viewport, width: number, height: number): LngLat[] {
  const centre = lngLatToMerc(view.center);
  const world = 512 * 2 ** view.zoom;
  const halfX = width / 2 / world;
  const halfY = height / 2 / world;
  return [
    mercToLngLat({ x: centre.x - halfX, y: centre.y - halfY }),
    mercToLngLat({ x: centre.x + halfX, y: centre.y - halfY }),
    mercToLngLat({ x: centre.x + halfX, y: centre.y + halfY }),
    mercToLngLat({ x: centre.x - halfX, y: centre.y + halfY }),
  ];
}

/** The opening extent drawn over the editor's map: a desktop frame and a phone frame around the opening centre. */
function OpeningFrame({ controller, view }: { controller: EditorController; view: Viewport }) {
  const t = useExtrasStrings().settings.view;
  const { portalContainer } = useEditorRuntime();
  /* Re-render as the map moves; the positions themselves come from the controller. */
  useEditorStore((state) => state.live.viewport);
  const target = portalContainer?.closest("[data-editor-root]")?.querySelector("[data-editor-map]") ?? null;
  if (target === null) return null;

  return createPortal(
    <div data-opening-frame className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <svg aria-hidden="true" className="absolute inset-0 size-full">
        {FRAMES.map((frame) => {
          const points = frameCorners(view, frame.width, frame.height).map((corner) => controller.project(corner));
          return (
            <polygon
              key={frame.id}
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
              className="fill-none stroke-plum"
              strokeWidth={frame.id === "desktop" ? 1.5 : 1}
              strokeDasharray={frame.id === "desktop" ? "6 4" : "2 3"}
            />
          );
        })}
      </svg>
      {FRAMES.map((frame) => {
        const corner = frameCorners(view, frame.width, frame.height)[0];
        if (corner === undefined) return null;
        const at = controller.project(corner);
        return (
          <span
            key={frame.id}
            style={{ left: Math.max(4, at.x), top: Math.max(18, at.y) }}
            className="absolute -translate-y-full rounded-key bg-plum px-1 text-2xs font-medium whitespace-nowrap text-panel tabular-nums"
          >
            {t.frames[frame.id]} {frame.width} × {frame.height}
          </span>
        );
      })}
    </div>,
    target,
  );
}

function sameView(a: Viewport, b: Viewport | null): boolean {
  if (b === null) return false;
  return Math.abs(a.zoom - b.zoom) < 0.01 && Math.abs(a.center[0] - b.center[0]) < 1e-4 && Math.abs(a.center[1] - b.center[1]) < 1e-4;
}

/** What readers open on: the stored centre and zoom, and the ways to set it from the map on screen. */
export function OpeningViewSection({ disabled }: { disabled: boolean }) {
  const store = useEditorStoreApi();
  const { controller } = useEditorRuntime();
  const t = useExtrasStrings().settings.view;
  const view = useEditorStore((state) => state.doc.settings.openingView);
  const current = useEditorStore((state) => state.live.viewport);
  const [frame, setFrame] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => () => pending.current?.(), []);

  /* Fitting animates, so the view to keep is the one the map settles on. */
  const fitAll = (): void => {
    if (controller === null) return;
    pending.current?.();
    let timer = 0;
    const settle = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        cancel();
        store.setOpeningView(controller.getViewport());
      }, 400);
    };
    const off = controller.on("viewport", settle);
    const cancel = (): void => {
      window.clearTimeout(timer);
      off();
      pending.current = null;
    };
    pending.current = cancel;
    controller.fitFeatures();
    settle();
  };

  const matches = sameView(view, current);

  return (
    <Section id="view" title={t.heading}>
      <div className="flex flex-col text-sm">
        <Row label={t.centre}>
          <span dir="ltr" data-opening-centre className="font-medium text-ink tabular-nums">
            {formatCoordinates(view.center, 4)}
          </span>
        </Row>
        <Row label={t.zoom}>
          <span data-opening-zoom className="font-medium text-ink tabular-nums">
            {view.zoom.toFixed(1)}
          </span>
        </Row>
      </div>
      <p className="text-xs text-ink-3">{matches ? t.matches : t.differs}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          isDisabled={disabled || controller === null || matches}
          onPress={() => controller !== null && store.setOpeningView(controller.getViewport())}
        >
          {t.useCurrent}
        </Button>
        <Button variant="outline" size="sm" isDisabled={disabled || controller === null} onPress={fitAll}>
          {t.fitAll}
        </Button>
        <Button variant="ghost" size="sm" isDisabled={controller === null || matches} onPress={() => controller?.setViewport(view, { animate: true })}>
          {t.goThere}
        </Button>
      </div>
      <Toggle checked={frame} disabled={controller === null} onChange={setFrame}>
        {t.showFrame}
      </Toggle>
      {frame ? <p className="text-xs text-ink-3">{t.frameHint}</p> : null}
      {frame && controller !== null ? <OpeningFrame controller={controller} view={view} /> : null}
    </Section>
  );
}
