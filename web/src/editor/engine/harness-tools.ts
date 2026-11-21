import type { EditorController } from "@/editor/controller";

/** Measurements and stress switches for the engine harness. Development only. */

const FRAMES = 180;

function percentiles(frames: number[]): { median: number; slow: number; worst: number } {
  const sorted = frames.slice(1).sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    slow: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    worst: sorted[sorted.length - 1] ?? 0,
  };
}

/**
 * Playback calls `setTimeFilter` once per animation frame. This measures
 * the call on its own, then the frame-to-frame time while it runs.
 */
export function runTimeFilterMeasure(controller: EditorController, windowAt: (step: number) => { from: string; to: string }, done: (result: string) => void): void {
  const calls = 2000;
  const started = performance.now();
  for (let index = 0; index < calls; index++) controller.setTimeFilter(windowAt(index));
  const perCall = (performance.now() - started) / calls;
  const frames: number[] = [];
  let step = 0;
  let previous = performance.now();
  const tick = (now: number) => {
    frames.push(now - previous);
    previous = now;
    controller.setTimeFilter(windowAt(step));
    step += 2;
    if (frames.length < FRAMES) {
      requestAnimationFrame(tick);
      return;
    }
    const { median, slow } = percentiles(frames);
    done(`setTimeFilter ${(perCall * 1000).toFixed(1)} µs per call · frame median ${median.toFixed(1)} ms, 95th ${slow.toFixed(1)} ms`);
    controller.setTimeFilter(null);
  };
  requestAnimationFrame(tick);
}

/** Pans in a circle for two thirds of the run, then zooms through label buckets, and reports frame times. */
export function runPanMeasure(controller: EditorController, done: (result: string) => void): void {
  const start = controller.getViewport();
  const frames: number[] = [];
  let previous = performance.now();
  const tick = (now: number) => {
    frames.push(now - previous);
    previous = now;
    const step = frames.length;
    const angle = (step / 60) * Math.PI;
    const zoomStep = step > 120 ? (step - 120) * 0.02 : 0;
    controller.setViewport({ center: [start.center[0] + Math.cos(angle) * 0.08, start.center[1] + Math.sin(angle) * 0.06], zoom: start.zoom + zoomStep });
    if (step < FRAMES) {
      requestAnimationFrame(tick);
      return;
    }
    const { median, slow, worst } = percentiles(frames);
    done(`pan+zoom frame median ${median.toFixed(1)} ms, 95th ${slow.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
    controller.setViewport(start);
  };
  requestAnimationFrame(tick);
}

/**
 * Takes the map's WebGL context away for two seconds, as a browser does under
 * memory pressure, so the `context_lost` problem can be seen. Works on any
 * element holding a MapLibre map (the editor's map container too).
 */
export function loseContextBriefly(root: HTMLElement | null): void {
  const canvas = root?.querySelector<HTMLCanvasElement>("canvas.maplibregl-canvas");
  const lose = canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context");
  if (!lose) return;
  lose.loseContext();
  window.setTimeout(() => lose.restoreContext(), 2000);
}
