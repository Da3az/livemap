import { useEffect, useState } from "react";
import { usePlaceSearch } from "@/api/hooks";
import type { EditorController } from "@/editor/controller";
import { formatCoordinates, parseCoordinates } from "@/editor/store";
import type { LngLat, PlaceResult } from "@/model/types";
import { firstStrongDir } from "../shared/format";

/** One thing place search can take the map to. */
export interface PlaceHit {
  id: string;
  name: PlaceResult["name"];
  /** The country for a named place; empty for coordinates, which say where they came from instead. */
  context: string;
  at: LngLat;
  bounds: PlaceResult["bounds"];
  source: "coordinates" | "link" | "gazetteer";
}

export type PlaceStatus =
  /** Nothing typed. */
  | "idle"
  /** One character: not enough to search a name. */
  | "short"
  | "searching"
  | "ready"
  | "empty"
  | "rate_limited"
  | "offline"
  | "error";

export interface PlaceResults {
  hits: PlaceHit[];
  status: PlaceStatus;
  /** Epoch milliseconds at which a rate-limited search may be tried again. */
  retryAt: number | null;
  retry: () => void;
}

const DEBOUNCE_MS = 250;

function useDebounced(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * What a query finds. Coordinates and Google Maps links are read on the
 * spot and never reach the server; anything else is searched as a name, in
 * the language it was typed in, after a short pause in typing.
 */
export function usePlaceResults(raw: string): PlaceResults {
  const query = raw.trim();
  const at = parseCoordinates(query);
  const settled = useDebounced(at === null ? query : "", DEBOUNCE_MS);
  const language = firstStrongDir(settled) === "rtl" ? "ar" : "en";
  const search = usePlaceSearch(settled, language);

  if (at !== null) {
    const hit: PlaceHit = {
      id: `at:${at[0]},${at[1]}`,
      name: { value: formatCoordinates(at), dir: "ltr" },
      context: "",
      at,
      bounds: null,
      source: /^https?:\/\//i.test(query) ? "link" : "coordinates",
    };
    return { hits: [hit], status: "ready", retryAt: null, retry: () => undefined };
  }

  const retry = (): void => void search.refetch();
  if (query === "") return { hits: [], status: "idle", retryAt: null, retry };
  if (query.length < 2) return { hits: [], status: "short", retryAt: null, retry };

  const waiting = settled !== query || search.isPending || search.isPlaceholderData;
  if (search.error !== null && !search.isFetching) {
    const code = search.error.code;
    if (code === "rate_limited") {
      const retryAt = search.errorUpdatedAt + (search.error.retryAfter ?? 5) * 1000;
      return { hits: [], status: "rate_limited", retryAt, retry };
    }
    return { hits: [], status: code === "network" ? "offline" : "error", retryAt: null, retry };
  }

  const hits = (search.data ?? []).map((place): PlaceHit => ({ ...place, source: "gazetteer" }));
  if (waiting) return { hits, status: "searching", retryAt: null, retry };
  return { hits, status: hits.length === 0 ? "empty" : "ready", retryAt: null, retry };
}

/** Take the map to a place: its extent when it has one, otherwise close in on the point. */
export function flyTo(controller: EditorController | null, hit: Pick<PlaceHit, "at" | "bounds">): void {
  if (controller === null) return;
  if (hit.bounds !== null) {
    controller.fitBounds(hit.bounds);
    return;
  }
  controller.setViewport({ center: hit.at, zoom: Math.max(controller.getViewport().zoom, 11) }, { animate: true });
}
