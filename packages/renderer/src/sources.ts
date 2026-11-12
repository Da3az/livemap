// Domain model to MapLibre GeoJSON sources, grouped by geometry class.
// Everything zoom-dependent (arrow trim, tooth spacing, leader endpoints,
// label de-confliction) resolves here, so this must re-run on view change.

import {
  buildArrowForView,
  buildFrontlineForView,
  buildLeaderForView,
  compareOrder,
  deconflict,
  estimateTextBox,
  iconRotateForBearing,
  lngLatToPx,
  normaliseHaloWidth,
  pxToLngLat,
  resolveDir,
  type CollisionItem,
  type LngLat,
  type MapFeature,
  type Rect,
} from "@livemap/core";

export interface GeoJsonFeature {
  type: "Feature";
  id?: string | number;
  geometry:
    | { type: "Point"; coordinates: number[] }
    | { type: "LineString"; coordinates: number[][] }
    | { type: "Polygon"; coordinates: number[][][] };
  properties: Record<string, unknown>;
}

export interface GeoJsonCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export const SOURCE_IDS = {
  areas: "lm-areas",
  lines: "lm-lines",
  teeth: "lm-teeth",
  markers: "lm-markers",
  labels: "lm-labels",
} as const;

export interface BuiltSources {
  readonly [SOURCE_IDS.areas]: GeoJsonCollection;
  readonly [SOURCE_IDS.lines]: GeoJsonCollection;
  readonly [SOURCE_IDS.teeth]: GeoJsonCollection;
  readonly [SOURCE_IDS.markers]: GeoJsonCollection;
  readonly [SOURCE_IDS.labels]: GeoJsonCollection;
}

export interface BuildContext {
  readonly zoom: number;
  /** Viewport in CSS pixels, used to keep labels on screen. */
  readonly viewportPx?: { readonly width: number; readonly height: number };
  /** Map centre, needed to place the viewport in world pixel space. */
  readonly center?: LngLat;
  /** Regions of the viewport labels must avoid, e.g. a legend panel. */
  readonly obstaclesPx?: readonly Rect[];
  /** Icon id to registered image id. null = not loaded; the marker is skipped. */
  readonly resolveIcon?: (iconId: string, color: string) => string | null;
  readonly resolveArrowhead?: (color: string) => string;
  readonly resolveChevron?: (color: string) => string;
  readonly resolveAnchorDot?: (fill: string, ring: string) => string;
}

const empty = (): GeoJsonCollection => ({
  type: "FeatureCollection",
  features: [],
});

