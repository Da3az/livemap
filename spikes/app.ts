// Spike harness: mounts the overlay renderer and exposes a control surface on `window`.

// maplibre-gl 6 has no default export; `Map` is named. Verified in 6.16.0: no
// `setWorkerUrl` either, despite third-party docs claiming v6 requires it.
import { Map as MapLibreMap } from "maplibre-gl";
import { OverlayRenderer, type IconSource } from "@livemap/renderer";
import { ICON_SVGS, SCENE_CENTER, SCENE_ZOOM, scene } from "./scene.js";

// Tile-free, so geometry assertions cannot fail on a slow tile server. The
// Arabic-label check uses a real basemap in a separate run.
const BLANK_STYLE = {
  version: 8 as const,
  // Glyphs still have to come from somewhere for text to render at all.
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    {
      id: "bg",
      type: "background" as const,
      paint: { "background-color": "#EAE6DF" },
    },
  ],
};

const inlineIcons: IconSource = {
  resolve: async (id) => ICON_SVGS[id] ?? null,
};

declare global {
  interface Window {
    lm: {
      map: MapLibreMap;
      renderer: OverlayRenderer;
      ready: Promise<void>;
      setView(zoom: number, bearing?: number, pitch?: number): Promise<void>;
      sourceCounts(): Record<string, number>;
      labelPositions(): { id: string; x: number; y: number; text: string }[];
      arrowheads(): { id: string; rotate: number; lng: number; lat: number }[];
      stages(): string[];
    };
  }
}

const map = new MapLibreMap({
  container: "map",
  style: BLANK_STYLE as never,
  center: SCENE_CENTER,
  zoom: SCENE_ZOOM,
  attributionControl: false,
  // Deterministic rendering for screenshot comparison.
  fadeDuration: 0,
});

const renderer = new OverlayRenderer(map as never, {
  icons: inlineIcons,
  fonts: ["Noto Sans Regular"],
  debounceMs: 0,
});

// `idle` is a one-shot edge and may have already fired, so `triggerRepaint`
// forces a frame and the timeout is the backstop when nothing needs drawing.
function waitIdle(timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    map.once("idle", finish);
    map.triggerRepaint();
    setTimeout(finish, timeoutMs);
  });
}

const stages: string[] = [];
const ready = (async () => {
  stages.push("start");
  await new Promise<void>((resolve) => {
    if (map.loaded()) return resolve();
    map.once("load", () => resolve());
  });
  stages.push("load");
  renderer.attach();
  stages.push("attach");
  renderer.setFeatures(scene);
  stages.push("setFeatures");
  // Icons load asynchronously, so one idle is not enough.
  await waitIdle();
  stages.push("idle1");
  await new Promise((r) => setTimeout(r, 600));
  renderer.rebuild();
  await waitIdle();
  stages.push("idle2");
})();

// From the renderer's own record: `map.getSource(id)._data` is not public API
// and does not exist in maplibre-gl 6.x, so it silently reads undefined.
function sourceCounts(): Record<string, number> {
  const built = renderer.getLastSources();
  const out: Record<string, number> = {};
  for (const id of [
    "lm-areas",
    "lm-lines",
    "lm-teeth",
    "lm-markers",
    "lm-labels",
  ] as const) {
    out[id] = built ? built[id].features.length : -1;
  }
  return out;
}

// Screen pixels, so the driver can check de-confliction without reading pixels.
function labelPositions(): { id: string; x: number; y: number; text: string }[] {
  const features = renderer.getLastSources()?.["lm-labels"].features ?? [];
  return features.map((f) => {
    const p = map.project(f.geometry.coordinates as [number, number]);
    return {
      id: String(f.properties["id"]),
      x: Math.round(p.x),
      y: Math.round(p.y),
      text: String(f.properties["text"]),
    };
  });
}

function arrowheads(): { id: string; rotate: number; lng: number; lat: number }[] {
  const features = renderer.getLastSources()?.["lm-markers"].features ?? [];
  return features
    .filter((f) => f.properties["role"] === "arrowhead")
    .map((f) => {
      const c = f.geometry.coordinates as number[];
      return {
        id: String(f.properties["id"]),
        rotate: Number(f.properties["iconRotate"]),
        lng: c[0]!,
        lat: c[1]!,
      };
    });
}

window.lm = {
  map,
  renderer,
  ready,
  async setView(zoom, bearing = 0, pitch = 0) {
    map.jumpTo({ center: SCENE_CENTER, zoom, bearing, pitch });
    renderer.rebuild();
    await waitIdle();
  },
  sourceCounts,
  labelPositions,
  arrowheads,
  stages: () => stages,
};
