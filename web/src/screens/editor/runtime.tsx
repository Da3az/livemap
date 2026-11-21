import { createContext, useContext, type ReactNode } from "react";
import type { EditorController } from "@/editor/controller";

/**
 * What every part of the editor screen can reach besides the document store
 * (which comes from `EditorStoreProvider` / `useEditorStore`).
 */
export interface EditorRuntime {
  /** null until the map is mounted. */
  controller: EditorController | null;
  /**
   * Popovers, menus and dialogs opened from the editor mount here, inside the
   * editor root, so they inherit its direction and language.
   */
  portalContainer: HTMLElement | null;
  /** Opens the reader's-eye preview. */
  openPreview: () => void;
}

const EditorRuntimeContext = createContext<EditorRuntime | null>(null);

export function EditorRuntimeProvider({ value, children }: { value: EditorRuntime; children: ReactNode }) {
  return <EditorRuntimeContext.Provider value={value}>{children}</EditorRuntimeContext.Provider>;
}

export function useEditorRuntime(): EditorRuntime {
  const runtime = useContext(EditorRuntimeContext);
  if (!runtime) throw new Error("useEditorRuntime must be used inside the editor screen");
  return runtime;
}
