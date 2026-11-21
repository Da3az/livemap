/**
 * The host-page script, built to `embed-host.js`. A publisher who wants an
 * embed to take its content's height adds `embedId=<id>` to the iframe's URL
 * and loads this script once on the page; every such iframe is then resized
 * to what it reports. Without it the snippet's own size applies, as before.
 */
import { isEmbedId, startEmbedParent } from "./protocol";

const wired = new WeakSet<HTMLIFrameElement>();

function wire(iframe: HTMLIFrameElement): void {
  if (wired.has(iframe)) return;
  let url: URL;
  try {
    url = new URL(iframe.src, document.baseURI);
  } catch {
    return;
  }
  const id = url.searchParams.get("embedId");
  if (!isEmbedId(id) || !url.pathname.startsWith("/embed/")) return;
  wired.add(iframe);
  /* Height comes from the frame from now on; an aspect ratio would fight it. */
  startEmbedParent({ id, iframe, origin: url.origin, onResize: () => (iframe.style.aspectRatio = "auto") });
}

function scan(root: ParentNode): void {
  root.querySelectorAll("iframe").forEach(wire);
}

scan(document);
new MutationObserver((records) => {
  for (const record of records) {
    record.addedNodes.forEach((node) => {
      if (node instanceof HTMLIFrameElement) wire(node);
      else if (node instanceof Element) scan(node);
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true });
