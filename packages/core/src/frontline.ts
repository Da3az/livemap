// Teeth are emitted as real geometry (closed rings), not a sprite, so they
// scale cleanly and take the feature's own colour with no sprite build step.

import type { FrontlineFeature, LngLat } from "./types.js";
import {
  destination,
  metresPerPixel,
  pathLength,
  resampleEvenly,
} from "./geo.js";

export type ToothShape = "triangle" | "tick" | "semicircle";

export interface BuiltFrontline {
  readonly base: readonly LngLat[];
  /** One closed ring per tooth, for a fill layer. */
  readonly teeth: readonly (readonly LngLat[])[];
  readonly lengthM: number;
  readonly toothCount: number;
}

export interface FrontlineBuildOptions {
  readonly shape?: ToothShape;
  /** Tooth spacing in metres. Use `toothSpacingMetres` for px-stable sizing. */
  readonly spacingM?: number;
  /** Tooth height in metres, measured perpendicular from the base line. */
  readonly sizeM?: number;
  /** Arc segments per tooth when `shape === "semicircle"`. */
  readonly arcSegments?: number;
}

/** Left of travel is bearing - 90 in compass terms. */
const perpendicularBearing = (
  travel: number,
  facing: "left" | "right",
): number => (facing === "left" ? travel - 90 : travel + 90);

export function buildFrontline(
  feature: FrontlineFeature,
  options: FrontlineBuildOptions = {},
): BuiltFrontline {
  const shape = options.shape ?? "triangle";
  const spacingM = options.spacingM ?? feature.toothSpacing;
  const sizeM = options.sizeM ?? feature.toothSize;
  const arcSegments = options.arcSegments ?? 8;

  const base = [...feature.path];
  const lengthM = pathLength(base);

  if (base.length < 2 || lengthM === 0 || spacingM <= 0 || sizeM <= 0) {
    return { base, teeth: [], lengthM, toothCount: 0 };
  }

  const teeth: LngLat[][] = [];
  const samples = resampleEvenly(base, spacingM);

  // Half the tooth footprint along the line. A base at 80% of the spacing
  // reads as a continuous toothed edge without the teeth merging.
  const halfBase = Math.min(spacingM * 0.4, sizeM * 0.75);

  for (const s of samples) {
    // Skip teeth that would hang off either end of the line.
    if (s.along < halfBase) continue;
    if (s.along > lengthM - halfBase) continue;

    const out = perpendicularBearing(s.bearing, feature.facing);

    if (shape === "tick") {
      teeth.push([s.position, destination(s.position, sizeM, out)]);
      continue;
    }

    const backward = destination(s.position, halfBase, s.bearing + 180);
    const forward = destination(s.position, halfBase, s.bearing);

    if (shape === "triangle") {
      const apex = destination(s.position, sizeM, out);
      teeth.push([backward, apex, forward, backward]);
      continue;
    }

    // Sweep base to base, bulging toward the facing side.
    const ring: LngLat[] = [backward];
    for (let i = 1; i < arcSegments; i++) {
      const t = i / arcSegments;
      const theta = Math.PI * t;
      const alongOffset = -halfBase + 2 * halfBase * t;
      const perpOffset = Math.sin(theta) * sizeM;
      const p1 = destination(s.position, Math.abs(alongOffset), alongOffset >= 0 ? s.bearing : s.bearing + 180);
      ring.push(destination(p1, perpOffset, out));
    }
    ring.push(forward, backward);
    teeth.push(ring);
  }

  return { base, teeth, lengthM, toothCount: teeth.length };
}

// Teeth are sized in px and converted per view, as with arrowheads: sized in
// metres they become specks or spikes away from the authoring zoom.

export function toothSpacingPx(strokeWidthPx: number): number {
  return Math.max(14, Math.min(48, strokeWidthPx * 5));
}

export function toothSizePx(strokeWidthPx: number): number {
  return Math.max(6, Math.min(22, strokeWidthPx * 2.6));
}

export function toothSpacingMetres(
  strokeWidthPx: number,
  lat: number,
  zoom: number,
): number {
  return toothSpacingPx(strokeWidthPx) * metresPerPixel(lat, zoom);
}

export function toothSizeMetres(
  strokeWidthPx: number,
  lat: number,
  zoom: number,
): number {
  return toothSizePx(strokeWidthPx) * metresPerPixel(lat, zoom);
}

export function buildFrontlineForView(
  feature: FrontlineFeature,
  zoom: number,
  shape: ToothShape = "triangle",
): BuiltFrontline {
  const lat = feature.path[0]?.[1] ?? 0;
  const w = feature.stroke.width;
  return buildFrontline(feature, {
    shape,
    spacingM: toothSpacingMetres(w, lat, zoom),
    sizeM: toothSizeMetres(w, lat, zoom),
  });
}
