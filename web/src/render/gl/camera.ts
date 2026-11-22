import type { Pt } from "../geo";
import type { View } from "../view";

/**
 * The mapping from Web Mercator to CSS pixels for one frame, as a 3×3
 * homography over positions relative to the view's centre. Without pitch it
 * is the view's own affine calibration; with pitch the ground plane still
 * maps to the screen by a homography, solved from four points the map itself
 * unprojects. Everything is float64 here; the GPU only ever sees positions
 * relative to a nearby origin, so it never multiplies a large number.
 */
export interface GlCamera {
  /** The view centre in mercator; `H` takes positions relative to it. */
  origin: Pt;
  /** Row-major 3×3: (x − origin.x, y − origin.y, 1) → homogeneous CSS pixels. */
  h: Float64Array;
  inverse: Float64Array;
  width: number;
  height: number;
  /** CSS pixels per mercator unit at the centre, for precision decisions. */
  scale: number;
  pitched: boolean;
}

function invert3(m: Float64Array): Float64Array {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = det === 0 ? 0 : 1 / det;
  return new Float64Array([A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]);
}

/** Solves the homography taking four `from` points to four `to` points (h33 = 1), by Gaussian elimination. */
function solveHomography(from: readonly Pt[], to: readonly Pt[]): Float64Array | null {
  const rows: number[][] = [];
  for (let index = 0; index < 4; index++) {
    const p = from[index];
    const q = to[index];
    if (!p || !q) return null;
    rows.push([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y, q.x]);
    rows.push([0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y, q.y]);
  }
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    const top = rows[pivot]!;
    rows[pivot] = rows[column]!;
    rows[column] = top;
    const lead = top[column]!;
    if (Math.abs(lead) < 1e-300) return null;
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const target = rows[row]!;
      const factor = target[column]! / lead;
      if (factor === 0) continue;
      for (let k = column; k < 9; k++) target[k] = target[k]! - factor * top[k]!;
    }
  }
  const h = new Float64Array(9);
  for (let index = 0; index < 8; index++) h[index] = rows[index]![8]! / rows[index]![index]!;
  h[8] = 1;
  return h;
}

export function cameraFor(view: View): GlCamera {
  const { origin, scale } = view;
  const anchor = view.project(origin);
  if (view.pitch === 0) {
    /* The view is affine: its columns are where one step along each mercator axis lands. */
    const step = 256 / scale;
    const ex = view.project({ x: origin.x + step, y: origin.y });
    const ey = view.project({ x: origin.x, y: origin.y + step });
    const h = new Float64Array([(ex.x - anchor.x) / step, (ey.x - anchor.x) / step, anchor.x, (ex.y - anchor.y) / step, (ey.y - anchor.y) / step, anchor.y, 0, 0, 1]);
    return { origin, h, inverse: invert3(h), width: view.width, height: view.height, scale, pitched: false };
  }
  /*
   * Four screen points around the centre, well below the horizon, and where
   * the map says they are on the ground. Positions are scaled to pixels
   * before solving so the system is well conditioned at every zoom.
   */
  const reach = Math.max(16, Math.min(view.width, view.height) / 4);
  const screen = [
    { x: anchor.x - reach, y: anchor.y - reach },
    { x: anchor.x + reach, y: anchor.y - reach },
    { x: anchor.x + reach, y: anchor.y + reach },
    { x: anchor.x - reach, y: anchor.y + reach },
  ];
  const ground = screen.map((p) => {
    const m = view.unproject(p);
    return { x: (m.x - origin.x) * scale, y: (m.y - origin.y) * scale };
  });
  const solved = solveHomography(ground, screen);
  const h = solved ?? new Float64Array([1, 0, anchor.x, 0, 1, anchor.y, 0, 0, 1]);
  /* Fold the pixel scaling back in, so H takes mercator offsets directly. */
  for (const index of [0, 1, 3, 4, 6, 7]) h[index] = h[index]! * scale;
  return { origin, h, inverse: invert3(h), width: view.width, height: view.height, scale, pitched: true };
}

/** Mercator → CSS pixels through the camera; null behind the eye. */
export function projectWith(camera: GlCamera, p: Pt): Pt | null {
  const { h } = camera;
  const x = p.x - camera.origin.x;
  const y = p.y - camera.origin.y;
  const w = h[6]! * x + h[7]! * y + h[8]!;
  if (!(w > 1e-12)) return null;
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / w, y: (h[3]! * x + h[4]! * y + h[5]!) / w };
}

/** CSS pixels → mercator on the ground plane; null above the horizon. */
export function unprojectWith(camera: GlCamera, p: Pt): Pt | null {
  const m = camera.inverse;
  const w = m[6]! * p.x + m[7]! * p.y + m[8]!;
  if (w === 0 || !Number.isFinite(w)) return null;
  const x = (m[0]! * p.x + m[1]! * p.y + m[2]!) / w;
  const y = (m[3]! * p.x + m[4]! * p.y + m[5]!) / w;
  /* A point above the horizon maps to the ground behind the eye. */
  if (camera.pitched && projectWith(camera, { x: x + camera.origin.x, y: y + camera.origin.y }) === null) return null;
  return { x: x + camera.origin.x, y: y + camera.origin.y };
}
