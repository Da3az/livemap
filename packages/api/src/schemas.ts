// Request and response shapes, as JSON Schema. Two jobs: Fastify validates
// against them at the boundary, and the OpenAPI document at /docs is generated
// from them — so the reference cannot describe a request the server would
// refuse.
//
// The feature schema restates packages/core/src/types.ts, which has no runtime
// form. That duplication can drift; test/schemas.test.ts runs every template
// feature through it so that it drifts loudly.
//
// `additionalProperties: false` REJECTS here. Fastify's default validator
// would silently delete the extra property instead; buildServer turns that off.

const DIR = { type: "string", enum: ["ltr", "rtl", "auto"] } as const;

/** Matches `isHexColor` in core. */
const HEX = {
  type: "string",
  pattern: "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
} as const;

/** A document title: never empty. */
export const RICH_TEXT = {
  type: "object",
  additionalProperties: false,
  required: ["value", "dir"],
  properties: {
    value: { type: "string", minLength: 1, maxLength: 200 },
    dir: DIR,
  },
} as const;

/** Text on a feature. May be empty: clearing a label is an edit, not an error. */
const FEATURE_TEXT = {
  type: "object",
  additionalProperties: false,
  required: ["value", "dir"],
  properties: {
    value: { type: "string", maxLength: 2000 },
    dir: DIR,
  },
} as const;

// [longitude, latitude]. One bound for both members: a single `items` schema
// is valid in JSON Schema draft-07 and in OpenAPI alike, where a per-position
// tuple is spelled differently in each. Latitude past ±90 is still refused,
// by PostGIS.
const LNG_LAT = {
  type: "array",
  minItems: 2,
  maxItems: 2,
  items: { type: "number", minimum: -180, maximum: 180 },
} as const;

const PATH = { type: "array", maxItems: 20_000, items: LNG_LAT } as const;

const DASH = {
  type: "array",
  maxItems: 16,
  items: { type: "number", minimum: 0 },
} as const;

const FILL = {
  type: "object",
  additionalProperties: false,
  required: ["color", "opacity"],
  properties: {
    color: HEX,
    opacity: { type: "number", minimum: 0, maximum: 1 },
    pattern: { type: "string", maxLength: 64 },
  },
} as const;

const STROKE = {
  type: "object",
  additionalProperties: false,
  required: ["color", "width", "opacity"],
  properties: {
    color: HEX,
    width: { type: "number", minimum: 0 },
    opacity: { type: "number", minimum: 0, maximum: 1 },
    dash: DASH,
  },
} as const;

const LABEL_STYLE = {
  type: "object",
  additionalProperties: false,
  required: ["color", "haloColor", "haloWidth", "size"],
  properties: {
    color: HEX,
    haloColor: HEX,
    haloWidth: { type: "number", minimum: 0 },
    size: { type: "number", exclusiveMinimum: 0 },
  },
} as const;

const LEADER = {
  type: "object",
  additionalProperties: false,
  required: ["color", "width", "shape", "anchorDot"],
  properties: {
    color: HEX,
    width: { type: "number", minimum: 0 },
    dash: DASH,
    shape: { type: "string", enum: ["straight", "elbow"] },
    anchorDot: { type: "boolean" },
  },
} as const;

/** Shared by every kind. */
const BASE = {
  id: { type: "string", minLength: 1, maxLength: 128 },
  // Base-62 fractional index that never ends in "0" — `isValidOrderKey`.
  at: { type: "string", maxLength: 64, pattern: "^[0-9A-Za-z]*[1-9A-Za-z]$" },
  label: FEATURE_TEXT,
  labelStyle: LABEL_STYLE,
  meta: {
    type: "object",
    maxProperties: 32,
    additionalProperties: { type: "string", maxLength: 500 },
  },
} as const;

function kind<
  K extends string,
  P extends Record<string, unknown>,
  R extends readonly string[],
