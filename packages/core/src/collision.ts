// Label de-confliction in screen space. Needed because annotations set
// `icon-ignore-placement` / `text-allow-overlap`, opting out of MapLibre's own
// collision engine so authored callouts are never silently dropped.

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CollisionItem {
  readonly id: string;
  /** Anchor position in screen px. */
  readonly anchor: readonly [number, number];
  /** Authored offset from the anchor, in px. */
  readonly offset: readonly [number, number];
  readonly width: number;
  readonly height: number;
  /** Higher wins: moves less, suppressed last. */
  readonly priority?: number;
  readonly pinned?: boolean;
}

export interface ResolvedItem {
  readonly id: string;
  /** The offset to actually render with. */
  readonly offset: readonly [number, number];
  /** Pixels moved from the authored offset. */
  readonly moved: number;
  /** Could not be placed without overlap; hide it. */
  readonly suppressed: boolean;
}

export interface DeconflictOptions {
  /** Extra space kept around each box, px. */
  readonly padding?: number;
  /** How far a label may be moved from its authored offset, px. */
  readonly maxDeviation?: number;
  readonly iterations?: number;
  /** Labels are kept inside it; one that cannot fit is suppressed. */
  readonly viewport?: Rect;
  /** Obstacles labels must avoid but that never move, e.g. a legend panel. */
  readonly obstacles?: readonly Rect[];
}

const DEFAULTS = {
  padding: 3,
  maxDeviation: 36,
  iterations: 60,
} as const;

