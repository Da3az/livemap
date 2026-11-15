// Real EditorApp against the real API; the inline icon set stands in for an OCHA mirror.
import { EditorApp } from "@livemap/editor";
import type { IconSource } from "@livemap/renderer";
import { ICON_SVGS } from "../spikes/scene.js";

const BLANK = {
  version: 8 as const,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "bg", type: "background" as const, paint: { "background-color": "#EAE6DF" } }],
};
const OPENFREEMAP = "https://tiles.openfreemap.org/styles/positron";

const icons: IconSource = { resolve: async (id) => ICON_SVGS[id] ?? null };
const useReal = new URLSearchParams(location.search).get("basemap") === "real";

const app = new EditorApp({
  root: document.querySelector(".editor") as HTMLElement,
  mapContainer: document.querySelector(".map") as HTMLElement,
  apiBase: "",
  mapId: "m-1",
  style: useReal ? OPENFREEMAP : BLANK,
  icons,
  previewUrl: "/viewer.html?basemap=" + (useReal ? "real" : "blank"),
});

app.start().catch((e) => {
  console.error(e);
  const s = document.querySelector(".status");
  if (s) s.textContent = "failed to start: " + String(e);
});

(window as unknown as { app: EditorApp }).app = app;
