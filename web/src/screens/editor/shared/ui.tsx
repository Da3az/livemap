import { createContext, useContext } from "react";

/** The three pieces of furniture the published map carries. */
export type FurniturePart = "title" | "key" | "credits";

/**
 * How the published map's furniture sits over the map while editing. A view
 * choice for the author only: never saved, never what readers get.
 */
export interface FurnitureView {
  hidden: boolean;
  /** A folded part shrinks to a one-line tab at its corner. */
  folded: Readonly<Record<FurniturePart, boolean>>;
}

/** Exactly as it will publish. */
export const FURNITURE_PUBLISHED: FurnitureView = { hidden: false, folded: { title: false, key: false, credits: false } };
/** Every part folded to its tab. */
export const FURNITURE_FOLDED: FurnitureView = { hidden: false, folded: { title: true, key: true, credits: true } };
/** Nothing in the way. */
export const FURNITURE_HIDDEN: FurnitureView = { ...FURNITURE_PUBLISHED, hidden: true };

/** Interface state the shell owns and its parts share. None of it belongs to the document. */
export interface EditorUi {
  /** The map-level settings are showing in the trailing pane. */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** On a tablet the panes slide over the map, one at a time. */
  overlayPane: "list" | "inspector" | null;
  setOverlayPane: (pane: "list" | "inspector" | null) => void;
  /** How the published map's title block, key and credits are drawn over the map. A view choice, not a setting. */
  furniture: FurnitureView;
  setFurniture: (view: FurnitureView) => void;
  previewOpen: boolean;
  closePreview: () => void;
  /** Throw the map away and build it again, after the browser took its graphics context. */
  reloadMap: () => void;
  /** The element the map is mounted in, to tell map focus from interface focus. */
  mapElement: HTMLElement | null;
}

const UiContext = createContext<EditorUi | null>(null);

export const EditorUiProvider = UiContext.Provider;

export function useEditorUi(): EditorUi {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useEditorUi must be used inside the editor screen");
  return ui;
}
