import type { Pt } from "../geo";

/**
 * The one primitive the GPU draws: an instance of a four-vertex strip. Every
 * piece of every feature (a fill triangle, a stroke segment, an edge's
 * anti-aliasing fringe, a disc, an image from the atlas) is one instance, so
 * the whole map is one instanced draw call and the draw order is simply the
 * order of the instances. That is what keeps the order free across kinds.
 *
 * Positions are stored as float32 offsets from an origin `G` near the camera
 * and kept as float64 beside them, so they can be re-encoded when the camera
 * moves far from `G` (see `PrimBuffer.rebase`). Nothing the GPU multiplies is
 * ever large, so nothing jitters at any zoom.
 */

export const enum PrimType {
  None = 0,
  Triangle = 1,
  Segment = 2,
  Fringe = 3,
  Disc = 4,
  Image = 5,
  /** Front-line teeth along one stroke segment, drawn by the fragment shader at this zoom's spacing. */
  Teeth = 6,
  /** An arrowhead at a fixed tip, sized and turned by the GPU from this zoom's per-arrow values. */
  Head = 7,
}

/**
 * Which camera an instance belongs to. Without pitch, dash phases, arrow
 * trims and teeth are computed on the GPU from this zoom's scale, so those
 * instances are built once (`Flat`). With pitch, the screen is not a scaled
 * copy of mercator, and the CPU builds them every frame instead (`Pitched`).
 */
export const enum PrimMode {
  Both = 0,
  Flat = 16,
  Pitched = 32,
}

/** 32-bit words per instance. */
export const WORDS = 16;
export const BYTES = WORDS * 4;

/** Word offsets. */
const A = 0;
const B = 2;
const EXTRA = 4;
const PARAMS = 8;
const COLOR = 12;
const WRAP = 13;
const META = 14;
/** Cumulative mercator distance along the path at a segment's start. */
const AUX = 15;

/** Segment flags. */
export const SEG_PREV = 1;
export const SEG_NEXT = 2;
export const SEG_START_BUTT = 4;
export const SEG_END_BUTT = 8;
export const SEG_ROUND_DASH = 16;
/** The dash phase is the cumulative distance times this zoom's scale, computed by the GPU. */
export const SEG_SCALED_PHASE = 32;
/** The path is cut where the feature's per-zoom trim says (an arrow shaft stopping at its heads). */
export const SEG_TRIMMED = 64;

let changes = 0;

/** Bumped whenever any buffer changes, so an unchanged frame can skip looking for changes. */
export function bufferChanges(): number {
  return changes;
}

/** Premultiplied RGBA8, as one little-endian word. */
export function packColor(rgba: readonly [number, number, number, number]): number {
  const [r, g, b, a] = rgba;
  const alpha = Math.max(0, Math.min(1, a));
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * alpha)));
  return (byte(r) | (byte(g) << 8) | (byte(b) << 16) | (Math.round(alpha * 255) << 24)) >>> 0;
}

/**
 * A growable list of instances with their float64 positions. One feature's
 * static part, its view-dependent part, the label pass and the draft are
 * each one buffer.
 */
export class PrimBuffer {
  f32: Float32Array;
  u32: Uint32Array;
  /** A.x, A.y, B.x, B.y, C.x, C.y per instance, absolute mercator; NaN when unused. */
  src: Float64Array;
  count = 0;
  /** Bumped on every change, for uploads. */
  version = 0;
  /** The origin the float32 offsets are relative to. */
  private gx = 0;
  private gy = 0;

  /** Per-instance context set by the emitter. */
  wrapRef = 0;
  slot = 0;
  mode: PrimMode = PrimMode.Both;
  /** Atlas entries referenced, for keeping them resident. */
  readonly images = new Set<number>();
  /** Instances the GPU should leave room for, beyond the current count (a label pass that can grow). */
  reserve = 0;

