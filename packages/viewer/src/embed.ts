// Responsive iframe embedding: the framed document reports its height to the
// parent over postMessage, and the parent resizes the iframe.

const PROTOCOL = "livemap-embed-v1";

interface HeightMessage {
  readonly protocol: typeof PROTOCOL;
  readonly type: "height";
  readonly id: string;
  readonly height: number;
}

function isHeightMessage(v: unknown): v is HeightMessage {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    m["protocol"] === PROTOCOL &&
    m["type"] === "height" &&
    typeof m["id"] === "string" &&
    typeof m["height"] === "number" &&
    Number.isFinite(m["height"]) &&
    m["height"] > 0 &&
    // A hostile or buggy frame must not force a megapixel-tall element onto the host page.
    m["height"] <= 20_000
  );
}

export interface ChildOptions {
  /** Matches the `id` the parent passed, so one page can host many embeds. */
  readonly id: string;
  /** Element whose height is reported. Defaults to `document.body`. */
  readonly target?: HTMLElement;
  /** Minimum change in px before re-reporting, to avoid message storms. */
  readonly threshold?: number;
}

export function startEmbedChild(options: ChildOptions): () => void {
  const target = options.target ?? document.body;
  const threshold = options.threshold ?? 2;
  let lastHeight = -1;

  const report = () => {
    const height = Math.ceil(target.getBoundingClientRect().height);
    if (height <= 0) return;
    if (Math.abs(height - lastHeight) < threshold) return;
    lastHeight = height;
    const message: HeightMessage = {
      protocol: PROTOCOL,
      type: "height",
      id: options.id,
      height,
    };
    // "*" is correct: the child cannot know the host's origin, and the payload
    // carries nothing but its own rendered height.
    window.parent.postMessage(message, "*");
  };

  const observer =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(report) : null;
  observer?.observe(target);
  window.addEventListener("load", report);
  report();

  return () => {
    observer?.disconnect();
    window.removeEventListener("load", report);
  };
}

export interface ParentOptions {
  readonly id: string;
  readonly iframe: HTMLIFrameElement;
  readonly onResize?: (height: number) => void;
}

export function startEmbedParent(options: ParentOptions): () => void {
  const handler = (event: MessageEvent) => {
    // Validated on both frame identity and payload shape. Matching on
    // `contentWindow` rather than `event.origin` is what stops any other frame
    // on the same origin from driving the resize.
    if (event.source !== options.iframe.contentWindow) return;
    if (!isHeightMessage(event.data)) return;
    if (event.data.id !== options.id) return;

    options.iframe.style.height = `${event.data.height}px`;
    options.onResize?.(event.data.height);
  };

  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/**
 * Build the embed snippet a customer pastes into their CMS.
 *
 * The sandbox omits `allow-same-origin` on purpose: a map embed has no business
 * reading the host page.
 */
export function embedSnippet(params: {
  readonly src: string;
  readonly id: string;
  readonly title: string;
  readonly initialHeight?: number;
}): string {
  const height = params.initialHeight ?? 480;
  const url = new URL(params.src);
  url.searchParams.set("embedId", params.id);

  return [
    `<iframe src="${escapeAttr(url.href)}"`,
    ` title="${escapeAttr(params.title)}"`,
    ` id="livemap-${escapeAttr(params.id)}"`,
    ` style="width:100%;border:0;height:${height}px"`,
    ` loading="lazy"`,
    ` sandbox="allow-scripts allow-popups"`,
    `></iframe>`,
  ].join("");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const EMBED_PROTOCOL = PROTOCOL;
