// Fractional indexing for feature z-order, so a reorder is a single-row write.
//
// A key is the base-62 fractional part of a number in (0, 1): `"V"` is 0.V,
// `"V0F"` is 0.V0F. Lexicographic and numeric order agree, so Postgres sorts
// the raw text column. Shorter keys are zero-padded: 0.V === 0.V000.
//
// Invariant: no key may end in `"0"`. Otherwise `between("V", "V0")` has no
// answer — everything above `"V"` and below `"V0"` would have to start with
// `"V0"`, and `"V0"` is a prefix of all of those, so they sort above it.

const DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

const LOWEST = DIGITS[0]!;
const MID_DIGIT = DIGITS[Math.floor(BASE / 2)]!;

function digitValue(ch: string): number {
  const i = DIGITS.indexOf(ch);
  if (i < 0) throw new Error(`invalid order key digit: ${JSON.stringify(ch)}`);
  return i;
}

/** Zero-padded past the end of `key` — the fraction interpretation. */
function digitAt(key: string, i: number): number {
  return i < key.length ? digitValue(key[i]!) : 0;
}

export function isValidOrderKey(key: string): boolean {
  if (key.length === 0) return false;
  for (const ch of key) if (DIGITS.indexOf(ch) < 0) return false;
  return !key.endsWith(LOWEST);
}

/** Repair a key that would violate the no-trailing-zero invariant. */
function normaliseKey(k: string): string {
  let out = k;
  while (out.endsWith(LOWEST)) out += MID_DIGIT;
  return out;
}

/** A key strictly greater than `a`. */
function appendAfter(a: string): string {
  const d = digitAt(a, 0);
  // Bumping the leading digit beats `a` outright: the comparison is decided at
  // position 0.
  if (d + 1 < BASE) return normaliseKey(DIGITS[d + 1]!);
  return normaliseKey(a + MID_DIGIT);
}

/** A key strictly less than `b`. */
function prependBefore(b: string): string {
  const d = digitAt(b, 0);
  if (d >= 1) return normaliseKey(DIGITS[d - 1]!);
  // Cannot step down at this position, so descend. The invariant guarantees a
  // non-zero digit further along, so the recursion terminates.
  return normaliseKey(LOWEST + prependBefore(b.slice(1)));
}

/**
 * A key strictly between `a` and `b`. `null` means an open end:
 * `between(null, null)` seeds an empty list.
 */
export function between(a: string | null, b: string | null): string {
  if (a !== null && !isValidOrderKey(a)) {
    throw new Error(`invalid lower order key: ${a}`);
  }
  if (b !== null && !isValidOrderKey(b)) {
    throw new Error(`invalid upper order key: ${b}`);
  }

  if (a === null && b === null) return MID_DIGIT;
  if (b === null) return appendAfter(a!);
  if (a === null) return prependBefore(b);

  if (a >= b) throw new Error(`order keys out of sequence: ${a} >= ${b}`);

  // Walk the shared prefix in FRACTION terms: an exhausted key contributes
  // implicit zeros rather than ending the walk. Stopping at the end of `a`
  // instead returns `b` itself rather than a midpoint.
  const limit = Math.max(a.length, b.length);
  let i = 0;
  while (i < limit && digitAt(a, i) === digitAt(b, i)) i++;

  // a < b guarantees a divergence within `limit`.
  const av = digitAt(a, i);
  const bv = digitAt(b, i);

  // Prefix from `b`: where `a` is exhausted the agreeing digits live in `b`,
  // and on the overlapping range the two are equal anyway.
  const prefix = b.slice(0, i);

  if (bv - av >= 2) {
    return normaliseKey(prefix + DIGITS[av + Math.floor((bv - av) / 2)]!);
  }

  // Adjacent digits leave no room here, so keep `a`'s digit and go finer:
  // anything above `a`'s tail still sits below `b`, which won at position i.
  const head = prefix + DIGITS[av]!;
  const tail = a.slice(i + 1);
  return normaliseKey(head + (tail.length === 0 ? MID_DIGIT : appendAfter(tail)));
}

/** `count` keys appended after `after`, ascending. */
export function sequenceAfter(
  after: string | null,
  count: number,
): string[] {
  const out: string[] = [];
  let prev = after;
  for (let i = 0; i < count; i++) {
    const k = between(prev, null);
    out.push(k);
    prev = k;
  }
  return out;
}

/** Ties broken by id. */
export function compareOrder(
  a: { at: string; id: string },
  b: { at: string; id: string },
): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
