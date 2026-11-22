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

/** Segment flags. */
export const SEG_PREV = 1;
export const SEG_NEXT = 2;
export const SEG_START_BUTT = 4;
export const SEG_END_BUTT = 8;
export const SEG_ROUND_DASH = 16;

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
  /** Atlas entries referenced, for keeping them resident. */
  readonly images = new Set<number>();

  constructor(capacity = 16) {
    const buffer = new ArrayBuffer(Math.max(1, capacity) * BYTES);
    this.f32 = new Float32Array(buffer);
    this.u32 = new Uint32Array(buffer);
    this.src = new Float64Array(Math.max(1, capacity) * 6);
  }

  reset(origin: Pt): void {
    this.count = 0;
    this.images.clear();
    this.gx = origin.x;
    this.gy = origin.y;
    this.version++;
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
    this.u32[o + META] = (type | (this.slot << 8)) >>> 0;
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
  segment(a: Pt, b: Pt, prev: Pt | null, next: Pt | null, halfWidth: number, color: number, flags: number, dashRow: number, phase: number): void {
    const index = this.grow();
    this.put(index, a, b, null, PrimType.Segment, color);
    const o = index * WORDS;
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
      if ((u32[o + META]! & 255) === PrimType.Triangle) {
        f32[o + EXTRA] = src[s + 4]! - origin.x;
        f32[o + EXTRA + 1] = src[s + 5]! - origin.y;
      }
    }
    this.version++;
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
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.f32.buffer, 0, this.count * BYTES);
  }
}
