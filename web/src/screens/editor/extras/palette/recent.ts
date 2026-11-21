const KEY = "livemap.palette.recent";
const LIMIT = 6;

/** Ids of the commands run most recently, newest first. */
export function readRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string").slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(id: string): void {
  try {
    const next = [id, ...readRecent().filter((existing) => existing !== id)].slice(0, LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage is unavailable; the palette still works without a history */
  }
}
