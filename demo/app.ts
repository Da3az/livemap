// Real MapViewer against the real API; only the repository is in-memory.

import { Map as MapLibreMap } from "maplibre-gl";
import { MapViewer, startEmbedChild, type MapFactory } from "@livemap/viewer";
import type { IconSource } from "@livemap/renderer";
import { ICON_SVGS } from "../spikes/scene.js";

const BLANK_STYLE = {
  version: 8 as const,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    { id: "bg", type: "background" as const, paint: { "background-color": "#EAE6DF" } },
  ],
};

const OPENFREEMAP = "https://tiles.openfreemap.org/styles/positron";

const factory: MapFactory = {
  create: (o) =>
    new MapLibreMap({
      container: o.container,
      style: o.style as never,
      center: o.center,
      zoom: o.zoom,
      bearing: o.bearing,
      pitch: o.pitch,
      interactive: o.interactive,
      attributionControl: { compact: true },
    }) as never,
};

const icons: IconSource = { resolve: async (id) => ICON_SVGS[id] ?? null };

const params = new URLSearchParams(location.search);
const basemap = params.get("basemap") ?? "blank";
const embedId = params.get("embedId");

const container = document.getElementById("map")!;
const status = document.getElementById("status");

const viewer = new MapViewer(container, factory, {
  baseUrl: "/public/t/demo-news/m/levant-tracker",
  resolveStyle: () => (basemap === "real" ? OPENFREEMAP : BLANK_STYLE),
  icons,
  interactive: params.get("static") !== "1",
  poll: params.get("poll") === "1",
  pollIntervalMs: 5000,
  onVersion: (v) => {
    if (!status) return;
    status.textContent =
      `v${v.version} · ${v.features.length} features · etag ${v.etag.slice(0, 8)}… · ` +
      `published ${new Date(v.publishedAt).toLocaleTimeString()}`;
  },
  onError: (e) => {
    if (status) status.textContent = `error: ${String(e)}`;
  },
});

viewer.load().catch((e) => {
  if (status) status.textContent = `failed to load: ${String(e)}`;
});

// When framed, report height to the host page.
if (embedId) startEmbedChild({ id: embedId });

(window as unknown as { viewer: MapViewer }).viewer = viewer;
