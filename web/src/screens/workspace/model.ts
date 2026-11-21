import type { ProductState } from "@/components/state-badge";
import type { ShellStrings } from "@/i18n/shell";
import type { LngLat, MapSummary, Session, TextDir } from "@/model/types";

export type Dir = Exclude<TextDir, "auto">;

/* ------------------------------------------------------------ direction */

const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/u;
const ANY_LETTER = /\p{L}/u;

/** The direction of the first strong character, as the Unicode bidi rule P2 reads a paragraph. */
export function firstStrongDir(text: string): Dir | null {
  for (const char of text) {
    if (RTL_LETTER.test(char)) return "rtl";
    if (ANY_LETTER.test(char)) return "ltr";
  }
  return null;
}

export function resolveDir(text: { value: string; dir: TextDir }, fallback: Dir): Dir {
  return text.dir === "auto" ? (firstStrongDir(text.value) ?? fallback) : text.dir;
}

/* --------------------------------------------------------------- search */

/**
 * Folds a title for matching: case, Latin accents, Arabic diacritics and
 * tatweel, and the letter variants that are typed interchangeably
 * (alef with hamza or madda, alef maqsura, ta marbuta).
 */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\p{M}\u0640]/gu, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesSearch(map: MapSummary, folded: string): boolean {
  return folded.length === 0 || foldForSearch(map.title.value).includes(folded);
}

/* ----------------------------------------------------------------- sort */

export type SortKey = "title" | "updated" | "features";
export interface Sort {
  key: SortKey;
  descending: boolean;
}

export const DEFAULT_SORT: Sort = { key: "updated", descending: true };

/** The direction a column starts in when it is first chosen. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, descending: !current.descending };
  return { key, descending: key !== "title" };
}

const collator = new Intl.Collator(["en", "ar"], { sensitivity: "base", numeric: true });

export function sortMaps(maps: MapSummary[], sort: Sort): MapSummary[] {
  const sign = sort.descending ? -1 : 1;
  return [...maps].sort((a, b) => {
    const order =
      sort.key === "title"
        ? collator.compare(a.title.value, b.title.value)
        : sort.key === "features"
          ? a.featureCount - b.featureCount
          : Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    return order !== 0 ? order * sign : collator.compare(a.id, b.id);
  });
}

/* ---------------------------------------------------------------- state */

export function publishState(map: MapSummary, t: ShellStrings["ws"]): { state: ProductState; label: string } {
  if (map.archived) {
    return { state: "archived", label: map.publishedVersion === null ? t.stateArchived : t.stateArchivedLive(map.publishedVersion) };
  }
  if (map.publishedVersion === null) return { state: "draft", label: t.stateNever };
  if (map.publishedRev !== null && map.rev > map.publishedRev) return { state: "draft", label: t.stateAhead(map.publishedVersion) };
  return { state: "live", label: t.stateLive(map.publishedVersion) };
}

/** A limit is "close" from four fifths of the way there. */
export function isNear(used: number, max: number): boolean {
  return max > 0 && used < max && used / max >= 0.8;
}

/* --------------------------------------------------------------- access */

export function canEdit(session: Session, map: MapSummary): boolean {
  if (!session.capabilities.includes("map:edit") || map.archived) return false;
  return session.role !== "contributor" || map.createdBy.userId === session.userId;
}

/* ------------------------------------------------------------ geography */

/** "23.61° N, 58.59° E" */
export function formatCentre([lng, lat]: LngLat): string {
  const part = (value: number, positive: string, negative: string): string =>
    `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;
  return `${part(lat, "N", "S")}, ${part(lng, "E", "W")}`;
}
