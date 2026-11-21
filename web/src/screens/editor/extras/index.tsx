/**
 * The editor's secondary panels. Each reads the document through
 * `useEditorStore` and reaches the map through `useEditorRuntime`, so the
 * editor screen only has to place them.
 */
import { lazy } from "react";

export { CommandPalette } from "./palette/CommandPalette";
export { PlaceSearch } from "./place/PlaceSearch";

/* Opened on demand, so loaded on demand: the editor's first paint does not wait for them. */
export const PreviewPanel = lazy(() => import("./preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })));
export const MapSettingsPanel = lazy(() => import("./settings/MapSettingsPanel").then((module) => ({ default: module.MapSettingsPanel })));
export { ShortcutSheet } from "./ShortcutSheet";
export { Timeline } from "./timeline/Timeline";
export { TransferMenu } from "./transfer/TransferMenu";
