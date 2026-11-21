/**
 * GeoJSON in: features from a file, with the simplestyle properties other
 * tools write and the `livemap:*` properties this editor's own export keeps.
 */
import type { ColorRef, FeatureKind, LngLat, MapFeature, RichText } from "@/model/types";
import { buildFeature, initialDrawDefaults, type DrawDefaults, type NewGeometry } from "./defaults";
import type { UiDir } from "./doc";
import { newId, rich } from "./text";

/** Web Mercator cannot show latitudes beyond this. */
export const MAX_LATITUDE = 85.051129;

/** Why an imported item was left out. */
export type SkipReason =
  /** The feature has no geometry. */
  | "no_geometry"
  /** A geometry type this tool does not draw. */
  | "unsupported_type"
  /** Coordinates are missing, not numbers, or not finite. */
  | "bad_coordinates"
  /** A line with fewer than two distinct points, or a ring with fewer than three. */
  | "too_few_points"
  /** The map's feature limit was reached; the rest was left out. */
  | "limit_reached";

/** One imported feature, for the result list. */
export interface ImportedItem {
  /** Position of the source feature in the input (0-based). */
  index: number;
  id: string;
  kind: FeatureKind;
  name: RichText;
  /** The GeoJSON geometry type it came from. */
  sourceType: string;
}

/** One item that could not be used, and why. */
export interface SkippedItem {
  index: number;
  reason: SkipReason;
  sourceType: string | null;
  /** The source feature's name, when it had one. */
  name: string | null;
}

/** The outcome of an import. Hand `features` to `EditorStore.importFeatures`. */
export interface ImportResult {
  /** null when the input could be read; otherwise why not. `features` is then empty. */
  error: "invalid_json" | "not_geojson" | null;
  features: MapFeature[];
  imported: ImportedItem[];
  skipped: SkippedItem[];
}

/** What the import needs to build complete features. */
export interface ImportOptions {
  uiDir: UiDir;
  userId: string;
  /** ISO time to stamp the features with. */
  now: string;
  /** Style for whatever the file does not specify. Default: the initial draw defaults. */
  defaults?: DrawDefaults;
  /** Stop after this many features (`limit.remaining` from `selectCounts`). */
  maxFeatures?: number;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function position(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng: unknown = value[0];
  const lat: unknown = value[1];
  if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const wrapped = lng >= -180 && lng <= 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180;
  return [wrapped, Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat))];
}

/** Positions with the third coordinate dropped and repeats removed; null when any is unusable. */
function path(value: unknown): LngLat[] | null {
  if (!Array.isArray(value)) return null;
  const out: LngLat[] = [];
  for (const item of value) {
    const at = position(item);
    if (at === null) return null;
    const previous = out[out.length - 1];
    if (previous !== undefined && previous[0] === at[0] && previous[1] === at[1]) continue;
    out.push(at);
  }
  return out;
}

