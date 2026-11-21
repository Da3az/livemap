import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { EditorController } from "@/editor/controller";
import { secondsUntil } from "./save";
import type { EditorState } from "./state";
import type { EditorStore } from "./store";
import { connectController } from "./wiring";

const StoreContext = createContext<EditorStore | null>(null);

/**
 * Makes one map's store available to the editor below it. Create the store
 * with `createEditorStore` once per open map (for example in `useState`) and
 * pass it here.
 */
export function EditorStoreProvider({ store, children }: { store: EditorStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/** The store itself, for calling commands: `const store = useEditorStoreApi(); store.restyle(...)`. */
export function useEditorStoreApi(): EditorStore {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("useEditorStore must be used inside an EditorStoreProvider");
  return store;
}

/** True when two values are the same, or are arrays or plain objects with identical members. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  }
  const left: Record<string, unknown> = { ...a };
  const right: Record<string, unknown> = { ...b };
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
}

/**
 * Read from the store and re-render when the selected value changes.
 *
 * The `select*` functions return stable snapshots, so
 * `useEditorStore(selectListTree)` re-renders only when the tree changes. A
 * selector that builds a new object or array each time needs `isEqual`
 * (usually `shallowEqual`): `useEditorStore((s) => ({ tool: s.tool, dir:
 * s.doc.uiDir }), shallowEqual)`.
 */
export function useEditorStore<T>(selector: (state: EditorState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useEditorStoreApi();
  const cache = useRef<{ state: EditorState; selector: (state: EditorState) => T; value: T } | null>(null);
  const getSnapshot = useCallback((): T => {
    const state = store.getState();
    const last = cache.current;
    if (last !== null && last.state === state && last.selector === selector) return last.value;
    const next = selector(state);
    const value = last !== null && isEqual(last.value, next) ? last.value : next;
    cache.current = { state, selector, value };
    return value;
  }, [store, selector, isEqual]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/**
 * Keep a controller and the store connected for as long as the component is
 * mounted. Pass null until the controller exists.
 */
export function useConnectController(controller: EditorController | null): void {
  const store = useEditorStoreApi();
  useEffect(() => {
    if (controller === null) return undefined;
    return connectController(store, controller);
  }, [store, controller]);
}

/**
 * Whole seconds left until `retryAt` (the `retryAt` of a `rate_limited` save
 * or publish state), ticking down to 0. Pass null when there is no countdown.
 */
export function useRetryCountdown(retryAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (retryAt === null) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  return retryAt === null ? 0 : secondsUntil(retryAt, now);
}

/**
 * Drive timeline playback from animation frames while the store says it is
 * playing. Mount once, next to the timeline.
 */
export function useTimelinePlayback(): void {
  const store = useEditorStoreApi();
  const playing = useEditorStore((state) => state.timeline.playing);
  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    let last: number | null = null;
    const tick = (time: number): void => {
      if (last !== null) store.tickPlayback(time - last);
      last = time;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [store, playing]);
}
