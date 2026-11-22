// Request and response shapes, as JSON Schema. Two jobs: Fastify validates
// against them at the boundary, and the OpenAPI document at /docs is generated
// from them — so the reference cannot describe a request the server would
// refuse.
//
// They restate the shared model in packages/core/src/model.ts and api.ts,
// which has no runtime form. What JSON Schema cannot say (rings closed,
// latitude within ±90, a feature's group existing in the settings) is checked
// in validate.ts and in the repository after the write.
//
// `additionalProperties: false` REJECTS here. Fastify's default validator
// would silently delete the extra property instead; buildServer turns that off.

const DIR = { type: "string", enum: ["ltr", "rtl", "auto"] } as const;
const UI_DIR = { type: "string", enum: ["ltr", "rtl"] } as const;
const ISO = { type: "string", format: "date-time", maxLength: 40 } as const;
const ID = { type: "string", minLength: 1, maxLength: 128 } as const;
const UNIT = { type: "number", minimum: 0, maximum: 1 } as const;

/** A document title: never empty. */
export const RICH_TEXT = {
  type: "object",
  additionalProperties: false,
  required: ["value", "dir"],
  properties: { value: { type: "string", minLength: 1, maxLength: 200 }, dir: DIR },
} as const;

/** Text on a feature or in the furniture. May be empty: clearing it is an edit, not an error. */
const TEXT = {
  type: "object",
  additionalProperties: false,
  required: ["value", "dir"],
  properties: { value: { type: "string", maxLength: 2000 }, dir: DIR },
} as const;

const NULLABLE_TEXT = { oneOf: [TEXT, { type: "null" }] } as const;

// [longitude, latitude]. One bound for both members: a single `items` schema
// is valid in JSON Schema and in OpenAPI alike. Latitude past ±90 is refused
// by validate.ts.
const LNG_LAT = { type: "array", minItems: 2, maxItems: 2, items: { type: "number", minimum: -180, maximum: 180 } } as const;
const PATH = { type: "array", minItems: 2, maxItems: 20_000, items: LNG_LAT } as const;

const SLOT = { type: "integer", minimum: 1, maximum: 8 } as const;
const COLOR = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["slot"], properties: { slot: SLOT } },
    {
      type: "object",
      additionalProperties: false,
      required: ["custom"],
      properties: { custom: { type: "string", pattern: "^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$" } },
    },
  ],
} as const;

const DASH = {
  oneOf: [
    { type: "string", enum: ["solid", "dashed", "dotted"] },
    {
      type: "object",
      additionalProperties: false,
      required: ["custom"],
      properties: { custom: { type: "array", minItems: 2, maxItems: 16, items: { type: "number", minimum: 0, maximum: 100 } } },
    },
  ],
} as const;

const FILL = {
  type: "object",
  additionalProperties: false,
  required: ["color", "opacity", "pattern"],
  properties: { color: COLOR, opacity: UNIT, pattern: { type: "string", enum: ["none", "hatch", "cross", "dots"] } },
} as const;

const STROKE = {
  type: "object",
  additionalProperties: false,
  required: ["color", "width", "opacity", "dash"],
  properties: { color: COLOR, width: { type: "number", minimum: 0, maximum: 64 }, opacity: UNIT, dash: DASH },
} as const;

const LABEL_STYLE = {
  type: "object",
  additionalProperties: false,
  required: ["color", "size", "weight", "halo", "box"],
  properties: {
    color: { oneOf: [COLOR, { type: "string", const: "ink" }] },
    size: { type: "number", minimum: 6, maximum: 72 },
    weight: { type: "integer", enum: [400, 600] },
    halo: { type: "boolean" },
    box: { type: "boolean" },
  },
} as const;

const KINDS = ["area", "line", "arrow", "frontline", "point", "annotation"] as const;
const ICONS = ["strike", "explosion", "checkpoint", "shelter", "hospital", "flood", "fire", "airport", "port", "camp", "aid", "pin"] as const;

/** Shared by every kind. */
const BASE = {
  id: ID,
  // A fractional index over 0-9A-Za-z (packages/core/src/order.ts).
  order: { type: "string", minLength: 1, maxLength: 64, pattern: "^[0-9A-Za-z]+$" },
  name: TEXT,
  label: TEXT,
  labelStyle: LABEL_STYLE,
  groupId: { oneOf: [ID, { type: "null" }] },
  hidden: { type: "boolean" },
  locked: { type: "boolean" },
  presetId: { oneOf: [ID, { type: "null" }] },
  validFrom: { oneOf: [ISO, { type: "null" }] },
  validTo: { oneOf: [ISO, { type: "null" }] },
  lineageId: { oneOf: [ID, { type: "null" }] },
  // Sent back by clients that echo a loaded feature; the server overwrites both.
  updatedAt: { type: "string", maxLength: 40 },
  updatedBy: { type: "string", maxLength: 200 },
} as const;

