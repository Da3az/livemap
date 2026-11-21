import { Map as MapLibreMap, setWorkerUrl, type MapOptions } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

let workerWired = false;

/**
 * MapLibre 6 ships its worker as a separate, self-contained module. Vite
 * pre-bundles the main file, which breaks the library's own guess at where the
 * worker lives, so the URL is resolved by Vite and handed over before any map
 * exists. `?worker&url`, not `?url`: with `?url` the dev server runs the file
 * through its module pipeline as if it were page code (importing the HMR
 * client into the worker), and a build copies it verbatim, still pointing at a
 * `.map` file that is never emitted (a 404 whenever developer tools are open).
 * As a worker entry it is served the way workers are in dev and bundled as one
 * in a build, with no dangling source-map reference.
 */
function wireWorker(): void {
  if (workerWired) return;
  setWorkerUrl(workerUrl);
  workerWired = true;
}

export function createMap(options: MapOptions): MapLibreMap {
  wireWorker();
  const map = new MapLibreMap(options);
  /* Some OpenFreeMap styles name sprite images their sprite does not have; a blank keeps them quiet. */
  map.setMissingStyleImageResolver((id) => {
    if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  return map;
}

export type { MapLibreMap };