/** Padded box for an item at a given offset. */
function rectFor(
  item: CollisionItem,
  offset: readonly [number, number],
  padding: number,
): Rect {
  // Centred on the offset point, not top-left anchored: symmetric geometry
  // keeps the relaxation from drifting toward one corner.
  return {
    x: item.anchor[0] + offset[0] - item.width / 2 - padding,
    y: item.anchor[1] + offset[1] - item.height / 2 - padding,
    width: item.width + padding * 2,
    height: item.height + padding * 2,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Minimum translation vector to separate `a` from `b`, applied to `a`. */
function mtv(a: Rect, b: Rect): [number, number] {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;

  const overlapX = (a.width + b.width) / 2 - Math.abs(ax - bx);
  const overlapY = (a.height + b.height) / 2 - Math.abs(ay - by);

  if (overlapX <= 0 || overlapY <= 0) return [0, 0];

  // Push along the axis of least penetration.
  if (overlapX < overlapY) {
    return [ax < bx ? -overlapX : overlapX, 0];
  }
  return [0, ay < by ? -overlapY : overlapY];
}

function clampDeviation(
  authored: readonly [number, number],
  current: readonly [number, number],
  max: number,
): [number, number] {
  const dx = current[0] - authored[0];
  const dy = current[1] - authored[1];
  const d = Math.hypot(dx, dy);
  if (d <= max) return [current[0], current[1]];
  const s = max / d;
  return [authored[0] + dx * s, authored[1] + dy * s];
}

function containInViewport(
  item: CollisionItem,
  offset: readonly [number, number],
  vp: Rect,
  padding: number,
): [number, number] {
  const r = rectFor(item, offset, padding);
  let ox = offset[0];
  let oy = offset[1];

  if (r.x < vp.x) ox += vp.x - r.x;
  if (r.y < vp.y) oy += vp.y - r.y;
  if (r.x + r.width > vp.x + vp.width) {
    ox -= r.x + r.width - (vp.x + vp.width);
  }
  if (r.y + r.height > vp.y + vp.height) {
    oy -= r.y + r.height - (vp.y + vp.height);
  }
  return [ox, oy];
}

/**
 * Resolve overlaps among a set of labels. Processing order is stable (priority,
 * then id) — anything non-deterministic makes labels jitter between frames.
 */
export function deconflict(
  items: readonly CollisionItem[],
  options: DeconflictOptions = {},
): ResolvedItem[] {
  const opts = { ...DEFAULTS, ...options };
  const obstacles = opts.obstacles ?? [];

  const order = [...items].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const authored = new Map<string, readonly [number, number]>();
  const current = new Map<string, [number, number]>();
  for (const it of order) {
    authored.set(it.id, it.offset);
    current.set(it.id, [it.offset[0], it.offset[1]]);
  }

  const byId = new Map(order.map((i) => [i.id, i]));

  for (let iter = 0; iter < opts.iterations; iter++) {
    let moved = false;

    for (let i = 0; i < order.length; i++) {
      const a = order[i]!;
      if (a.pinned) continue;
      const aOff = current.get(a.id)!;
      let pushX = 0;
      let pushY = 0;

      for (let j = 0; j < order.length; j++) {
        if (i === j) continue;
        const b = order[j]!;
        const ra = rectFor(a, aOff, opts.padding);
        const rb = rectFor(b, current.get(b.id)!, opts.padding);
        if (!rectsOverlap(ra, rb)) continue;

        const [mx, my] = mtv(ra, rb);
        // A pinned or higher-priority neighbour makes `a` do more of the move.
        const pa = (a.priority ?? 0) + 1;
        const pb = (b.priority ?? 0) + 1;
        const share = b.pinned ? 1 : pb / (pa + pb);
        pushX += mx * share;
        pushY += my * share;
      }

      // Static obstacles never yield.
      for (const ob of obstacles) {
        const ra = rectFor(a, aOff, opts.padding);
        if (!rectsOverlap(ra, ob)) continue;
        const [mx, my] = mtv(ra, ob);
        pushX += mx;
        pushY += my;
      }

      if (pushX === 0 && pushY === 0) continue;

      // Below 1, or two labels overshoot past each other and oscillate forever.
      const relax = 0.5;
      let next: [number, number] = [
        aOff[0] + pushX * relax,
        aOff[1] + pushY * relax,
      ];

      next = clampDeviation(authored.get(a.id)!, next, opts.maxDeviation);
      if (opts.viewport) {
        next = containInViewport(a, next, opts.viewport, opts.padding);
        next = clampDeviation(authored.get(a.id)!, next, opts.maxDeviation);
      }

      if (
        Math.abs(next[0] - aOff[0]) > 0.01 ||
        Math.abs(next[1] - aOff[1]) > 0.01
      ) {
        current.set(a.id, next);
        moved = true;
      }
    }

    if (!moved) break;
  }

  // Walking in priority order means the important label survives and anything
  // still overlapping it is the one suppressed.
  const placed: { id: string; rect: Rect }[] = [];
  const suppressed = new Set<string>();

  for (const it of order) {
    const off = current.get(it.id)!;
    const r = rectFor(it, off, opts.padding);

    let clash = placed.some((p) => rectsOverlap(r, p.rect));
    if (!clash) clash = obstacles.some((ob) => rectsOverlap(r, ob));
    if (!clash && opts.viewport) {
      // Off-viewport after clamping means it genuinely does not fit.
      clash =
        r.x < opts.viewport.x - 1 ||
        r.y < opts.viewport.y - 1 ||
        r.x + r.width > opts.viewport.x + opts.viewport.width + 1 ||
        r.y + r.height > opts.viewport.y + opts.viewport.height + 1;
    }

    if (clash) {
      suppressed.add(it.id);
    } else {
      placed.push({ id: it.id, rect: r });
    }
  }

  // Emit in the caller's original order, not priority order, so the result
  // zips against their input array.
  return items.map((it) => {
    const off = current.get(it.id)!;
    const a = authored.get(it.id)!;
    return {
      id: it.id,
      offset: off,
      moved: Math.hypot(off[0] - a[0], off[1] - a[1]),
      suppressed: suppressed.has(it.id),
    };
  });
}

/** News-graphic convention: upper-right, diagonals, then orthogonals. */
export const FALLBACK_OFFSETS: readonly (readonly [number, number])[] = [
  [18, -18],
  [-18, -18],
  [18, 18],
  [-18, 18],
  [0, -26],
  [0, 26],
  [26, 0],
  [-26, 0],
];

/**
 * Authored offset first, then `FALLBACK_OFFSETS`. Cheap enough for a single
 * late-added label, but it does not globally optimise — prefer `deconflict`.
 */
export function placeWithFallback(
  item: CollisionItem,
  occupied: readonly Rect[],
  options: DeconflictOptions = {},
): ResolvedItem {
  const opts = { ...DEFAULTS, ...options };
  const candidates = [item.offset, ...FALLBACK_OFFSETS];

  for (const off of candidates) {
    const r = rectFor(item, off, opts.padding);
    if (occupied.some((o) => rectsOverlap(r, o))) continue;
    if (opts.viewport) {
      const vp = opts.viewport;
      if (
        r.x < vp.x ||
        r.y < vp.y ||
        r.x + r.width > vp.x + vp.width ||
        r.y + r.height > vp.y + vp.height
      ) {
        continue;
      }
    }
    return {
      id: item.id,
      offset: off,
      moved: Math.hypot(off[0] - item.offset[0], off[1] - item.offset[1]),
      suppressed: false,
    };
  }

  return { id: item.id, offset: item.offset, moved: 0, suppressed: true };
}