const BASE_REQUIRED = ["id", "kind", "order", "name", "groupId", "hidden", "locked", "presetId", "validFrom", "validTo", "lineageId"] as const;

function kind<K extends (typeof KINDS)[number], P extends Record<string, unknown>, R extends readonly string[]>(name: K, required: R, properties: P) {
  return {
    type: "object",
    additionalProperties: false,
    required: [...BASE_REQUIRED, ...required],
    properties: { ...BASE, kind: { type: "string", const: name }, ...properties },
  } as const;
}

export const FEATURE = {
  type: "object",
  // Tells the validator which branch to report against. Without it a bad
  // arrow comes back as six failures, one per kind it also is not.
  discriminator: { propertyName: "kind" },
  required: ["kind"],
  oneOf: [
    kind("area", ["rings", "fill", "stroke"], {
      rings: { type: "array", minItems: 1, maxItems: 500, items: { type: "array", minItems: 4, maxItems: 20_000, items: LNG_LAT } },
      fill: FILL,
      stroke: STROKE,
    }),
    kind("line", ["path", "stroke"], { path: PATH, stroke: STROKE }),
    kind("arrow", ["control", "curvature", "head", "tapered", "stroke"], {
      control: { type: "array", minItems: 2, maxItems: 64, items: LNG_LAT },
      curvature: UNIT,
      bend: { type: "string", enum: ["left", "right"] },
      head: { type: "string", enum: ["none", "single", "double"] },
      tapered: { type: "boolean" },
      stroke: STROKE,
    }),
    kind("frontline", ["path", "facing", "toothShape", "toothSpacing", "toothSize", "stroke"], {
      path: PATH,
      facing: { type: "string", enum: ["left", "right"] },
      toothShape: { type: "string", enum: ["triangle", "semicircle"] },
      toothSpacing: { type: "number", minimum: 2, maximum: 400 },
      toothSize: { type: "number", minimum: 1, maximum: 100 },
      stroke: STROKE,
    }),
    kind("point", ["at", "symbol", "color", "size"], {
      at: LNG_LAT,
      symbol: {
        oneOf: [
          { type: "object", additionalProperties: false, required: ["icon"], properties: { icon: { type: "string", enum: ICONS } } },
          { type: "object", additionalProperties: false, required: ["number"], properties: { number: { type: "string", minLength: 1, maxLength: 3 } } },
        ],
      },
      color: COLOR,
      size: { type: "number", minimum: 4, maximum: 96 },
    }),
    kind("annotation", ["anchor", "textAt", "text", "labelStyle", "leader"], {
      anchor: LNG_LAT,
      textAt: LNG_LAT,
      text: TEXT,
      leader: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["shape", "anchorDot"],
            properties: { shape: { type: "string", enum: ["straight", "elbow"] }, anchorDot: { type: "boolean" } },
          },
          { type: "null" },
        ],
      },
    }),
  ],
} as const;

const VIEWPORT = {
  type: "object",
  additionalProperties: false,
  required: ["center", "zoom", "bearing", "pitch"],
  properties: {
    center: LNG_LAT,
    zoom: { type: "number", minimum: 0, maximum: 24 },
    bearing: { type: "number", minimum: -360, maximum: 360 },
    pitch: { type: "number", minimum: 0, maximum: 85 },
  },
} as const;

const BASEMAP = {
  type: "object",
  additionalProperties: false,
  required: ["styleId", "labelLanguage"],
  properties: {
    styleId: { type: "string", enum: ["positron", "bright", "liberty", "dark", "fiord"] },
    labelLanguage: { type: "string", enum: ["ar", "en", "local"] },
  },
} as const;

const PRESET = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "appliesTo"],
  properties: {
    id: ID,
    name: TEXT,
    appliesTo: { type: "array", minItems: 1, maxItems: 6, uniqueItems: true, items: { type: "string", enum: KINDS } },
    fill: FILL,
    stroke: STROKE,
    iconColor: COLOR,
  },
} as const;

const GROUP = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "order", "hidden", "locked"],
  properties: { id: ID, name: TEXT, order: BASE.order, hidden: { type: "boolean" }, locked: { type: "boolean" } },
} as const;

const LEGEND = {
  type: "object",
  additionalProperties: false,
  required: ["show", "title", "position", "items"],
  properties: {
    show: { type: "boolean" },
    title: TEXT,
    position: { type: "string", enum: ["top-start", "top-end", "bottom-start", "bottom-end"] },
    items: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "label", "hidden"],
        properties: {
          ref: {
            oneOf: [
              { type: "object", additionalProperties: false, required: ["presetId"], properties: { presetId: ID } },
              { type: "object", additionalProperties: false, required: ["featureId"], properties: { featureId: ID } },
            ],
          },
          label: NULLABLE_TEXT,
          hidden: { type: "boolean" },
        },
      },
    },
  },
} as const;

