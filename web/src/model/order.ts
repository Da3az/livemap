/**
 * Fractional draw-order keys. A key can always be made between two others, so
 * reordering one feature writes one feature. Keys compare as plain strings.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

/** A key strictly between `below` and `above`. null means "no bound on that side". */
export function keyBetween(below: string | null, above: string | null): string {
  let out = "";
  let upper = above;
  for (let i = 0; ; i++) {
    const lo = below !== null && i < below.length ? DIGITS.indexOf(below.charAt(i)) : 0;
    const hi = upper !== null && i < upper.length ? DIGITS.indexOf(upper.charAt(i)) : BASE;
    if (hi - lo > 1) return out + DIGITS.charAt(Math.floor((lo + hi) / 2));
    out += DIGITS.charAt(lo);
    // The digits are adjacent: keep the lower one and drop the upper bound,
    // so the rest only has to exceed what is left of `below`.
    if (hi - lo === 1) upper = null;
  }
}

/** `count` ascending keys strictly between the two bounds, evenly spread. */
export function keysBetween(below: string | null, above: string | null, count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [keyBetween(below, above)];
  const mid = Math.floor(count / 2);
  const middle = keyBetween(below, above);
  return [...keysBetween(below, middle, mid), middle, ...keysBetween(middle, above, count - mid - 1)];
}

export function compareOrder(a: { order: string; id: string }, b: { order: string; id: string }): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