>(name: K, required: R, properties: P) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "kind", "at", ...required],
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
    kind("area", ["rings", "fill", "stroke"] as const, {
      rings: { type: "array", minItems: 1, maxItems: 64, items: PATH },
      fill: FILL,
      stroke: STROKE,
    }),
    kind("line", ["path", "stroke"] as const, { path: PATH, stroke: STROKE }),
    kind("arrow", ["control", "curvature", "head", "stroke", "chevrons"] as const, {
      control: PATH,
      curvature: { type: "number", minimum: 0, maximum: 1 },
      head: { type: "string", enum: ["none", "single", "double"] },
      stroke: STROKE,
      chevrons: { type: "boolean" },
    }),
    kind(
      "frontline",
      ["path", "facing", "stroke", "toothSpacing", "toothSize"] as const,
      {
        path: PATH,
        facing: { type: "string", enum: ["left", "right"] },
        stroke: STROKE,
        toothSpacing: { type: "number", exclusiveMinimum: 0 },
        toothSize: { type: "number", exclusiveMinimum: 0 },
      },
    ),
    kind("point", ["at_", "icon", "iconColor", "iconSize"] as const, {
      at_: LNG_LAT,
      icon: { type: "string", minLength: 1, maxLength: 128 },
      iconColor: HEX,
      iconSize: { type: "number", exclusiveMinimum: 0 },
      disc: {
        type: "object",
        additionalProperties: false,
        required: ["fill", "ring"],
        properties: { fill: HEX, ring: HEX },
      },
    }),
    kind("annotation", ["anchor", "offset", "text", "labelStyle"] as const, {
      anchor: LNG_LAT,
      // Screen pixels from the anchor, not coordinates.
      offset: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: { type: "number", minimum: -4000, maximum: 4000 },
      },
      text: FEATURE_TEXT,
      leader: { anyOf: [{ type: "null" }, LEADER] },
    }),
  ],
} as const;

export const MAP_PARAMS = {
  type: "object",
  required: ["mapId"],
  properties: { mapId: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

export const CREATE_BODY = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: RICH_TEXT,
    uiDir: DIR,
    template: { type: "string", minLength: 1, maxLength: 64 },
  },
} as const;

export const PATCH_BODY = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: { title: RICH_TEXT, uiDir: DIR },
} as const;

export const LIST_QUERY = {
  type: "object",
  additionalProperties: false,
  properties: { archived: { type: "string", enum: ["0", "1"] } },
} as const;

export const GUEST_BODY = {
  type: "object",
  additionalProperties: false,
  properties: { turnstileToken: { type: "string", maxLength: 4096 } },
} as const;

// `rev` and `toVersion` are deliberately not `required` here. Their absence is
// answered by the handler with a named error — rev_required,
// to_version_required — which says more than "body must have required
// property", and which clients already match on.
export const EDIT_BODY = {
  type: "object",
  additionalProperties: false,
  properties: {
    rev: { type: "integer", minimum: 0 },
    put: { type: "array", maxItems: 5_000, items: FEATURE },
    delete: {
      type: "array",
      maxItems: 5_000,
      items: { type: "string", minLength: 1, maxLength: 128 },
    },
  },
} as const;

export const ROLLBACK_BODY = {
  type: "object",
  additionalProperties: false,
  properties: { toVersion: { type: "integer" } },
} as const;

/** Every refusal has this shape. Open, because some carry a reason or a request id. */
export const ERROR = {
  type: "object",
  required: ["error"],
  additionalProperties: true,
  properties: {
    error: { type: "string" },
    reason: { type: "string" },
    message: { type: "string" },
    reqId: { type: "string" },
  },
} as const;

// Response schemas are given only where the shape is small and closed. The
// serializer drops any property a response schema does not name, so a schema
// on a map or a feature would be one missed field away from truncating data.
export const OK = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
} as const;

export const GUEST_CREATED = {
  type: "object",
  additionalProperties: false,
  required: ["token", "tenantSlug", "expiresAt"],
  properties: {
    token: { type: "string" },
    tenantSlug: { type: "string" },
    expiresAt: { type: "string" },
  },
} as const;

export const EDIT_APPLIED = {
  type: "object",
  additionalProperties: false,
  required: ["rev"],
  properties: { rev: { type: "integer" } },
} as const;