/** A closed ring; "short" when fewer than three distinct corners remain. */
function ring(value: unknown): LngLat[] | "bad" | "short" {
  const points = path(value);
  if (points === null) return "bad";
  const first = points[0];
  const last = points[points.length - 1];
  if (first !== undefined && last !== undefined && points.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  const start = points[0];
  if (points.length < 3 || start === undefined) return "short";
  return [...points, [start[0], start[1]]];
}

type Converted = { ok: true; geometry: NewGeometry; sourceType: string } | { ok: false; reason: SkipReason; sourceType: string | null };

function polygon(coordinates: unknown, sourceType: string): Converted {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return { ok: false, reason: "bad_coordinates", sourceType };
  const rings: LngLat[][] = [];
  for (let i = 0; i < coordinates.length; i++) {
    const closed = ring(coordinates[i]);
    if (closed === "bad") return { ok: false, reason: "bad_coordinates", sourceType };
    if (closed === "short") {
      /* A degenerate hole is dropped; a degenerate outline makes the polygon unusable. */
      if (i === 0) return { ok: false, reason: "too_few_points", sourceType };
      continue;
    }
    rings.push(closed);
  }
  return { ok: true, geometry: { kind: "area", rings }, sourceType };
}

function line(coordinates: unknown, sourceType: string): Converted {
  const points = path(coordinates);
  if (points === null) return { ok: false, reason: "bad_coordinates", sourceType };
  if (points.length < 2) return { ok: false, reason: "too_few_points", sourceType };
  return { ok: true, geometry: { kind: "line", path: points }, sourceType };
}

function point(coordinates: unknown, sourceType: string): Converted {
  const at = position(coordinates);
  return at === null ? { ok: false, reason: "bad_coordinates", sourceType } : { ok: true, geometry: { kind: "point", at }, sourceType };
}

/** One GeoJSON geometry to one or more feature geometries; Multi* and collections are split. */
function convert(geometry: unknown): Converted[] {
  if (!isObject(geometry)) return [{ ok: false, reason: "no_geometry", sourceType: null }];
  const type = typeof geometry.type === "string" ? geometry.type : null;
  const coordinates = geometry.coordinates;
  const each = (build: (part: unknown, sourceType: string) => Converted, sourceType: string): Converted[] =>
    Array.isArray(coordinates) && coordinates.length > 0
      ? coordinates.map((part) => build(part, sourceType))
      : [{ ok: false, reason: "bad_coordinates", sourceType }];
  switch (type) {
    case "Point":
      return [point(coordinates, type)];
    case "LineString":
      return [line(coordinates, type)];
    case "Polygon":
      return [polygon(coordinates, type)];
    case "MultiPoint":
      return each(point, type);
    case "MultiLineString":
      return each(line, type);
    case "MultiPolygon":
      return each(polygon, type);
    case "GeometryCollection":
      return Array.isArray(geometry.geometries) && geometry.geometries.length > 0
        ? geometry.geometries.flatMap((part) => convert(part))
        : [{ ok: false, reason: "no_geometry", sourceType: type }];
    default:
      return [{ ok: false, reason: "unsupported_type", sourceType: type }];
  }
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function colour(value: unknown): ColorRef | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!HEX.test(text)) return null;
  const hex = text.length === 4 ? `#${[...text.slice(1)].map((digit) => digit + digit).join("")}` : text;
  return { custom: hex.toLowerCase() };
}

function slot(value: unknown): ColorRef | null {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7 || value === 8
    ? { slot: value }
    : null;
}

function number(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : null;
}

