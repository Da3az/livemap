/**
 * Responsive iframe embedding. The framed reader reports its rendered height
 * to the host page over postMessage, and a small script on the host page
 * resizes the iframe. Both halves validate everything they receive: a host
 * page may contain other frames, and any of them can post anything.
 */

export const EMBED_PROTOCOL = "livemap-embed-v1";

/** A frame may not make itself taller than this; a hostile one must not push a megapixel element onto the host. */
export const MAX_EMBED_HEIGHT = 20_000;

/** The ids the snippet hands out: short, and safe to use in an element id. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface HeightMessage {
  protocol: typeof EMBED_PROTOCOL;
  type: "height";
  id: string;
  height: number;
}

export function isEmbedId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Exactly the message this protocol sends, with a finite, positive, bounded height. Nothing else passes. */
export function isHeightMessage(value: unknown): value is HeightMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  const keys = Object.keys(message);
  if (keys.length !== 4) return false;
  const height = message["height"];
  return (
    message["protocol"] === EMBED_PROTOCOL &&
    message["type"] === "height" &&
    isEmbedId(message["id"]) &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0 &&
    height <= MAX_EMBED_HEIGHT
  );
}

export interface ChildOptions {
  /** The id the host passed in the embed URL, so one page can host many embeds. */
  id: string;
  /**
   * The element whose content is measured. The reader fills its frame, so its
   * own height is the frame's; what matters is content that does not fit.
   */
  target: HTMLElement;
  /** Smallest change, in CSS pixels, worth reporting; avoids message storms while content settles. */
  threshold?: number;
}

/**
 * Runs inside the iframe. Reports only when the content is taller than the
 * frame, so the host grows the frame to fit and never shrinks it: a page that
 * fills its frame would otherwise echo the frame's own height back forever.
 * Returns a function that stops reporting.
 */
export function startEmbedChild(options: ChildOptions): () => void {
  if (!isEmbedId(options.id) || window.parent === window) return () => {};
  const threshold = options.threshold ?? 2;
  let last = -1;

  const report = (): void => {
    const height = Math.ceil(options.target.scrollHeight);
    if (height <= window.innerHeight + threshold || height > MAX_EMBED_HEIGHT) return;
    if (Math.abs(height - last) < threshold) return;
    last = height;
    const message: HeightMessage = { protocol: EMBED_PROTOCOL, type: "height", id: options.id, height };
    /* "*" is right: the frame cannot know its host's origin, and the message carries only its own height. */
    window.parent.postMessage(message, "*");
  };

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
  observer?.observe(options.target);
  for (const child of Array.from(options.target.children)) observer?.observe(child);
  window.addEventListener("load", report);
  window.addEventListener("resize", report);
  report();
  return () => {
    observer?.disconnect();
    window.removeEventListener("load", report);
    window.removeEventListener("resize", report);
  };
}

export interface ParentOptions {
  id: string;
  iframe: HTMLIFrameElement;
  /** The origin the iframe's document is served from. Messages from anywhere else are ignored. */
  origin: string;
  onResize?: (height: number) => void;
}

/** Runs on the host page. Returns a function that stops listening. */
export function startEmbedParent(options: ParentOptions): () => void {
  const handler = (event: MessageEvent): void => {
    /*
     * Matched on the sending window, not only on the origin: another frame from
     * the same origin must not be able to resize this one. A sandboxed frame
     * without allow-same-origin posts from the opaque origin "null".
     */
    if (event.source !== options.iframe.contentWindow) return;
    if (event.origin !== options.origin && event.origin !== "null") return;
    if (!isHeightMessage(event.data)) return;
    if (event.data.id !== options.id) return;
    if (event.data.height <= options.iframe.getBoundingClientRect().height) return;
    options.iframe.style.height = `${event.data.height}px`;
    options.onResize?.(event.data.height);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}