  constructor(capacity = 16) {
    const buffer = new ArrayBuffer(Math.max(1, capacity) * BYTES);
    this.f32 = new Float32Array(buffer);
    this.u32 = new Uint32Array(buffer);
    this.src = new Float64Array(Math.max(1, capacity) * 6);
  }

  reset(origin: Pt): void {
    this.count = 0;
    this.mode = PrimMode.Both;
    this.images.clear();
    this.gx = origin.x;
    this.gy = origin.y;
    this.version++;
    changes++;
  }

  private grow(): number {
    if (this.count * WORDS >= this.f32.length) {
      const next = new ArrayBuffer(this.f32.length * 4 * 2);
      new Uint8Array(next).set(new Uint8Array(this.f32.buffer));
      this.f32 = new Float32Array(next);
      this.u32 = new Uint32Array(next);
      const src = new Float64Array(this.src.length * 2);
      src.set(this.src);
      this.src = src;
    }
    const index = this.count++;
    this.f32.fill(0, index * WORDS, index * WORDS + WORDS);
    this.version++;
    changes++;
    return index;
  }

  private put(index: number, a: Pt, b: Pt | null, c: Pt | null, type: PrimType, color: number): void {
    const o = index * WORDS;
    const s = index * 6;
    this.src[s] = a.x;
    this.src[s + 1] = a.y;
    this.src[s + 2] = b ? b.x : NaN;
    this.src[s + 3] = b ? b.y : NaN;
    this.src[s + 4] = c ? c.x : NaN;
    this.src[s + 5] = c ? c.y : NaN;
    this.f32[o + A] = a.x - this.gx;
    this.f32[o + A + 1] = a.y - this.gy;
    if (b) {
      this.f32[o + B] = b.x - this.gx;
      this.f32[o + B + 1] = b.y - this.gy;
    }
    if (c) {
      this.f32[o + EXTRA] = c.x - this.gx;
      this.f32[o + EXTRA + 1] = c.y - this.gy;
    }
    this.u32[o + COLOR] = color;
    this.f32[o + WRAP] = this.wrapRef;
    this.u32[o + META] = (type | this.mode | (this.slot << 8)) >>> 0;
  }

  /**
   * A filled triangle. `paint` 0 is solid, otherwise a pattern layer + 1.
   * `outline` flags the edges on the shape's outline (bit 0 a–b, 1 b–c,
   * 2 c–a): coverage ramps down over the last half pixel inside them, and a
   * fringe supplies the half pixel outside.
   */
  triangle(a: Pt, b: Pt, c: Pt, color: number, paint: number, outline: number): void {
    const index = this.grow();
    this.put(index, a, b, c, PrimType.Triangle, color);
    this.f32[index * WORDS + PARAMS] = paint;
    this.f32[index * WORDS + PARAMS + 1] = outline;
  }

  /**
   * One stroke segment a→b. `prev` and `next` are the neighbouring vertices
   * of the same path: each pixel near a joint belongs to exactly one segment
   * (the nearer), so a translucent stroke is not darkened where pieces meet.
   */
  segment(a: Pt, b: Pt, prev: Pt | null, next: Pt | null, halfWidth: number, color: number, flags: number, dashRow: number, phase: number, along = 0): void {
    const index = this.grow();
    this.put(index, a, b, null, PrimType.Segment, color);
    const o = index * WORDS;
    this.f32[o + AUX] = along;
    let f = flags;
    if (prev) {
      f |= SEG_PREV;
      this.f32[o + EXTRA] = prev.x - a.x;
      this.f32[o + EXTRA + 1] = prev.y - a.y;
    }
    if (next) {
      f |= SEG_NEXT;
      this.f32[o + EXTRA + 2] = next.x - b.x;
      this.f32[o + EXTRA + 3] = next.y - b.y;
    }
    this.f32[o + PARAMS] = halfWidth;
    this.f32[o + PARAMS + 1] = phase;
    this.f32[o + PARAMS + 2] = dashRow;
    this.f32[o + PARAMS + 3] = f;
  }

