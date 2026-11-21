/** Counting and bidi helpers shared by the editor dictionaries. */

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Arabic counted nouns: singular, dual, 3–10 plural, 11+ singular accusative. */
export function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n % 100 >= 3 && n % 100 <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** Wraps a name in directional isolates, so a Latin name inside an Arabic sentence (or the reverse) cannot reorder it. */
export const iso = (text: string): string => `\u2068${text}\u2069`;
