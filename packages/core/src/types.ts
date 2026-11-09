/** [longitude, latitude] — GeoJSON order. */
export type LngLat = readonly [number, number];

export type Ring = readonly LngLat[];

export interface BBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export type TextDir = "ltr" | "rtl" | "auto";

/** `dir` is explicit, not inferred: an Arabic label may deliberately be laid out LTR. */
export interface RichText {
  readonly value: string;
  readonly dir: TextDir;
}

/** 6- or 8-digit hex with leading '#'. */
export type HexColor = string;

export interface FillStyle {
  readonly color: HexColor;
  readonly opacity: number;
  readonly pattern?: string;
}

export interface StrokeStyle {
  readonly color: HexColor;
  readonly width: number;
  readonly opacity: number;
  /** Dash array in line-widths. Omit for solid. */
  readonly dash?: readonly number[];
}

export interface LabelStyle {
  readonly color: HexColor;
  readonly haloColor: HexColor;
  /** Keep clear of 1.0 — see `normaliseHaloWidth`. */
  readonly haloWidth: number;
  readonly size: number;
}

export type FeatureKind =
  | "area"
  | "line"
  | "arrow"
  | "frontline"
  | "point"
  | "annotation";

interface FeatureBase {
  readonly id: string;
  readonly kind: FeatureKind;
  /** Fractional index, so reordering never renumbers siblings. */
  readonly at: string;
  readonly label?: RichText;
  readonly labelStyle?: LabelStyle;
  readonly meta?: Readonly<Record<string, string>>;
}

export interface AreaFeature extends FeatureBase {
  readonly kind: "area";
  /** Outer ring first, then holes. */
  readonly rings: readonly Ring[];
  readonly fill: FillStyle;
  readonly stroke: StrokeStyle;
}

export interface LineFeature extends FeatureBase {
  readonly kind: "line";
  readonly path: readonly LngLat[];
  readonly stroke: StrokeStyle;
}

export type ArrowHead = "none" | "single" | "double";

export interface ArrowFeature extends FeatureBase {
  readonly kind: "arrow";
  /** Control points, not rendered geometry — the curve is derived by `buildArrow`. */
  readonly control: readonly LngLat[];
  /** 0 = polyline through the controls, 1 = maximum smoothing. */
  readonly curvature: number;
  readonly head: ArrowHead;
  readonly stroke: StrokeStyle;
  readonly chevrons: boolean;
}

/** Side the teeth face, walking first to last point. */
export type FacingSide = "left" | "right";

export interface FrontlineFeature extends FeatureBase {
  readonly kind: "frontline";
  readonly path: readonly LngLat[];
  readonly facing: FacingSide;
  readonly stroke: StrokeStyle;
  /** Metres at the authoring zoom; converted to px per view when rendering. */
  readonly toothSpacing: number;
  readonly toothSize: number;
}

export interface PointFeature extends FeatureBase {
  readonly kind: "point";
  readonly at_: LngLat;
  /** Registry id, e.g. "ocha:Refugee". */
  readonly icon: string;
  /** OCHA icons ship monochrome, so the recolour is load-bearing. */
  readonly iconColor: HexColor;
  readonly iconSize: number;
  readonly disc?: { readonly fill: HexColor; readonly ring: HexColor };
}

export interface AnnotationFeature extends FeatureBase {
  readonly kind: "annotation";
  readonly anchor: LngLat;
  /** Screen-space px from the anchor. A geographic offset collapses on zoom out. */
  readonly offset: readonly [number, number];
  readonly text: RichText;
  readonly labelStyle: LabelStyle;
  readonly leader: LeaderStyle | null;
}

export interface LeaderStyle {
  readonly color: HexColor;
  readonly width: number;
  readonly dash?: readonly number[];
  readonly shape: "straight" | "elbow";
  readonly anchorDot: boolean;
}

export type MapFeature =
  | AreaFeature
  | LineFeature
  | ArrowFeature
  | FrontlineFeature
  | PointFeature
  | AnnotationFeature;

export interface Viewport {
  readonly center: LngLat;
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

export interface BasemapRef {
  readonly styleId: string;
  /** Most-preferred first; resolved via coalesce in `labelExpression`. */
  readonly labelLangs: readonly string[];
}

/** Editable document. Lives in Postgres; readers never see it. */
export interface MapDoc {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly title: RichText;
  readonly viewport: Viewport;
  readonly basemap: BasemapRef;
  readonly uiDir: TextDir;
  readonly updatedAt: string;
  readonly rev: number;
  /** Bookkeeping only — the pointer object is what readers actually resolve. */
  readonly publishedVersion?: number;
}

/** Immutable published snapshot. Separate type so editor state cannot be served. */
export interface MapVersion {
  readonly mapId: string;
  readonly version: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly title: RichText;
  readonly viewport: Viewport;
  readonly basemap: BasemapRef;
  readonly uiDir: TextDir;
  readonly features: readonly MapFeature[];
  readonly etag: string;
}

/** Forward/reverse pairs give undo without snapshotting the document. */
export interface Moment {
  readonly put?: readonly MapFeature[];
  readonly delete?: readonly string[];
}

export interface ReversibleMoment {
  readonly forward: Moment;
  readonly reverse: Moment;
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isHexColor(v: string): v is HexColor {
  return HEX_RE.test(v);
}

export function isLngLat(v: unknown): v is LngLat {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    v[0] >= -180 &&
    v[0] <= 180 &&
    v[1] >= -90 &&
    v[1] <= 90
  );
}

export const MIN_SAFE_HALO = 1.01;

/**
 * MapLibre #8949: `text-halo-width <= 1` is drawn per-glyph and cuts the joins
 * of connected scripts (Arabic, Persian, Urdu). 1.01 renders continuous.
 */
export function normaliseHaloWidth(w: number): number {
  if (!Number.isFinite(w) || w <= 0) return 0;
  return w <= 1 ? MIN_SAFE_HALO : w;
}

/**
 * `name:<lang>` → `name:nonlatin` → `name`. Measured: `name:ar` is present on
 * ~12% of Riyadh features while plain `name` is Arabic on ~99% of its roads.
 */
export function labelExpression(langs: readonly string[]): unknown[] {
  const candidates: unknown[] = [];
  for (const l of langs) candidates.push(["get", `name:${l}`]);
  if (langs.some((l) => NON_LATIN_LANGS.has(l))) {
    candidates.push(["get", "name:nonlatin"]);
  }
  candidates.push(["get", "name"]);
  candidates.push("");
  return ["coalesce", ...candidates];
}

const NON_LATIN_LANGS = new Set([
  "ar",
  "fa",
  "ur",
  "he",
  "ru",
  "uk",
  "el",
  "hy",
  "ka",
  "am",
  "zh",
  "ja",
  "ko",
  "th",
  "hi",
  "bn",
  "ta",
]);