/** Z-order is the feature's position after sorting; used as `sortKey`. */
export function buildSources(
  features: readonly MapFeature[],
  ctx: BuildContext,
): BuiltSources {
  const areas = empty();
  const lines = empty();
  const teeth = empty();
  const markers = empty();
  const labels = empty();

  const ordered = [...features].sort(compareOrder);

  // Collected first: overlaps can only be resolved over the whole set.
  const annotations: Extract<MapFeature, { kind: "annotation" }>[] = [];

  ordered.forEach((f, index) => {
    switch (f.kind) {
      case "area": {
        areas.features.push({
          type: "Feature",
          id: f.id,
          geometry: {
            type: "Polygon",
            coordinates: f.rings.map((r) => closeRing(r).map((p) => [...p])),
          },
          properties: {
            id: f.id,
            sortKey: index,
            fillColor: f.fill.color,
            fillOpacity: f.fill.opacity,
            strokeColor: f.stroke.color,
            strokeWidth: f.stroke.width,
            strokeOpacity: f.stroke.opacity,
            hasDash: f.stroke.dash ? 1 : 0,
          },
        });
        if (f.label) {
          const at = ringCentroid(f.rings[0] ?? []);
          if (at) {
            labels.features.push(
              labelFeature(f.id, at, index, f.label.value, f.label.dir, f, [0, 0]),
            );
          }
        }
        break;
      }

      case "line": {
        lines.features.push(lineFeature(f.id, f.path, index, f.stroke, "line"));
        if (f.label && f.path.length > 0) {
          const mid = f.path[Math.floor(f.path.length / 2)]!;
          labels.features.push(
            labelFeature(f.id, mid, index, f.label.value, f.label.dir, f, [0, 0]),
          );
        }
        break;
      }

      case "arrow": {
        const built = buildArrowForView(f, ctx.zoom);
        if (built.shaft.length >= 2) {
          lines.features.push(
            lineFeature(f.id, built.shaft, index, f.stroke, "arrow"),
          );
        }

        const headImage = ctx.resolveArrowhead?.(f.stroke.color);
        for (const [slot, m] of [
          ["end", built.headEnd],
          ["start", built.headStart],
        ] as const) {
          if (!m || !headImage) continue;
          markers.features.push({
            type: "Feature",
            id: `${f.id}:head:${slot}`,
            geometry: { type: "Point", coordinates: [...m.position] },
            properties: {
              id: f.id,
              sortKey: index,
              role: "arrowhead",
              image: headImage,
              iconRotate: iconRotateForBearing(m.bearing),
              // Scaled against the stroke: one 24px source image, /6.
              iconSize: f.stroke.width / 6,
              opacity: f.stroke.opacity,
            },
          });
        }

        const chevImage = ctx.resolveChevron?.(f.stroke.color);
        if (chevImage) {
          built.chevrons.forEach((m, i) => {
            markers.features.push({
              type: "Feature",
              id: `${f.id}:chev:${i}`,
              geometry: { type: "Point", coordinates: [...m.position] },
              properties: {
                id: f.id,
                sortKey: index,
                role: "chevron",
                image: chevImage,
                iconRotate: iconRotateForBearing(m.bearing),
                iconSize: Math.max(0.5, f.stroke.width / 8),
                opacity: f.stroke.opacity * 0.9,
              },
            });
          });
        }
        break;
      }

      case "frontline": {
        const built = buildFrontlineForView(f, ctx.zoom);
        lines.features.push(
          lineFeature(f.id, built.base, index, f.stroke, "frontline"),
        );
        built.teeth.forEach((ring, i) => {
          teeth.features.push({
            type: "Feature",
            id: `${f.id}:tooth:${i}`,
            geometry: {
              type: "Polygon",
              coordinates: [closeRing(ring).map((p) => [...p])],
            },
            properties: {
              id: f.id,
              sortKey: index,
              fillColor: f.stroke.color,
              fillOpacity: f.stroke.opacity,
            },
          });
        });
        break;
      }

      case "point": {
        const image = ctx.resolveIcon?.(f.icon, f.iconColor) ?? null;
        if (image) {
          markers.features.push({
            type: "Feature",
            id: f.id,
            geometry: { type: "Point", coordinates: [...f.at_] },
            properties: {
              id: f.id,
              sortKey: index,
              role: "icon",
              image,
              iconRotate: 0,
              iconSize: f.iconSize,
              opacity: 1,
            },
          });
        }
        if (f.label) {
          labels.features.push(
            labelFeature(f.id, f.at_, index, f.label.value, f.label.dir, f, [0, 0]),
          );
        }
        break;
      }

      case "annotation": {
        annotations.push(f);
        break;
      }
    }
  });

  emitAnnotations(annotations, ordered, ctx, lines, markers, labels);

  return {
    [SOURCE_IDS.areas]: areas,
    [SOURCE_IDS.lines]: lines,
    [SOURCE_IDS.teeth]: teeth,
    [SOURCE_IDS.markers]: markers,
    [SOURCE_IDS.labels]: labels,
  };
}

// Area-weighted centroid, not a pole of inaccessibility: on a concave or
// C-shaped ring the label can land outside the polygon. Falls back to the
// vertex mean on zero signed area (degenerate or collinear input).
function ringCentroid(ring: readonly LngLat[]): LngLat | null {
  if (ring.length === 0) return null;
  if (ring.length < 3) return ring[0]!;

  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]!;
    const [x1, y1] = ring[i]!;
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }

  if (Math.abs(twiceArea) < 1e-12) {
    const n = ring.length;
    const sx = ring.reduce((a, p) => a + p[0], 0) / n;
    const sy = ring.reduce((a, p) => a + p[1], 0) / n;
    return [sx, sy];
  }

  const f = 1 / (3 * twiceArea);
  return [x * f, y * f];
}

