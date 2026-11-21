import { useEffect, useState } from "react";
import { useTheme } from "@/app/providers";
import type { EditorController } from "@/editor/controller";
import { createMapLibreController } from "@/editor/engine/maplibre-controller";
import { selectDrawOrder, useConnectController, useEditorStore, useEditorStoreApi } from "@/editor/store";

/**
 * Mounts the map engine in `container` and keeps it connected to the store.
 *
 * The controller is created once per container: the document, the theme, the
 * title and the direction all reach it afterwards through the store's wiring
 * and the effects below. `generation` is bumped to throw the map away and
 * build a new one after the browser took its graphics context.
 */
export function useMapController(container: HTMLElement | null, options: { interactive: boolean; generation: number }): EditorController | null {
  const store = useEditorStoreApi();
  const { mode } = useTheme();
  const title = useEditorStore((state) => state.doc.title);
  const [controller, setController] = useState<EditorController | null>(null);
  const { interactive, generation } = options;

  useEffect(() => {
    if (container === null) return undefined;
    const state = store.getState();
    const created = createMapLibreController({
      container,
      viewport: state.live.viewport ?? state.doc.settings.openingView,
      settings: state.doc.settings,
      features: selectDrawOrder(state),
      title: state.doc.title,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      dir: state.doc.uiDir,
      interactive,
    });
    /* A double-click on the map starts reshaping inside the engine; the store has to agree, or say why not. */
    const offReshape = created.on("reshape", (id) => {
      const result = store.setReshaping(id);
      if (!result.ok) created.setReshaping(null);
    });
    store.setEngineProblem(null);
    setController(created);
    return () => {
      offReshape();
      created.destroy();
      setController(null);
      store.setEngineReady(false);
      store.setDrawProgress(null);
    };
  }, [container, store, interactive, generation]);

  useEffect(() => controller?.setTheme(mode), [controller, mode]);
  useEffect(() => controller?.setDocument({ title }), [controller, title]);
  useConnectController(controller);

  return controller;
}