  /**
   * An arrowhead whose tip is fixed: `end` true for the head at the path's
   * end, false for a double arrow's tail. Its length and direction for the
   * current zoom come from the arrow's per-zoom values; `casing` draws the
   * 2 px outline weak colours get.
   */
  head(tip: Pt, end: boolean, casing: boolean, color: number): void {
    const index = this.grow();
    this.put(index, tip, null, null, PrimType.Head, color);
    const o = index * WORDS;
    this.f32[o + PARAMS] = end ? 0 : 1;
    this.f32[o + PARAMS + 1] = casing ? 1 : 0;
  }

  /**
   * The teeth a front line carries along segment a→b, whose start is `along`
   * mercator units into the path. `side` is +1 for teeth on the left of the
   * direction of travel as the screen shows it. `casing` draws the 2 px
   * outline the 2D renderer stroked around weak-coloured teeth.
   */
  teeth(a: Pt, b: Pt, along: number, size: number, spacing: number, side: 1 | -1, semicircle: boolean, casing: boolean, color: number): void {
    const index = this.grow();
    this.put(index, a, b, null, PrimType.Teeth, color);
    const o = index * WORDS;
    this.f32[o + PARAMS] = size;
    this.f32[o + PARAMS + 1] = spacing;
    this.f32[o + PARAMS + 2] = side * (semicircle ? 2 : 1);
    this.f32[o + PARAMS + 3] = casing ? 1 : 0;
    this.f32[o + AUX] = along;
  }

  /** The anti-aliased outside edge of a fill, on the side given by `side` (±1 of the edge's left normal). */
  fringe(a: Pt, b: Pt, side: number, color: number, paint: number): void {
    const index = this.grow();
    this.put(index, a, b, null, PrimType.Fringe, color);
    const o = index * WORDS;
    this.f32[o + PARAMS] = side;
    this.f32[o + PARAMS + 1] = paint;
  }

  disc(centre: Pt, radius: number, color: number): void {
    const index = this.grow();
    this.put(index, centre, null, null, PrimType.Disc, color);
    this.f32[index * WORDS + PARAMS] = radius;
  }

  /** An atlas image whose origin sits on `anchor`, snapped to whole device pixels. */
  image(anchor: Pt, entry: number): void {
    const index = this.grow();
    this.put(index, anchor, null, null, PrimType.Image, 0);
    this.f32[index * WORDS + PARAMS] = entry;
    this.images.add(entry);
  }

  /** Re-encodes every offset against a new origin. */
  rebase(origin: Pt): void {
    if (origin.x === this.gx && origin.y === this.gy) return;
    this.gx = origin.x;
    this.gy = origin.y;
    const { f32, src, u32 } = this;
    for (let index = 0; index < this.count; index++) {
      const o = index * WORDS;
      const s = index * 6;
      f32[o + A] = src[s]! - origin.x;
      f32[o + A + 1] = src[s + 1]! - origin.y;
      if (!Number.isNaN(src[s + 2]!)) {
        f32[o + B] = src[s + 2]! - origin.x;
        f32[o + B + 1] = src[s + 3]! - origin.y;
      }
      if ((u32[o + META]! & 15) === PrimType.Triangle) {
        f32[o + EXTRA] = src[s + 4]! - origin.x;
        f32[o + EXTRA + 1] = src[s + 5]! - origin.y;
      }
    }
    this.version++;
    changes++;
  }

  /** Changes the visibility slot of every instance (the item moved in the draw list). */
  setSlot(slot: number): void {
    if (slot === this.slot) return;
    this.slot = slot;
    const { u32 } = this;
    for (let index = 0; index < this.count; index++) {
      const o = index * WORDS + META;
      u32[o] = ((u32[o]! & 255) | (slot << 8)) >>> 0;
    }
    this.version++;
    changes++;
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.f32.buffer, 0, this.count * BYTES);
  }
}