function closeRing(r: readonly LngLat[]): LngLat[] {
  if (r.length < 3) return [...r];
  const first = r[0]!;
  const last = r[r.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return [...r];
  return [...r, first];
}

function lineFeature(
  id: string,
  path: readonly LngLat[],
  sortKey: number,
  stroke: { color: string; width: number; opacity: number; dash?: readonly number[] },
  role: string,
): GeoJsonFeature {
  return {
    type: "Feature",
    id: `${id}:${role}`,
    geometry: { type: "LineString", coordinates: path.map((p) => [...p]) },
    properties: {
      id,
      sortKey,
      role,
      strokeColor: stroke.color,
      strokeWidth: stroke.width,
      strokeOpacity: stroke.opacity,
      hasDash: stroke.dash ? 1 : 0,
    },
  };
}

function labelFeature(
  id: string,
  at: LngLat,
  sortKey: number,
  text: string,
  dir: string,
  styled: { labelStyle?: { color: string; haloColor: string; haloWidth: number; size: number } },
  offsetPx: readonly [number, number],
): GeoJsonFeature {
  const st = styled.labelStyle;
  return {
    type: "Feature",
    id: `${id}:label`,
    geometry: { type: "Point", coordinates: [...at] },
    properties: {
      id,
      sortKey,
      text,
      // Resolved once here; the renderer never re-runs bidi detection.
      dir: resolveDir(text, dir as "ltr" | "rtl" | "auto"),
      textColor: st?.color ?? "#111111",
      haloColor: st?.haloColor ?? "#ffffff",
      // Floor of 1.01 — MapLibre #8949 cuts Arabic glyph joins at <= 1px.
      haloWidth: normaliseHaloWidth(st?.haloWidth ?? 1.4),
      textSize: st?.size ?? 13,
      offsetX: offsetPx[0],
      offsetY: offsetPx[1],
    },
  };
}

// Leader lines are emitted after the label boxes are de-conflicted against
// each other and the viewport.
function emitAnnotations(
  annotations: readonly Extract<MapFeature, { kind: "annotation" }>[],
  ordered: readonly MapFeature[],
  ctx: BuildContext,
  lines: GeoJsonCollection,
  markers: GeoJsonCollection,
  labels: GeoJsonCollection,
): void {
  if (annotations.length === 0) return;

  const items: CollisionItem[] = annotations.map((f, i) => {
    const box = estimateTextBox(f.text.value, f.labelStyle.size);
    return {
      id: f.id,
      // World pixels at the current zoom, not viewport pixels: the result must
      // not depend on pan, or labels re-shuffle as you drag.
      anchor: [
        lngLatToPx(f.anchor, ctx.zoom).x,
        lngLatToPx(f.anchor, ctx.zoom).y,
      ],
      offset: f.offset,
      width: box.widthPx,
      height: box.heightPx,
      priority: annotations.length - i,
    };
  });

  const viewport = viewportRect(ctx);
  const resolved = deconflict(items, {
    ...(viewport ? { viewport } : {}),
    ...(ctx.obstaclesPx ? { obstacles: ctx.obstaclesPx } : {}),
  });

  const byId = new Map(resolved.map((r) => [r.id, r]));

  annotations.forEach((f) => {
    const r = byId.get(f.id)!;
    if (r.suppressed) return;

    const sortKey = ordered.findIndex((o) => o.id === f.id);
    // Against the de-conflicted offset, not the authored one, so the line
    // still points at the box after it was nudged.
    const built = buildLeaderForView(
      { ...f, offset: [r.offset[0], r.offset[1]] },
      ctx.zoom,
    );

    if (f.leader && built.path.length >= 2) {
      lines.features.push(
        lineFeature(
          f.id,
          built.path,
          sortKey,
          {
            color: f.leader.color,
            width: f.leader.width,
            opacity: 1,
            ...(f.leader.dash ? { dash: f.leader.dash } : {}),
          },
          "leader",
        ),
      );

      if (f.leader.anchorDot) {
        const image = ctx.resolveAnchorDot?.(f.leader.color, "#ffffff");
        if (image) {
          markers.features.push({
            type: "Feature",
            id: `${f.id}:anchor`,
            geometry: { type: "Point", coordinates: [...f.anchor] },
            properties: {
              id: f.id,
              sortKey,
              role: "anchordot",
              image,
              iconRotate: 0,
              iconSize: 1,
              opacity: 1,
            },
          });
        }
      }
    }

    labels.features.push(
      labelFeature(
        f.id,
        built.textAt,
        sortKey,
        f.text.value,
        f.text.dir,
        f,
        [0, 0],
      ),
    );
  });
}

function viewportRect(ctx: BuildContext): Rect | undefined {
  if (!ctx.viewportPx || !ctx.center) return undefined;
  const c = lngLatToPx(ctx.center, ctx.zoom);
  return {
    x: c.x - ctx.viewportPx.width / 2,
    y: c.y - ctx.viewportPx.height / 2,
    width: ctx.viewportPx.width,
    height: ctx.viewportPx.height,
  };
}

/** Exposed for tests: the inverse of the world-pixel anchor conversion. */
export const worldPxToLngLat = pxToLngLat;
