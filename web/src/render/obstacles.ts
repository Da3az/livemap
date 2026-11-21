import type { Box } from "./geo";

/** Marks an element laid over the map whose rectangle labels should keep clear of. */
export const OBSTACLE_ATTRIBUTE = "data-label-obstacle";

/**
 * Watches the elements marked with `data-label-obstacle` inside `scope` and
 * reports their rectangles relative to `map` (CSS pixels from its top-left
 * corner, clipped to it) whenever they appear, disappear, move or change size.
 * Hidden elements (`visibility: hidden`, or no size) do not count. Returns the
 * function that stops watching.
 */
export function watchObstacles(scope: HTMLElement, map: HTMLElement, onChange: (boxes: Box[]) => void): () => void {
  let frame = 0;
  let last = "";
  const sized = new ResizeObserver(() => schedule());

  const measure = (): void => {
    frame = 0;
    const frameRect = map.getBoundingClientRect();
    const boxes: Box[] = [];
    sized.disconnect();
    sized.observe(map);
    for (const element of scope.querySelectorAll<HTMLElement>(`[${OBSTACLE_ATTRIBUTE}]`)) {
      sized.observe(element);
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(element).visibility === "hidden") continue;
      const box: Box = {
        minX: Math.max(0, rect.left - frameRect.left),
        minY: Math.max(0, rect.top - frameRect.top),
        maxX: Math.min(frameRect.width, rect.right - frameRect.left),
        maxY: Math.min(frameRect.height, rect.bottom - frameRect.top),
      };
      if (box.maxX > box.minX && box.maxY > box.minY) boxes.push(box);
    }
    const key = boxes.map((box) => `${Math.round(box.minX)},${Math.round(box.minY)},${Math.round(box.maxX)},${Math.round(box.maxY)}`).join(";");
    if (key === last) return;
    last = key;
    onChange(boxes);
  };
  function schedule(): void {
    if (frame === 0) frame = requestAnimationFrame(measure);
  }

  const changed = new MutationObserver(schedule);
  changed.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "aria-hidden"] });
  window.addEventListener("resize", schedule);
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    sized.disconnect();
    changed.disconnect();
    window.removeEventListener("resize", schedule);
  };
}
