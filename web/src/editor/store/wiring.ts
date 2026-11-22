import type { EditorController, FeatureChange, ToolId } from "@/editor/controller";
import type { MapFeature, MapSettings } from "@/model/types";
import type { UiDir } from "./doc";
import { selectControllerDrawDefaults, selectDrawOrder, selectTimeWindow } from "./selectors";
import type { EditorStore } from "./store";
import type { PenMode } from "./state";
import type { TimeWindow } from "./time";

interface Sent {
  features: MapFeature[] | null;
  settings: MapSettings | null;
  selection: readonly string[] | null;
  tool: ToolId | null;
  reshapingId: string | null | undefined;
  snapping: boolean | null;
  toolLocked: boolean | null;
  penMode: PenMode | null;
  timeWindow: TimeWindow | null | undefined;
  drawDefaults: Partial<MapFeature> | null | undefined;
  dir: UiDir | null;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Connect a controller to the store in both directions and return the
 * function that disconnects them.
 *
 * Store to controller: features (in draw order), settings, direction,
 * selection, tool, draw defaults, reshaping, snapping and the time filter.
 * Each is sent only when its value actually changed, so an unrelated store
 * change (a pointer move, a collapsed pane) sends nothing.
 *
 * Controller to store: change, select, tool, draw progress, pointer, viewport,
 * ready and problem.
 *
 * No feedback loops: what the controller reported is not sent back to it
 * unless the store ended up holding something different (it refused the
 * change, numbered a new feature, skipped a locked one). During a drag the
 * feature array is never re-sent; any correction waits for the gesture's
 * `commit`.
 */
export function connectController(store: EditorStore, controller: EditorController): () => void {
  const sent: Sent = {
    features: null,
    settings: null,
    selection: null,
    tool: null,
    reshapingId: undefined,
    snapping: null,
    toolLocked: null,
    penMode: null,
    timeWindow: undefined,
    drawDefaults: undefined,
    dir: null,
  };
  let pushing = false;
  /* Set while a controller event is being applied: what the controller already knows. */
  let fromController: { selection?: readonly string[]; tool?: ToolId; features?: boolean } | null = null;
  /* True between a gesture's first out-of-sync update and its commit. */
  let holdFeatures = false;

  const push = (): void => {
    if (pushing) return;
    pushing = true;
    try {
      const state = store.getState();

      const settings = state.doc.settings;
      if (settings !== sent.settings) {
        sent.settings = settings;
        controller.setSettings(settings);
      }
      if (state.doc.uiDir !== sent.dir) {
        sent.dir = state.doc.uiDir;
        controller.setDir(state.doc.uiDir);
      }

      const features = selectDrawOrder(state);
      if (features !== sent.features && fromController?.features !== true && !holdFeatures) {
        sent.features = features;
        controller.setFeatures(features);
      }

      if (state.tool !== sent.tool) {
        sent.tool = state.tool;
        if (fromController?.tool !== state.tool) controller.setTool(state.tool);
      }

      const drawDefaults = selectControllerDrawDefaults(state);
      if (drawDefaults !== sent.drawDefaults) {
        sent.drawDefaults = drawDefaults;
        if (drawDefaults !== null) controller.setDrawDefaults(drawDefaults);
      }

      const selection = state.selection.ids;
      if (selection !== sent.selection) {
        const known = fromController?.selection;
        const echo = known !== undefined && sameIds(known, selection);
        const unchanged = sent.selection !== null && sameIds(sent.selection, selection);
        sent.selection = selection;
        if (!echo && !unchanged) controller.setSelection([...selection]);
      }

      if (state.view.reshapingId !== sent.reshapingId) {
        sent.reshapingId = state.view.reshapingId;
        controller.setReshaping(state.view.reshapingId);
      }
      if (state.view.snapping !== sent.snapping) {
        sent.snapping = state.view.snapping;
        controller.setSnapping(state.view.snapping);
      }

      if (state.view.toolLocked !== sent.toolLocked) {
        sent.toolLocked = state.view.toolLocked;
        controller.setToolLocked(state.view.toolLocked);
      }
      if (state.view.penMode !== sent.penMode) {
        sent.penMode = state.view.penMode;
        controller.setPenMode(state.view.penMode);
      }

      const timeWindow = selectTimeWindow(state);
      if (timeWindow !== sent.timeWindow) {
        sent.timeWindow = timeWindow;
        controller.setTimeFilter(timeWindow);
      }
    } finally {
      pushing = false;
    }
  };

  const onChange = (change: FeatureChange): void => {
    fromController = { features: true };
    let inSync: boolean;
    try {
      inSync = store.applyEngineChange(change).inSync;
    } finally {
      fromController = null;
    }
    if (inSync && !holdFeatures) {
      sent.features = selectDrawOrder(store.getState());
      return;
    }
    if (change.gesture === "update") {
      holdFeatures = true;
      return;
    }
    holdFeatures = false;
    push();
  };

  const offs = [
    controller.on("change", onChange),
    controller.on("select", (ids, mode) => {
      if (pushing) return;
      fromController = mode === "replace" ? { selection: ids } : {};
      try {
        store.select(ids, mode);
      } finally {
        fromController = null;
      }
    }),
    controller.on("tool", (tool) => {
      if (pushing) return;
      fromController = { tool };
      try {
        store.setTool(tool);
      } finally {
        fromController = null;
      }
    }),
    controller.on("draw", (progress) => store.setDrawProgress(progress)),
    controller.on("crosshair", (on) => store.setCrosshair(on)),
    /* A stylus seen in "auto" mode: from now on pen mode is on, and the status bar shows it. */
    controller.on("pen", () => store.setPenMode("on")),
    controller.on("pointer", (info) => store.setPointer(info)),
    controller.on("viewport", (viewport) => store.setViewport(viewport)),
    controller.on("ready", () => store.setEngineReady(true)),
    controller.on("problem", (problem) => store.setEngineProblem(problem)),
    store.subscribe(push),
  ];

  push();
  let connected = true;
  void controller.whenReady().then(
    () => {
      if (connected) store.setEngineReady(true);
    },
    () => undefined,
  );

  return () => {
    connected = false;
    for (const off of offs) off();
  };
}
