// The page inside the iframe. Read-only, and it never sees the API: it asks
// the server where artifacts are served from and fetches them from there.

import { MapViewer, startEmbedChild } from "@livemap/viewer";
import { SLUG_RE, artifactUrls, icons, mapFactory, resolveStyle } from "./map-kit.js";

const params = new URLSearchParams(location.search);
const tenant = params.get("t") ?? "";
const map = params.get("m") ?? "";
const embedId = params.get("embedId");
const note = document.getElementById("note")!;

async function start(): Promise<void> {
  // Slugs only. The artifact URL is built from these two values, so anything
  // else here would be a way to point this page at an arbitrary address.
  if (!SLUG_RE.test(tenant) || !SLUG_RE.test(map)) {
    note.textContent = "This embed link is not valid.";
    return;
  }

  const res = await fetch("/config");
  if (!res.ok) throw new Error(`config ${res.status}`);
  const config = (await res.json()) as { artifactBase: string };

  const viewer = new MapViewer(document.getElementById("map")!, mapFactory, {
    baseUrl: artifactUrls(config.artifactBase, tenant, map).root,
    resolveStyle,
    icons,
    interactive: params.get("static") !== "1",
    poll: params.get("poll") === "1",
    onError: () => {
      note.textContent = "This map could not be loaded.";
    },
  });
  await viewer.load();

  // When framed, report height so the host page can size the frame.
  if (embedId) startEmbedChild({ id: embedId });
}

start().catch(() => {
  note.textContent = "This map has not been published.";
});
