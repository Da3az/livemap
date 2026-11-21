import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import type { ApiError } from "@/api/client";
import { useApi } from "@/app/providers";
import type { MapVersion, VersionPointer } from "@/model/types";

export interface LiveMap {
  /** The artifact the pointer names, or null when the map is not published. */
  data: MapVersion | null | undefined;
  isPending: boolean;
  isError: boolean;
  error: ApiError | null;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * What a reader follows: the slug's pointer, polled with its etag so an
 * unchanged map costs a 304, and the artifact it names, fetched once per
 * version and never again (artifacts are immutable).
 */
export function useLiveMap(tenantSlug: string | undefined, mapSlug: string | undefined, options: { pollMs: number }): LiveMap {
  const api = useApi();
  const client = useQueryClient();
  const tenant = tenantSlug ?? "";
  const slug = mapSlug ?? "";
  const enabled = tenant !== "" && slug !== "";
  const pointerKey = ["published-pointer", tenant, slug] as const;
  /* The last pointer seen, so a poll can say which etag it already has. */
  const last = useRef<VersionPointer | null>(null);

  const pointer = useQuery<VersionPointer, ApiError>({
    queryKey: pointerKey,
    queryFn: async () => {
      const answer = await api.getPublishedPointer(tenant, slug, { ifNoneMatch: last.current?.etag ?? null });
      if (answer.notModified && last.current) return last.current;
      if (answer.notModified) throw new Error("The server answered 304 to a first request.");
      last.current = answer.pointer;
      return answer.pointer;
    },
    enabled,
    refetchInterval: options.pollMs,
    refetchIntervalInBackground: false,
  });

  const version = pointer.data?.version ?? null;
  const artifact = useQuery<MapVersion, ApiError>({
    queryKey: ["published-version", tenant, slug, version],
    queryFn: () => api.getPublishedVersion(tenant, slug, version ?? 0),
    enabled: enabled && version !== null,
    staleTime: Infinity,
    /* An artifact never changes; one per version stays while the reader is here. */
    gcTime: 10 * 60_000,
    placeholderData: (previous) => previous,
  });

  const refetch = useCallback(() => client.invalidateQueries({ queryKey: ["published-pointer", tenant, slug] }), [client, tenant, slug]);

  const unpublished = pointer.data !== undefined && version === null;
  return {
    data: unpublished ? null : artifact.data,
    isPending: pointer.isPending || (version !== null && artifact.isPending),
    isError: pointer.isError || artifact.isError,
    error: pointer.error ?? artifact.error ?? null,
    isFetching: pointer.isFetching || artifact.isFetching,
    refetch,
  };
}
