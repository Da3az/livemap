import type { ControllerEvents } from "@/editor/controller";
import type { LngLat } from "@/model/types";
import type { FeatureRenderer } from "@/render/feature-renderer";
import type { MapLibreMap } from "@/render/maplibre";
import type { Emitter } from "./emitter";
import { attachPointerInput, type PointerSample } from "./input";
import { arrowDirection } from "./select-tool";
import type { Tool } from "./tool";

const HOVER_TOLERANCE = 4;
/** How far an arrow key pans the map, in CSS pixels. */
const PAN_STEP = 100;

export interface InputWiring {
  map: MapLibreMap;
  renderer: FeatureRenderer;
  events: Emitter<ControllerEvents>;
  tool: () => Tool | null;
  unproject: (point: { x: number; y: number }) => LngLat;
  /** The last pointer seen: a finger switches handles to their large size. */
  seen: (sample: PointerSample | null, coarse: boolean | null) => void;
  lastPointer: () => PointerSample | null;
  refreshCursor: () => void;
}

/** Routes the map's pointer and key events to the active tool. Returns the disposer. */
export function wireInput(wiring: InputWiring): () => void {
  const { map, renderer, events, tool, refreshCursor } = wiring;
  const surface = map.getContainer();
  let pointerFrame = 0;
  const seen = (sample: PointerSample) => wiring.seen(sample.touch ? null : sample, sample.touch);

  /* At most one `pointer` event per frame, however fast the mouse moves. */
  const reportPointer = () => {
    if (pointerFrame !== 0) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      const sample = wiring.lastPointer();
      if (!sample) return;
      events.emit("pointer", { at: wiring.unproject(sample), hitIds: renderer.hitTest(sample, HOVER_TOLERANCE) });
      refreshCursor();
    });
  };

  const detach = attachPointerInput(map, {
    down: (sample) => {
      seen(sample);
      /* A press on the map puts keyboard focus there, so Delete and Escape reach the tool even when the press is taken. */
      if (document.activeElement !== map.getCanvas()) map.getCanvas().focus({ preventScroll: true });
      return tool()?.down(sample) ?? false;
    },
    drag: (sample, start) => {
      seen(sample);
      tool()?.drag(sample, start);
      refreshCursor();
    },
    dragEnd: (sample) => {
      tool()?.dragEnd(sample);
      refreshCursor();
    },
    dragCancel: () => tool()?.dragCancel(),
    click: (sample) => {
      seen(sample);
      tool()?.click(sample);
      refreshCursor();
    },
    doubleClick: (sample) => {
      tool()?.doubleClick(sample);
      refreshCursor();
    },
    longPress: (sample) => tool()?.longPress(sample) ?? false,
    hover: (sample) => {
      seen(sample);
      tool()?.hover(sample);
      reportPointer();
    },
    leave: () => {
      wiring.seen(null, null);
      tool()?.leave();
      events.emit("pointer", { at: null, hitIds: [] });
    },
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (tool()?.key(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    /* Arrow keys the tool did not want pan the map: west on the left whatever the page's direction. */
    const direction = arrowDirection(event.key);
    if (direction) {
      const step = event.shiftKey ? PAN_STEP * 3 : PAN_STEP;
      map.panBy([direction.x * step, direction.y * step], { duration: 150 });
      event.preventDefault();
      event.stopPropagation();
    }
  };
  surface.addEventListener("keydown", onKey);

  /* Keys the tool claims wherever focus is, unless the person is typing. */
  const onWindowKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Node && surface.contains(target)) return;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]"))) return;
    const active = tool();
    if (!active?.capturesKey?.(event)) return;
    if (active.key(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  window.addEventListener("keydown", onWindowKey, true);

  return () => {
    window.removeEventListener("keydown", onWindowKey, true);
    cancelAnimationFrame(pointerFrame);
    detach();
    surface.removeEventListener("keydown", onKey);
  };
}

/** Camera, context-loss and tile-error events, reported through the controller's emitter. Returns the disposer. */
export function wireMapEvents(map: MapLibreMap, events: Emitter<ControllerEvents>, basemap: { tilesReported: boolean }): () => void {
  let viewportFrame = 0;
  const onMove = () => {
    if (viewportFrame !== 0) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      const centre = map.getCenter();
      events.emit("viewport", { center: [centre.lng, centre.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
    });
  };
  const onContextLost = () => {
    events.emit("problem", { code: "context_lost", detail: "The browser took the map's graphics context away. It is restored automatically when one is free again." });
  };
  const onError = (event: { error?: { message?: string } }) => {
    if (basemap.tilesReported) return;
    basemap.tilesReported = true;
    events.emit("problem", { code: "tiles_failed", detail: event.error?.message ?? "The basemap could not be loaded." });
  };
  map.on("move", onMove);
  map.on("webglcontextlost", onContextLost);
  map.on("error", onError);
  return () => {
    cancelAnimationFrame(viewportFrame);
    map.off("move", onMove);
    map.off("webglcontextlost", onContextLost);
    map.off("error", onError);
  };
}
