import { createContext, useContext } from "react";
import type { Session } from "@/model/types";

/** Why the open map cannot be edited, as the editor explains it. */
export type ReadOnlyWhy = "viewer" | "archived" | "not_owner";

export interface EditorAccess {
  session: Session;
  /** null: the map can be edited. `not_owner` is a contributor on a map someone else made. */
  why: ReadOnlyWhy | null;
  /** Who made the map, for the `not_owner` explanation. */
  createdByName: string;
}

const AccessContext = createContext<EditorAccess | null>(null);

export const EditorAccessProvider = AccessContext.Provider;

export function useEditorAccess(): EditorAccess {
  const access = useContext(AccessContext);
  if (!access) throw new Error("useEditorAccess must be used inside the editor screen");
  return access;
}
