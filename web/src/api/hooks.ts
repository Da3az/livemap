/**
 * TanStack Query hooks over `useApi()`: one per `ApiClient` method.
 *
 * Rules these hooks keep:
 * - Every error is an `ApiError`; switch on `error.code`.
 * - Nothing is optimistic. A cache entry changes only after the server has
 *   answered, so a 409 or a 403 is never papered over by a guess.
 * - Query keys are exported and stable; invalidate through `queryKeys`.
 * - Refusals are not retried (see `makeQueryClient` in `app/providers.tsx`).
 */
import {
  type QueryClient,
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ApiError } from "@/api/client";
import { useApi } from "@/app/providers";
import type {
  AppConfig,
  MapDoc,
  MapFeature,
  MapSummary,
  MapVersion,
  RichText,
  Session,
  TemplateSummary,
  TextDir,
  VersionPointer,
  VersionRecord,
} from "@/model/types";

/* ------------------------------------------------------------------ keys */

export const queryKeys = {
  config: ["config"] as const,
  session: ["session"] as const,
  templates: ["templates"] as const,
  /** Everything about maps: lists, documents, versions. */
  maps: ["maps"] as const,
  /** Both lists, active and archived. */
  mapLists: ["maps", "list"] as const,
  mapList: (archived: boolean) => ["maps", "list", { archived }] as const,
  /** One map and everything under it. */
  mapScope: (id: string) => ["maps", "map", id] as const,
  map: (id: string) => ["maps", "map", id, "draft"] as const,
  versions: (id: string) => ["maps", "map", id, "versions"] as const,
  version: (id: string, version: number) => ["maps", "map", id, "version", version] as const,
  published: (tenantSlug: string, mapSlug: string) => ["published", tenantSlug, mapSlug] as const,
};

export type MapDetail = { map: MapDoc; features: MapFeature[] };
export type VersionList = { pointer: VersionPointer; versions: VersionRecord[] };

/* --------------------------------------------------------------- queries */

/** Public server settings. Does not need a session. */
export function useConfig(): UseQueryResult<AppConfig, ApiError> {
  const api = useApi();
  return useQuery<AppConfig, ApiError>({ queryKey: queryKeys.config, queryFn: () => api.getConfig(), staleTime: 5 * 60_000 });
}

/**
 * Who is signed in. Errors with `unauthorised` when nobody is, which is an
 * answer rather than a failure: route to sign-in on it.
 */
export function useSession(options: { enabled?: boolean } = {}): UseQueryResult<Session, ApiError> {
  const api = useApi();
  return useQuery<Session, ApiError>({
    queryKey: queryKeys.session,
    queryFn: () => api.getSession(),
    enabled: options.enabled ?? true,
  });
}

export function useTemplates(options: { enabled?: boolean } = {}): UseQueryResult<TemplateSummary[], ApiError> {
  const api = useApi();
  return useQuery<TemplateSummary[], ApiError>({
    queryKey: queryKeys.templates,
    queryFn: () => api.listTemplates(),
    staleTime: 5 * 60_000,
    enabled: options.enabled ?? true,
  });
}

/** The workspace list. `archived: true` gives the archived maps instead of the working ones. */
export function useMaps(input: { archived: boolean } = { archived: false }): UseQueryResult<MapSummary[], ApiError> {
  const api = useApi();
  return useQuery<MapSummary[], ApiError>({
    queryKey: queryKeys.mapList(input.archived),
    queryFn: () => api.listMaps({ archived: input.archived }),
  });
}

/**
 * A map's draft: the document and its features.
 *
 * The editor loads this once and then owns the document. After that the
 * cache is kept in step by `useEditMap`, and refetched after a publish or a
 * rollback (which change `publishedVersion` and `publishedRev`, not the
 * features). It is never refetched on a timer or on focus.
 */
export function useMap(id: string | undefined): UseQueryResult<MapDetail, ApiError> {
  const api = useApi();
  return useQuery<MapDetail, ApiError>({
    queryKey: queryKeys.map(id ?? ""),
    queryFn: () => api.getMap(id ?? ""),
    enabled: id !== undefined && id.length > 0,
  });
}

export function useVersions(id: string | undefined): UseQueryResult<VersionList, ApiError> {
  const api = useApi();
  return useQuery<VersionList, ApiError>({
    queryKey: queryKeys.versions(id ?? ""),
    queryFn: () => api.listVersions(id ?? ""),
    enabled: id !== undefined && id.length > 0,
  });
}

