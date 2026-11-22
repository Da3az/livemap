/**
 * The livemap domain model, shared by the front end (web/) and the API.
 * One definition: the server validates requests against JSON Schemas written
 * from these types, and the front end compiles against them directly.
 * web/CONTRACT-CHANGES.md records how it departed from the first API.
 */

export type TextDir = "ltr" | "rtl" | "auto";
export interface RichText {
  value: string;
  dir: TextDir;
}
/** [longitude, latitude] */
export type LngLat = [number, number];
export type IsoDateTime = string;

/* ----------------------------------------------------------------- style */

/** One of the eight categorical map colours; resolved per basemap mode. */
export type PaletteSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
/** A feature stores a palette slot, or a custom hex the editor picked. */
export type ColorRef = { slot: PaletteSlot } | { custom: string };

export type FillPattern = "none" | "hatch" | "cross" | "dots";
export type DashStyle = "solid" | "dashed" | "dotted" | { custom: number[] };

export interface Fill {
  color: ColorRef;
  opacity: number;
  pattern: FillPattern;
}
export interface Stroke {
  color: ColorRef;
  /** CSS pixels */
  width: number;
  opacity: number;
  dash: DashStyle;
}
export interface LabelStyle {
  /** "ink" follows the basemap mode's text colour */
  color: ColorRef | "ink";
  /** CSS pixels */
  size: number;
  weight: 400 | 600;
  halo: boolean;
  /** a filled box behind the text */
  box: boolean;
}

/** A named, reusable style. Presets drive the generated legend. */
export interface StylePreset {
  id: string;
  name: RichText;
  appliesTo: FeatureKind[];
  fill?: Fill;
  stroke?: Stroke;
  iconColor?: ColorRef;
}

/* -------------------------------------------------------------- features */

export type FeatureKind = "area" | "line" | "arrow" | "frontline" | "point" | "annotation";

export type IconId =
  | "strike"
  | "explosion"
  | "checkpoint"
  | "shelter"
  | "hospital"
  | "flood"
  | "fire"
  | "airport"
  | "port"
  | "camp"
  | "aid"
  | "pin";