function text(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** An ISO moment from a `livemap:valid-*` property, normalised; null when absent or unreadable. */
function moment(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * The time window an export wrote as `livemap:valid-from` / `livemap:valid-to`,
 * so dates survive a round trip. An end before the start is dropped.
 */
function dated(feature: MapFeature, properties: Json): MapFeature {
  const validFrom = moment(properties["livemap:valid-from"]);
  let validTo = moment(properties["livemap:valid-to"]);
  if (validFrom !== null && validTo !== null && Date.parse(validTo) < Date.parse(validFrom)) validTo = null;
  return validFrom === null && validTo === null ? feature : { ...feature, validFrom, validTo };
}

/** Apply the simplestyle properties a file carries (stroke, stroke-width, fill, fill-opacity...). */
function styled(feature: MapFeature, properties: Json): MapFeature {
  const strokeColour = slot(properties["livemap:stroke-slot"]) ?? colour(properties.stroke);
  const strokeWidth = number(properties["stroke-width"], 0, 40);
  const strokeOpacity = number(properties["stroke-opacity"], 0, 1);
  const fillColour = slot(properties["livemap:fill-slot"]) ?? colour(properties.fill);
  const fillOpacity = number(properties["fill-opacity"], 0, 1);
  const markerColour = slot(properties["livemap:marker-slot"]) ?? colour(properties["marker-color"]);
  switch (feature.kind) {
    case "area":
      return {
        ...feature,
        stroke: {
          ...feature.stroke,
          color: strokeColour ?? fillColour ?? feature.stroke.color,
          width: strokeWidth ?? feature.stroke.width,
          opacity: strokeOpacity ?? feature.stroke.opacity,
        },
        fill: {
          ...feature.fill,
          color: fillColour ?? strokeColour ?? feature.fill.color,
          opacity: fillOpacity ?? feature.fill.opacity,
        },
      };
    case "line":
      return {
        ...feature,
        stroke: {
          ...feature.stroke,
          color: strokeColour ?? feature.stroke.color,
          width: strokeWidth ?? feature.stroke.width,
          opacity: strokeOpacity ?? feature.stroke.opacity,
        },
      };
    case "point":
      return { ...feature, color: markerColour ?? strokeColour ?? fillColour ?? feature.color };
    case "arrow":
    case "frontline":
    case "annotation":
      return feature;
  }
}

/**
 * Turn GeoJSON into features. Accepts a string or an already parsed value: a
 * FeatureCollection, a single Feature, or a bare geometry.
 *
 * - Point, LineString and Polygon (with holes) become icons, lines and areas.
 * - MultiPoint, MultiLineString, MultiPolygon and GeometryCollection are split
 *   into one feature per part, numbered when the source had a name.
 * - `name` or `title` becomes the feature name; `stroke`, `stroke-width`,
 *   `stroke-opacity`, `fill`, `fill-opacity` and `marker-color` are honoured,
 *   and so are the `livemap:valid-from` / `livemap:valid-to` dates an export writes.
 * - Unclosed rings are closed, a third coordinate is dropped, repeated points
 *   are removed, longitude is wrapped and latitude clamped to Web Mercator.
 * - Anything unusable is skipped and listed with its reason; nothing throws.
 *
 * Draw-order keys are left empty: `EditorStore.importFeatures` assigns them,
 * keeping the file's order with the first feature lowest.
 */
export function importGeoJson(input: unknown, options: ImportOptions): ImportResult {
  let root: unknown = input;
  if (typeof input === "string") {
    try {
      root = JSON.parse(input);
    } catch {
      return { error: "invalid_json", features: [], imported: [], skipped: [] };
    }
  }
  if (!isObject(root) || typeof root.type !== "string") {
    return { error: "not_geojson", features: [], imported: [], skipped: [] };
  }
  let sources: unknown[];
  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features)) return { error: "not_geojson", features: [], imported: [], skipped: [] };
    sources = root.features;
  } else {
    sources = [root];
  }

  const defaults = options.defaults ?? initialDrawDefaults();
  const max = options.maxFeatures ?? Number.POSITIVE_INFINITY;
  const features: MapFeature[] = [];
  const imported: ImportedItem[] = [];
  const skipped: SkippedItem[] = [];

  sources.forEach((source, index) => {
    const isFeature = isObject(source) && source.type === "Feature";
    const geometry = isFeature ? source.geometry : source;
    const properties: Json = isFeature && isObject(source.properties) ? source.properties : {};
    const sourceName = text(properties.name) ?? text(properties.title);
    const parts = convert(geometry);
    parts.forEach((part, partIndex) => {
      if (!part.ok) {
        skipped.push({ index, reason: part.reason, sourceType: part.sourceType, name: sourceName });
        return;
      }
      if (features.length >= max) {
        skipped.push({ index, reason: "limit_reached", sourceType: part.sourceType, name: sourceName });
        return;
      }
      const name = sourceName === null ? "" : parts.length > 1 ? `${sourceName} ${partIndex + 1}` : sourceName;
      const built = buildFeature(part.geometry, defaults, {
        id: newId(),
        name: rich(name, "auto"),
        uiDir: options.uiDir,
        now: options.now,
        userId: options.userId,
      });
      const feature = dated(styled(built, properties), properties);
      features.push(feature);
      imported.push({ index, id: feature.id, kind: feature.kind, name: feature.name, sourceType: part.sourceType });
    });
  });

  return { error: null, features, imported, skipped };
}
