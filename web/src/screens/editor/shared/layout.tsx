import { createContext, useContext, useSyncExternalStore } from "react";

/** True while a CSS media query matches. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/**
 * How the editor is laid out.
 * - `desktop`: both panes docked beside the map.
 * - `tablet`: the full editor; panes slide over the map, one at a time.
 * - `phone`: review, retitle and publish. No drawing.
 */
export type LayoutMode = "desktop" | "tablet" | "phone";

export interface EditorLayout {
  mode: LayoutMode;
  /** Hit targets must be at least 44px, and nothing may depend on hover. */
  touch: boolean;
}

const LayoutContext = createContext<EditorLayout>({ mode: "desktop", touch: false });

export const EditorLayoutProvider = LayoutContext.Provider;

/** The layout the editor is in. Read `touch` to size hit targets and to show row controls without hover. */
export function useEditorLayout(): EditorLayout {
  return useContext(LayoutContext);
}

/** Works out the layout from the window. Call once, in the editor root. */
export function useDetectLayout(): EditorLayout {
  const phone = useMediaQuery("(max-width: 39.99rem)");
  const narrow = useMediaQuery("(max-width: 63.99rem)");
  const coarse = useMediaQuery("(pointer: coarse)");
  const mode: LayoutMode = phone ? "phone" : narrow ? "tablet" : "desktop";
  return { mode, touch: coarse || mode !== "desktop" };
}
