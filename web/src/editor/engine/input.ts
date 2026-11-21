import type { Map as MapLibreMap } from "maplibre-gl";
import type { Pt } from "@/render/geo";

/**
 * Turns pointer events on the map into the handful of gestures the tools
 * understand, for mouse, pen and touch alike. MapLibre keeps panning and
 * zooming; a tool that wants a drag for itself says so on `down`, and the
 * map's drag-pan is switched off for exactly that gesture.
 */
export interface PointerSample extends Pt {
  shift: boolean;
  /** Ctrl, or Command on a Mac. */
  ctrl: boolean;
  touch: boolean;
}

export interface PointerHandler {
  /** Return true to take the gesture: the map will not pan and `drag` will follow. */
  down(sample: PointerSample): boolean;
  drag(sample: PointerSample, start: PointerSample): void;
  dragEnd(sample: PointerSample): void;
  dragCancel(): void;
  click(sample: PointerSample): void;
  doubleClick(sample: PointerSample): void;
  hover(sample: PointerSample): void;
  leave(): void;
  /** A finger held still. Return true to take the gesture from here on. */
  longPress(sample: PointerSample): boolean;
}

const DOUBLE_CLICK_MS = 350;
const LONG_PRESS_MS = 450;
const SLOP_MOUSE = 4;
const SLOP_TOUCH = 10;

interface Press {
  pointerId: number;
  start: PointerSample;
  taken: boolean;
  dragging: boolean;
  moved: boolean;
  longPressTimer: number;
  panWasEnabled: boolean;
}

export function attachPointerInput(map: MapLibreMap, handler: PointerHandler): () => void {
  const surface = map.getCanvasContainer();
  let press: Press | null = null;
  let lastClick: { time: number; at: Pt } | null = null;
  /* Every finger on the surface. Once two are down the gesture is the map's until all are lifted again. */
  const fingers = new Set<number>();
  let multiTouch = false;

  const sampleOf = (event: PointerEvent): PointerSample => {
    const bounds = surface.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      shift: event.shiftKey,
      ctrl: event.ctrlKey || event.metaKey,
      touch: event.pointerType !== "mouse",
    };
  };
  const slop = (sample: PointerSample) => (sample.touch ? SLOP_TOUCH : SLOP_MOUSE);

  const take = (current: Press) => {
    current.taken = true;
    current.panWasEnabled = map.dragPan.isEnabled();
    if (current.panWasEnabled) map.dragPan.disable();
  };

  const release = () => {
    if (!press) return;
    window.clearTimeout(press.longPressTimer);
    if (press.taken && press.panWasEnabled) map.dragPan.enable();
    press = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };

  const abandon = () => {
    if (press?.dragging) handler.dragCancel();
    release();
  };

  function onDown(event: PointerEvent) {
    if (event.pointerType !== "mouse") fingers.add(event.pointerId);
    if (fingers.size > 1) multiTouch = true;
    if (event.button !== 0) return;
    if (press || multiTouch) {
      /*
       * A second finger: this is a pinch or a two-finger pan, which belongs to
       * the map. Nothing is placed, not even by a finger that lifts and lands
       * again while another is still down.
       */
      abandon();
      return;
    }
    const start = sampleOf(event);
    const current: Press = { pointerId: event.pointerId, start, taken: false, dragging: false, moved: false, longPressTimer: 0, panWasEnabled: false };
    press = current;
    if (handler.down(start)) take(current);
    if (start.touch && !current.taken) {
      current.longPressTimer = window.setTimeout(() => {
        if (press === current && !current.moved && handler.longPress(start)) take(current);
      }, LONG_PRESS_MS);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  function onMove(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointerId) return;
    const sample = sampleOf(event);
    if (!press.moved && Math.hypot(sample.x - press.start.x, sample.y - press.start.y) > slop(sample)) {
      press.moved = true;
      window.clearTimeout(press.longPressTimer);
    }
    if (press.taken && (press.moved || press.dragging)) {
      press.dragging = true;
      handler.drag(sample, press.start);
    }
  }

  function onUp(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointerId) return;
    const sample = sampleOf(event);
    const { dragging, moved } = press;
    release();
    if (dragging) {
      handler.dragEnd(sample);
      return;
    }
    if (moved) return;
    const now = performance.now();
    const isDouble = lastClick !== null && now - lastClick.time < DOUBLE_CLICK_MS && Math.hypot(sample.x - lastClick.at.x, sample.y - lastClick.at.y) <= slop(sample) * 2;
    if (isDouble) {
      lastClick = null;
      handler.doubleClick(sample);
    } else {
      lastClick = { time: now, at: sample };
      handler.click(sample);
    }
  }

  function onCancel(event: PointerEvent) {
    if (press && event.pointerId === press.pointerId) abandon();
  }

  function onFingerUp(event: PointerEvent) {
    fingers.delete(event.pointerId);
    if (fingers.size === 0) multiTouch = false;
  }

  function onHover(event: PointerEvent) {
    if (!press && event.pointerType === "mouse") handler.hover(sampleOf(event));
  }

  function onLeave(event: PointerEvent) {
    if (!press && event.pointerType === "mouse") handler.leave();
  }

  surface.addEventListener("pointerdown", onDown);
  surface.addEventListener("pointermove", onHover);
  surface.addEventListener("pointerleave", onLeave);
  window.addEventListener("pointerup", onFingerUp, true);
  window.addEventListener("pointercancel", onFingerUp, true);

  return () => {
    abandon();
    window.removeEventListener("pointerup", onFingerUp, true);
    window.removeEventListener("pointercancel", onFingerUp, true);
    surface.removeEventListener("pointerdown", onDown);
    surface.removeEventListener("pointermove", onHover);
    surface.removeEventListener("pointerleave", onLeave);
  };
}