export interface FeatureBase {
  id: string;
  /** Fractional draw-order key. Higher sorts on top. Free across kinds. */
  order: string;
  /** The name shown in the feature list. Not drawn on the map. */
  name: RichText;
  /** Optional text drawn on the map with the feature. */
  label?: RichText;
  labelStyle?: LabelStyle;
  groupId: string | null;
  /** Editor-only. Hidden features are never published. */
  hidden: boolean;
  /** Editor-only. Stripped at publish. */
  locked: boolean;
  /** When set, style follows the preset; local style fields are ignored. */
  presetId: string | null;
  /** The feature exists on the timeline from this moment... */
  validFrom: IsoDateTime | null;
  /** ...until this one. null means open-ended. */
  validTo: IsoDateTime | null;
  /** Links successive states of the same thing (a front line on day 1, 2, 3). */
  lineageId: string | null;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface AreaFeature extends FeatureBase {
  kind: "area";
  /** First ring is the outline, the rest are holes. Rings are closed. */
  rings: LngLat[][];
  fill: Fill;
  stroke: Stroke;
}
export interface LineFeature extends FeatureBase {
  kind: "line";
  path: LngLat[];
  stroke: Stroke;
}
export interface ArrowFeature extends FeatureBase {
  kind: "arrow";
  /** Control points; the drawn curve passes through them. */
  control: LngLat[];
  /** 0 straight segments, 1 fully smoothed. With two control points: 0 straight, 1 the fullest arc. */
  curvature: number;
  /** Which side of its direction of travel a two-point arrow bows to. Absent means "left". */
  bend?: "left" | "right";
  head: "none" | "single" | "double";
  /** true: the shaft widens toward the head */
  tapered: boolean;
  stroke: Stroke;
}
export interface FrontlineFeature extends FeatureBase {
  kind: "frontline";
  path: LngLat[];
  /** which side of the drawing direction the teeth point to */
  facing: "left" | "right";
  toothShape: "triangle" | "semicircle";
  /** CSS pixels between teeth */
  toothSpacing: number;
  /** CSS pixels */
  toothSize: number;
  stroke: Stroke;
}
export interface PointFeature extends FeatureBase {
  kind: "point";
  at: LngLat;
  /** an icon from the set, or a number marker of up to three characters */
  symbol: { icon: IconId } | { number: string };
  color: ColorRef;
  /** CSS pixels */
  size: number;
}
export interface AnnotationFeature extends FeatureBase {
  kind: "annotation";
  anchor: LngLat;
  /** Where the text box sits. Geographic, so it holds at every zoom. */
  textAt: LngLat;
  text: RichText;
  labelStyle: LabelStyle;
  leader: { shape: "straight" | "elbow"; anchorDot: boolean } | null;
}

export type MapFeature =
  | AreaFeature
  | LineFeature
  | ArrowFeature
  | FrontlineFeature
  | PointFeature
  | AnnotationFeature;

/* -------------------------------------------------------- map and settings */

export interface FeatureGroup {
  id: string;
  name: RichText;
  /** Fractional key ordering groups among themselves in the list. */
  order: string;
  hidden: boolean;
  locked: boolean;
}

export type BasemapStyleId = "positron" | "bright" | "liberty" | "dark" | "fiord";
export type LabelLanguage = "ar" | "en" | "local";

export interface Viewport {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface LegendItem {
  /** a preset, or a single feature that has no preset */
  ref: { presetId: string } | { featureId: string };
  /** null: use the preset or feature name */
  label: RichText | null;
  hidden: boolean;
}

export interface MapSettings {
  basemap: { styleId: BasemapStyleId; labelLanguage: LabelLanguage };
  /** What readers open on. Set explicitly by the editor. */
  openingView: Viewport;
  presets: StylePreset[];
  groups: FeatureGroup[];
  legend: { show: boolean; title: RichText; position: "top-start" | "top-end" | "bottom-start" | "bottom-end"; items: LegendItem[] };
  titleBlock: {
    show: boolean;
    subtitle: RichText | null;
    source: RichText | null;
    credit: RichText | null;
    /** e.g. "Locations are approximate" */
    note: RichText | null;
    /** The "as of" stamp. null hides it. */
    asOf: IsoDateTime | null;
  };
  timeline: {
    enabled: boolean;
    /** moving: only the window; cumulative: everything up to the playhead */
    mode: "moving" | "cumulative";
    /** seconds of map time per second of playback */
    speed: number;
    /** Width of the moving window in milliseconds of map time. Readers and the author's timeline share it. */
    windowMs: number;
  };
  embed: {
    legend: boolean;
    zoomButtons: boolean;
    scaleBar: boolean;
    /** require a modifier key or two fingers to zoom, so the page still scrolls */
    cooperativeGestures: boolean;
    /** a picture of the map: no pan, no zoom */
    static: boolean;
    theme: "light" | "dark" | "auto";
  };
}

export interface MapDoc {
  id: string;
  tenantId: string;
  slug: string;
  title: RichText;
  /** Direction of the editor chrome and of the published map's furniture. */
  uiDir: Exclude<TextDir, "auto">;
  settings: MapSettings;
  rev: number;
  publishedVersion: number | null;
  /** The rev the live version was built from; lets the UI say "draft ahead of live". */
  publishedRev: number | null;
  archived: boolean;
  updatedAt: IsoDateTime;
  updatedBy: string;
  /** Who made the map. A contributor may change only the maps they created. */
  createdBy: { userId: string; name: string };
}

export interface MapSummary {
  id: string;
  slug: string;
  title: RichText;
  uiDir: Exclude<TextDir, "auto">;
  rev: number;
  publishedVersion: number | null;
  publishedRev: number | null;
  updatedAt: IsoDateTime;
  updatedBy: string;
  createdBy: { userId: string; name: string };
  featureCount: number;
  archived: boolean;
  /** Enough to draw a thumbnail without loading the map. */
  thumbnail: { center: LngLat; zoom: number; basemap: BasemapStyleId };
}

export interface TemplateSummary {
  id: "blank" | "conflict-tracker" | "storm-track" | "regional-results";
  title: string;
  description: string;
  uiDir: Exclude<TextDir, "auto">;
  featureCount: number;
}

/* --------------------------------------------------------------- versions */

/** The immutable artifact a reader fetches. Editor-only fields are stripped. */
/**
 * A feature as readers receive it. Who changed it, and when, stays with the
 * editor: an artifact is public. `hidden` and `locked` are always false, since
 * hidden features are left out and nothing is locked for a reader.
 */
export type PublishedFeature = MapFeature extends infer F ? (F extends MapFeature ? Omit<F, "updatedAt" | "updatedBy"> : never) : never;

export interface MapVersion {
  mapId: string;
  version: number;
  title: RichText;
  uiDir: Exclude<TextDir, "auto">;
  settings: MapSettings;
  features: PublishedFeature[];
  publishedAt: IsoDateTime;
}

export interface VersionRecord {
  mapId: string;
  version: number;
  etag: string;
  storageKey: string;
  /** Full URL of the artifact. */
  url: string;
  byteSize: number;
  featureCount: number;
  publishedAt: IsoDateTime;
  publishedBy: { userId: string; name: string };
  cacheControl: string;
  /** How this version came to be. */
  origin: { type: "publish"; rev: number } | { type: "rollback"; fromVersion: number };
}

export interface VersionPointer {
  /** The version `latest.json` points at, or null when nothing is published. */
  version: number | null;
  url: string;
  etag: string | null;
  cacheControl: string;
  updatedAt: IsoDateTime | null;
}

/* ---------------------------------------------------------------- session */

export type Role = "owner" | "admin" | "editor" | "contributor" | "viewer";
export type Capability = "map:read" | "map:create" | "map:edit" | "map:publish" | "map:archive";

export interface Session {
  userId: string;
  name: string;
  tenant: { id: string; slug: string; name: string };
  role: Role;
  capabilities: Capability[];
  guest: boolean;
  expiresAt: IsoDateTime | null;
  usage: { maps: number };
  limits: { maxMaps: number; maxFeaturesPerMap: number; maxVersionsPerMap: number | null };
  artifactBase: string;
}

export interface AppConfig {
  artifactBase: string;
  guestSignup: boolean;
  humanCheckSiteKey: string | null;
  /** What a guest workspace allows, so the sign-in page states the server's numbers; null when guest signup is off. */
  guest: GuestTerms | null;
  /** A published map the sign-in page shows as an example of what the tool makes; null for none. */
  specimen: { tenantSlug: string; mapSlug: string } | null;
}

export interface GuestTerms {
  lifetimeHours: number;
  maxMaps: number;
  maxFeaturesPerMap: number;
  maxVersionsPerMap: number;
}

export interface PlaceResult {
  id: string;
  name: RichText;
  /** e.g. "Governorate, Oman" */
  context: string;
  at: LngLat;
  bounds: [LngLat, LngLat] | null;
}