const TITLE_BLOCK = {
  type: "object",
  additionalProperties: false,
  required: ["show", "subtitle", "source", "credit", "note", "asOf"],
  properties: {
    show: { type: "boolean" },
    subtitle: NULLABLE_TEXT,
    source: NULLABLE_TEXT,
    credit: NULLABLE_TEXT,
    note: NULLABLE_TEXT,
    asOf: { oneOf: [ISO, { type: "null" }] },
  },
} as const;

const TIMELINE = {
  type: "object",
  additionalProperties: false,
  required: ["enabled", "mode", "speed", "windowMs"],
  properties: {
    enabled: { type: "boolean" },
    mode: { type: "string", enum: ["moving", "cumulative"] },
    speed: { type: "number", exclusiveMinimum: 0, maximum: 31_536_000 },
    windowMs: { type: "number", minimum: 60_000, maximum: 31_536_000_000 },
  },
} as const;

const EMBED = {
  type: "object",
  additionalProperties: false,
  required: ["legend", "zoomButtons", "panButtons", "scaleBar", "cooperativeGestures", "static", "theme"],
  properties: {
    legend: { type: "boolean" },
    zoomButtons: { type: "boolean" },
    panButtons: { type: "boolean" },
    scaleBar: { type: "boolean" },
    cooperativeGestures: { type: "boolean" },
    static: { type: "boolean" },
    theme: { type: "string", enum: ["light", "dark", "auto"] },
  },
} as const;

const keyed = (item: object) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["put", "delete"],
    properties: { put: { type: "array", maxItems: 500, items: item }, delete: { type: "array", maxItems: 500, items: ID } },
  }) as const;

/** `SettingsPatch` in packages/core/src/api.ts. */
const SETTINGS_PATCH = {
  type: "object",
  additionalProperties: false,
  properties: {
    basemap: BASEMAP,
    openingView: VIEWPORT,
    legend: LEGEND,
    titleBlock: TITLE_BLOCK,
    timeline: TIMELINE,
    embed: EMBED,
    presets: keyed(PRESET),
    groups: keyed(GROUP),
  },
} as const;

export const MAP_PARAMS = {
  type: "object",
  required: ["mapId"],
  properties: { mapId: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

export const CREATE_BODY = {
  type: "object",
  additionalProperties: false,
  required: ["title", "uiDir", "template"],
  properties: {
    // May be empty: the dialog lets a map start untitled, and the server names it.
    title: { ...TEXT, properties: { value: { type: "string", maxLength: 200 }, dir: DIR } },
    uiDir: UI_DIR,
    template: { type: "string", enum: ["blank", "conflict-tracker", "storm-track", "regional-results"] },
  },
} as const;

export const LIST_QUERY = {
  type: "object",
  additionalProperties: false,
  properties: { archived: { type: "string", enum: ["true", "false"] } },
} as const;

export const GUEST_BODY = {
  type: "object",
  additionalProperties: false,
  properties: { turnstileToken: { type: "string", maxLength: 4096 } },
} as const;

/** `EditRequest` in packages/core/src/api.ts. */
export const EDIT_BODY = {
  type: "object",
  additionalProperties: false,
  required: ["rev", "put", "delete"],
  properties: {
    rev: { type: "integer", minimum: 0 },
    put: { type: "array", maxItems: 20_000, items: FEATURE },
    delete: { type: "array", maxItems: 20_000, items: ID },
    settings: SETTINGS_PATCH,
    title: RICH_TEXT,
    uiDir: UI_DIR,
    force: { type: "boolean" },
  },
} as const;

export const ROLLBACK_BODY = {
  type: "object",
  additionalProperties: false,
  required: ["toVersion"],
  properties: { toVersion: { type: "integer", minimum: 1 } },
} as const;

/** `ErrorBody` in packages/core/src/api.ts. Every refusal has this shape. */
export const ERROR = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
    reason: { type: "string" },
    retryAfter: { type: "number" },
    current: {
      type: "object",
      required: ["rev", "updatedBy", "updatedAt"],
      properties: { rev: { type: "integer" }, updatedBy: { type: "string" }, updatedAt: { type: "string" } },
    },
  },
} as const;

export const OK = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
} as const;

export const GUEST_CREATED = {
  type: "object",
  required: ["token", "tenantSlug", "expiresAt"],
  properties: { token: { type: "string" }, tenantSlug: { type: "string" }, expiresAt: { type: "string" } },
} as const;

export const EDIT_APPLIED = {
  type: "object",
  required: ["rev", "updatedAt"],
  properties: { rev: { type: "integer" }, updatedAt: { type: "string" } },
} as const;