/** One published artifact. Immutable, so it is fetched once and kept. */
export function useVersion(id: string | undefined, version: number | null | undefined): UseQueryResult<MapVersion, ApiError> {
  const api = useApi();
  return useQuery<MapVersion, ApiError>({
    queryKey: queryKeys.version(id ?? "", version ?? 0),
    queryFn: () => api.getVersion(id ?? "", version ?? 0),
    enabled: id !== undefined && id.length > 0 && typeof version === "number",
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * What a reader's embed shows: the live artifact, or null when the map has
 * never been published. Pass `pollMs` to follow a live map; polling pauses
 * while the tab is hidden, as the published pointer's short cache intends.
 */
export function usePublished(
  tenantSlug: string | undefined,
  mapSlug: string | undefined,
  options: { pollMs?: number } = {},
): UseQueryResult<MapVersion | null, ApiError> {
  const api = useApi();
  return useQuery<MapVersion | null, ApiError>({
    queryKey: queryKeys.published(tenantSlug ?? "", mapSlug ?? ""),
    queryFn: () => api.getPublished(tenantSlug ?? "", mapSlug ?? ""),
    enabled: Boolean(tenantSlug) && Boolean(mapSlug),
    refetchInterval: options.pollMs ?? false,
    refetchIntervalInBackground: false,
  });
}

/* ------------------------------------------------------------- mutations */

/** A new session means every cached answer belonged to someone else. */
function startSession(client: QueryClient, session: Session): void {
  client.removeQueries({ queryKey: queryKeys.maps });
  client.removeQueries({ queryKey: queryKeys.templates });
  client.setQueryData(queryKeys.session, session);
}

export function useSignInAsGuest(): UseMutationResult<Session, ApiError, { humanCheckToken?: string }> {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<Session, ApiError, { humanCheckToken?: string }>({
    mutationFn: (input) => api.signInAsGuest(input),
    onSuccess: (session) => startSession(client, session),
  });
}

export function useSignInWithToken(): UseMutationResult<Session, ApiError, string> {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<Session, ApiError, string>({
    mutationFn: (token) => api.signInWithToken(token),
    onSuccess: (session) => startSession(client, session),
  });
}

export function useSignOut(): UseMutationResult<void, ApiError, void> {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => api.signOut(),
    onSuccess: () => {
      client.removeQueries({ queryKey: queryKeys.maps });
      client.removeQueries({ queryKey: queryKeys.templates });
      client.removeQueries({ queryKey: queryKeys.session });
    },
  });
}

export type CreateMapInput = { title: RichText; uiDir: Exclude<TextDir, "auto">; template: TemplateSummary["id"] };

export function useCreateMap(): UseMutationResult<MapDoc, ApiError, CreateMapInput> {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<MapDoc, ApiError, CreateMapInput>({
    mutationFn: (input) => api.createMap(input),
    onSuccess: (map) => {
      /* A new map has no features, so its draft is known without asking. */
      client.setQueryData<MapDetail>(queryKeys.map(map.id), { map, features: [] });
      void client.invalidateQueries({ queryKey: queryKeys.mapLists });
      void client.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

function afterArchiveChange(client: QueryClient, id: string): void {
  void client.invalidateQueries({ queryKey: queryKeys.mapLists });
  void client.invalidateQueries({ queryKey: queryKeys.map(id) });
  /* Archived maps do not count against the workspace's limit. */
  void client.invalidateQueries({ queryKey: queryKeys.session });
}

export function useArchiveMap(): UseMutationResult<void, ApiError, string> {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api.archiveMap(id),
    onSuccess: (_result, id) => afterArchiveChange(client, id),
  });
}

export function useUnarchiveMap(): UseMutationResult<void, ApiError, string> {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api.unarchiveMap(id),
    onSuccess: (_result, id) => afterArchiveChange(client, id),
  });
}

function afterVersionChange(client: QueryClient, id: string): void {
  void client.invalidateQueries({ queryKey: queryKeys.versions(id) });
  /* `publishedVersion` and `publishedRev` live on the document and in the list. */
  void client.invalidateQueries({ queryKey: queryKeys.map(id) });
  void client.invalidateQueries({ queryKey: queryKeys.mapLists });
  void client.invalidateQueries({ queryKey: ["published"] });
}

export type RollbackInput = { id: string; toVersion: number };
export type RollbackResult = { status: "rolled_back"; version: number };

/** Republish an old version as a new one. The draft is not touched. */
export function useRollbackMap(): UseMutationResult<RollbackResult, ApiError, RollbackInput> {
  const api = useApi();
  const client = useQueryClient();
  return useMutation<RollbackResult, ApiError, RollbackInput>({
    mutationFn: ({ id, toVersion }) => api.rollbackMap(id, { toVersion }),
    onSuccess: (_result, { id }) => afterVersionChange(client, id),
  });
}
