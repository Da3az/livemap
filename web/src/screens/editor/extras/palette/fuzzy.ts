/**
 * Matching for the command palette and the shortcut sheet: forgiving of
 * case, accents, Arabic spelling variants and a slipped key.
 */

/** Text reduced to what is compared: lower case, no accents or Arabic vowel marks, one form of alef, yeh and teh marbuta. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036F\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Edit distance counting a swap of neighbours as one slip; stops caring past `limit`. */
function slips(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1];
      let cost = Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (same ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, (twoBack[j - 2] ?? 0) + 1);
      row.push(cost);
      if (cost < best) best = cost;
    }
    if (best > limit) return limit + 1;
    twoBack = previous;
    previous = row;
  }
  return previous[b.length] ?? limit + 1;
}

/** The letters of `token` in order somewhere in `text`; returns how spread out they are, or null. */
function scattered(token: string, text: string): number | null {
  let at = -1;
  let first = -1;
  for (const char of token) {
    at = text.indexOf(char, at + 1);
    if (at < 0) return null;
    if (first < 0) first = at;
  }
  const spread = at - first + 1 - token.length;
  return spread <= token.length ? spread : null;
}

function scoreToken(token: string, text: string, words: readonly string[]): number | null {
  if (text.startsWith(token)) return 0;
  if (words.some((word) => word.startsWith(token))) return 1;
  if (text.includes(token)) return 2;
  if (token.length >= 4) {
    const allowed = token.length >= 8 ? 2 : 1;
    let best = allowed + 1;
    for (const word of words) {
      best = Math.min(best, slips(token, word.slice(0, token.length), allowed), slips(token, word.slice(0, token.length + 1), allowed));
    }
    if (best <= allowed) return 3 + best;
  }
  if (token.length >= 3) {
    const spread = scattered(token, text);
    if (spread !== null) return 6 + spread / 10;
  }
  return null;
}

/**
 * How well folded `text` answers a folded query: lower is better, null is no
 * match. Every word of the query has to be found.
 */
export function matchScore(query: string, text: string): number | null {
  if (query === "") return 0;
  const words = text.split(/[\s:·/()-]+/).filter((word) => word !== "");
  let total = 0;
  for (const token of query.split(" ")) {
    const score = scoreToken(token, text, words);
    if (score === null) return null;
    total += score;
  }
  return total;
}
