import { compareOrder, keysBetween } from "@/model/order";

/** Anything ordered by a fractional key: a feature or a group. */
export interface Keyed {
  id: string;
  order: string;
}

/** The result of making room for new keys. */
export interface KeyAllocation {
  /** Ascending keys for the items being placed. */
  keys: string[];
  /** Neighbours that had to be given a new key so the placement fits. Usually empty. */
  rekeyed: Map<string, string>;
}

/**
 * Keys longer than this are re-spaced rather than extended. Inserting at the
 * same spot grows a key by one character roughly every six inserts, so without
 * a cap a busy spot produces ever longer keys.
 */
export const MAX_KEY_LENGTH = 24;

function tryKeys(lo: string | null, hi: string | null, count: number, maxLength: number): string[] | null {
  if (lo !== null && hi !== null && lo >= hi) return null;
  const keys = keysBetween(lo, hi, count);
  let previous = lo;
  for (const key of keys) {
    if (key.length === 0 || key.length > maxLength) return null;
    if (previous !== null && key <= previous) return null;
    previous = key;
  }
  if (hi !== null && previous !== null && previous >= hi) return null;
  return keys;
}

/**
 * Keys for `count` items placed at `index` in `others` (ascending, as sorted by
 * `compareOrder`), i.e. between `others[index - 1]` and `others[index]`.
 *
 * Normally only the placed items get keys. When the two neighbours share a key,
 * when nothing fits below the lowest key, or when the fresh keys would exceed
 * `MAX_KEY_LENGTH`, the smallest run of neighbours around the gap is re-spaced
 * with them and reported in `rekeyed`.
 */
export function allocateKeys(others: readonly Keyed[], index: number, count: number): KeyAllocation {
  const at = Math.max(0, Math.min(index, others.length));
  if (count <= 0) return { keys: [], rekeyed: new Map() };
  let left = at;
  let right = at;
  let grow = 1;
  for (let attempt = 0; ; attempt++) {
    const lo = left > 0 ? (others[left - 1]?.order ?? null) : null;
    const hi = right < others.length ? (others[right]?.order ?? null) : null;
    const whole = left === 0 && right === others.length;
    const run = right - left;
    /* A re-spaced run must come out short, so the same spot does not need re-spacing again soon. */
    const maxLength = run === 0 ? MAX_KEY_LENGTH : MAX_KEY_LENGTH / 2;
    const keys = tryKeys(lo, hi, count + run, maxLength) ?? (whole ? keysBetween(null, null, count + run) : null);
    if (keys !== null) {
      const rekeyed = new Map<string, string>();
      const before = at - left;
      for (let i = 0; i < run; i++) {
        const item = others[left + i];
        const key = keys[i < before ? i : i + count];
        if (item !== undefined && key !== undefined && item.order !== key) rekeyed.set(item.id, key);
      }
      return { keys: keys.slice(before, before + count), rekeyed };
    }
    if (attempt >= 16) grow *= 2;
    left = Math.max(0, left - grow);
    right = Math.min(others.length, right + grow);
  }
}

/** Items in ascending order: bottom of the draw order first. */
export function sortKeyed<T extends Keyed>(items: Iterable<T>): T[] {
  return [...items].sort(compareOrder);
}
