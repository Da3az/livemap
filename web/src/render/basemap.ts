import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { BasemapStyleId, LabelLanguage } from "@/model/types";
import { desaturate, mix, parseColor, toCss, type Rgba } from "./color";
import type { Palette, ThemeMode } from "./palette";

const STYLE_BASE = "https://tiles.openfreemap.org/styles/";
const FETCH_TIMEOUT_MS = 15_000;

/** Required wherever the basemap is shown, including exported images. */
export const BASEMAP_ATTRIBUTION = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";

const DARK_STYLES: ReadonlySet<BasemapStyleId> = new Set(["dark", "fiord"]);

const rawStyles = new Map<BasemapStyleId, Promise<StyleSpecification>>();

/** Fetches a style once per session. A failed fetch is forgotten so the next call retries. */
export function loadBasemapStyle(id: BasemapStyleId): Promise<StyleSpecification> {
  const cached = rawStyles.get(id);
  if (cached) return cached;
  const request = fetch(`${STYLE_BASE}${id}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then(async (response) => {
    if (!response.ok) throw new Error(`Basemap style "${id}" answered ${response.status}`);
    const style: StyleSpecification = await response.json();
    return style;
  });
  rawStyles.set(id, request);
  request.catch(() => rawStyles.delete(id));
  return request;
}

/**
 * The style actually shown. A dark theme always gets a dark basemap, because
 * the feature palette for that theme was stepped against one.
 */
export function effectiveStyleId(id: BasemapStyleId, theme: ThemeMode): BasemapStyleId {
  if (theme === "dark" && !DARK_STYLES.has(id)) return "dark";
  return id;
}

/**
 * Which feature palette goes with the basemap on screen. The eight map
 * colours exist in a set stepped for a light basemap and a set stepped for a
 * dark one, so it is the basemap's lightness that picks the set, not the
 * interface theme: an author who chooses the dark basemap in a light
 * interface still gets colours that read on it.
 */
export function basemapTheme(id: BasemapStyleId, theme: ThemeMode): ThemeMode {
  return DARK_STYLES.has(effectiveStyleId(id, theme)) ? "dark" : "light";
}

/**
 * Land and water take the palette's colours and everything else is muted
 * toward them. Fiord is left as drawn: its blue land is the reason to pick it.
 */
function isTinted(id: BasemapStyleId): boolean {
  return id !== "fiord";
}

/** What the map shows before a basemap arrives, and when one cannot be fetched. */
export function blankStyle(palette: Palette): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": toCss(palette.land, 1) } }],
  };
}

/* ------------------------------------------------------------ label language */

type StyleValue = unknown;

function readsNameField(value: StyleValue): boolean {
  if (typeof value === "string") return /\{name[^}]*\}/.test(value);
  if (!Array.isArray(value)) return false;
  const [operator, field] = value;
  if (operator === "get" && typeof field === "string" && field.startsWith("name")) return true;
  return value.some(readsNameField);
}

const get = (field: string) => ["get", field];

/** True when the local name is written in Arabic script, judged by its first character. */
const LOCAL_NAME_IS_ARABIC = ["all", ["has", "name"], [">=", ["slice", ["get", "name"], 0, 1], "\u0600"], ["<=", ["slice", ["get", "name"], 0, 1], "\u06ff"]];

/**
 * `name` is the local name, `name:latin` the local name when it is in Latin
 * script, and `name:xx` / `name_en` are translations that many places lack.
 * - ar: the Arabic translation, else a local name already in Arabic script,
 *   else English, else whatever exists.
 * - en: English, else the Latin-script local name, else the local name.
 * - local: the local name as mapped.
 */
function nameExpression(language: LabelLanguage): StyleValue {
  const english = ["coalesce", get("name:en"), get("name_en"), get("name:latin"), get("name")];
  if (language === "en") return english;
  if (language === "local") return ["coalesce", get("name"), get("name:latin"), get("name_en")];
  return ["case", ["has", "name:ar"], get("name:ar"), LOCAL_NAME_IS_ARABIC, get("name"), english];
}

/* -------------------------------------------------------------------- colour */

interface Muting {
  /** How far to pull the colour toward the land colour. */
  toLand: number;
  /** How much chroma to remove first. */
  grey: number;
}

function mapColors(value: StyleValue, change: (color: Rgba) => Rgba): StyleValue {
  if (typeof value === "string") {
    const color = parseColor(value);
    return color ? toCss(change(color)) : value;
  }
  if (Array.isArray(value)) return value.map((item) => mapColors(item, change));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapColors(item, change)]));
  }
  return value;
}

function mutePaint(paint: Record<string, StyleValue>, muting: Muting, palette: Palette): Record<string, StyleValue> {
  const change = (color: Rgba) => mix(desaturate(color, muting.grey), palette.land, muting.toLand);
  return Object.fromEntries(
    Object.entries(paint).map(([property, value]) => [property, property.endsWith("-color") ? mapColors(value, change) : value]),
  );
}

function sourceLayerOf(layer: LayerSpecification): string {
  return "source-layer" in layer && typeof layer["source-layer"] === "string" ? layer["source-layer"] : "";
}

/**
 * How far each light basemap is pulled into the palette. All three take the
 * palette's land and water so feature colours keep their contrast, but each
 * keeps what makes it a different choice: Positron stays the quiet grey one,
 * Bright keeps its coloured road hierarchy and green landcover, Liberty keeps
 * its natural colours and the shaded relief that reads at a regional view.
 * Muting them all the same way made the three indistinguishable.
 */
interface Profile {
  fill: Muting;
  line: Muting;
  boundary: Muting;
  symbol: Muting;
  /** Keep the style's own shaded-relief raster (it fades out by itself as the map zooms in). */
  relief: boolean;
}

const QUIET: Profile = { fill: { toLand: 0.5, grey: 0.5 }, line: { toLand: 0.45, grey: 0.5 }, boundary: { toLand: 0.25, grey: 0.4 }, symbol: { toLand: 0.3, grey: 0.5 }, relief: false };

const PROFILES: Partial<Record<BasemapStyleId, Profile>> = {
  positron: QUIET,
  bright: { fill: { toLand: 0.2, grey: 0.15 }, line: { toLand: 0.12, grey: 0.1 }, boundary: { toLand: 0.2, grey: 0.3 }, symbol: { toLand: 0.15, grey: 0.25 }, relief: false },
  liberty: { fill: { toLand: 0.25, grey: 0.25 }, line: { toLand: 0.3, grey: 0.35 }, boundary: { toLand: 0.25, grey: 0.4 }, symbol: { toLand: 0.25, grey: 0.4 }, relief: true },
};

function profileFor(id: BasemapStyleId): Profile {
  return PROFILES[id] ?? QUIET;
}

/** Extruded buildings and points of interest compete with what the author draws; relief stays only where the profile keeps it. */
function isDropped(layer: LayerSpecification, profile: Profile): boolean {
  if (layer.type === "raster" || layer.type === "hillshade") return !profile.relief;
  return layer.type === "fill-extrusion" || sourceLayerOf(layer) === "poi";
}

function mutingFor(layer: LayerSpecification, profile: Profile): Muting {
  if (layer.type === "symbol") return profile.symbol;
  if (layer.type === "line") return sourceLayerOf(layer) === "boundary" ? profile.boundary : profile.line;
  return profile.fill;
}

interface RestyleOptions {
  language: LabelLanguage;
  palette: Palette;
  tint: boolean;
  profile: Profile;
}

function restyleLayer(layer: LayerSpecification, options: RestyleOptions): LayerSpecification {
  const { palette, tint, language, profile } = options;
  const land = toCss(palette.land, 1);
  const water = toCss(palette.water, 1);
  const paint: Record<string, StyleValue> = { ...layer.paint };
  const layout: Record<string, StyleValue> = { ...layer.layout };
  let nextPaint = paint;

  if (layer.type === "raster") {
    nextPaint = { ...paint, "raster-saturation": -0.4 };
  } else if (layer.type === "background") {
    if (tint) nextPaint = { ...paint, "background-color": land };
  } else if (tint && layer.type === "fill" && sourceLayerOf(layer) === "water") {
    const { "fill-pattern": _pattern, "fill-outline-color": _outline, ...rest } = paint;
    nextPaint = { ...rest, "fill-color": water };
  } else if (tint && layer.type === "line" && sourceLayerOf(layer) === "waterway") {
    nextPaint = { ...paint, "line-color": water };
  } else if (tint) {
    nextPaint = mutePaint(paint, mutingFor(layer, profile), palette);
    if (layer.type === "symbol") nextPaint["text-halo-color"] = toCss(palette.land, 0.85);
  }

  if (layer.type === "symbol" && readsNameField(layout["text-field"])) layout["text-field"] = nameExpression(language);

  /* The style arrives as untyped JSON and leaves the same way; MapLibre validates it when it is set. */
  return { ...layer, paint: nextPaint, layout } as LayerSpecification;
}

/** The fetched style with the label language pinned and, where it applies, the palette's land and water. */
export function buildBasemapStyle(
  raw: StyleSpecification,
  id: BasemapStyleId,
  options: { language: LabelLanguage; palette: Palette },
): StyleSpecification {
  const tint = isTinted(id);
  const profile = profileFor(id);
  const layers = raw.layers.filter((layer) => !isDropped(layer, profile)).map((layer) => restyleLayer(layer, { ...options, tint, profile }));
  return { ...raw, layers };
}
