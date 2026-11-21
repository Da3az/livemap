import type { Map as MapLibreMap } from "maplibre-gl";

/** A 2D canvas laid over the map, the size of the map, that takes no pointer events. */
export function attachOverlayCanvas(map: MapLibreMap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  map.getCanvasContainer().appendChild(canvas);
  return canvas;
}

/** Sizes an overlay's backing store to the view at the device's pixel ratio and clears it. Returns that ratio. */
export function clearOverlay(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, view: { width: number; height: number }): number {
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.round(view.width * pixelRatio);
  const height = Math.round(view.height * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, view.width, view.height);
  return pixelRatio;
}
