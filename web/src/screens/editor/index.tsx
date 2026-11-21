import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router";
import { type MapDetail, queryKeys, useMap, useSession } from "@/api/hooks";
import { createEditorStore, EditorStoreProvider, selectDrawOrder, type EditorStore } from "@/editor/store";
import type { Session } from "@/model/types";
import { EditorShell } from "./shell";
import { EditorAccessProvider, type EditorAccess, type ReadOnlyWhy } from "./shared/access";
import { EditorLoadFailed, EditorLoading } from "./states";

/** A contributor may change only the maps they made; everywhere else they read. */
function readOnlyWhy(session: Session, detail: MapDetail): ReadOnlyWhy | null {
  if (detail.map.archived) return "archived";
  if (!session.capabilities.includes("map:edit")) return "viewer";
  if (session.role === "contributor" && detail.map.createdBy.userId !== session.userId) return "not_owner";
  return null;
}

/**
 * Keeps the query cache in step with what the store has saved, so leaving the
 * editor and coming back never rebuilds the document from an older answer.
 */
function useWriteThrough(store: EditorStore, initial: MapDetail): void {
  const client = useQueryClient();
  useEffect(() => {
    let last = { baseline: store.getState().baseline, meta: store.getState().meta };
    return store.subscribe(() => {
      const state = store.getState();
      if (state.baseline === last.baseline && state.meta === last.meta) return;
      const versionsChanged = state.meta.publishedVersion !== last.meta.publishedVersion;
      last = { baseline: state.baseline, meta: state.meta };
      const saved = state.baseline;
      client.setQueryData<MapDetail>(queryKeys.map(state.meta.id), {
        map: {
          ...initial.map,
          title: saved.title,
          uiDir: saved.uiDir,
          settings: saved.settings,
          rev: state.meta.rev,
          publishedVersion: state.meta.publishedVersion,
          publishedRev: state.meta.publishedRev,
          updatedAt: state.meta.updatedAt,
          updatedBy: state.meta.updatedBy,
        },
        features: selectDrawOrder({ ...state, doc: saved }),
      });
      void client.invalidateQueries({ queryKey: queryKeys.mapLists });
      if (versionsChanged) {
        void client.invalidateQueries({ queryKey: queryKeys.versions(state.meta.id) });
        void client.invalidateQueries({ queryKey: ["published"] });
      }
    });
  }, [client, store, initial]);
}

function LoadedEditor({ session, detail }: { session: Session; detail: MapDetail }) {
  /* Once per open map. A refetch never replaces the document: only what is live is taken from it. */
  const [opened] = useState(() => {
    const why = readOnlyWhy(session, detail);
    const capabilities = why === "not_owner" ? session.capabilities.filter((c) => c !== "map:edit" && c !== "map:publish") : session.capabilities;
    return {
      detail,
      why,
      store: createEditorStore({ map: detail.map, features: detail.features, session: { ...session, capabilities } }),
    };
  });
  const { store } = opened;
  useWriteThrough(store, opened.detail);

  const { publishedVersion, publishedRev } = detail.map;
  useEffect(() => store.setPublished(publishedVersion, publishedRev), [store, publishedVersion, publishedRev]);

  const access = useMemo<EditorAccess>(
    () => ({ session, why: opened.why, createdByName: opened.detail.map.createdBy.name }),
    [session, opened],
  );

  return (
    <EditorStoreProvider store={store}>
      <EditorAccessProvider value={access}>
        <EditorShell />
      </EditorAccessProvider>
    </EditorStoreProvider>
  );
}

export default function EditorScreen() {
  const { id } = useParams();
  const session = useSession();
  const map = useMap(id);

  if (session.error?.code === "unauthorised" && !session.data) return <Navigate to="/" replace />;
  if (session.error && !session.data) return <EditorLoadFailed error={session.error} onRetry={() => void session.refetch()} retrying={session.isFetching} />;
  if (map.error && !map.data) return <EditorLoadFailed error={map.error} onRetry={() => void map.refetch()} retrying={map.isFetching} />;
  if (!session.data || !map.data) return <EditorLoading />;
  return <LoadedEditor key={map.data.map.id} session={session.data} detail={map.data} />;
}
