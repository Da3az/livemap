/**
 * The request and response shapes of the HTTP API that both sides speak.
 * The server's JSON Schemas (packages/api/src/schemas.ts) describe the same
 * shapes; the front end's client (web/src/api/http.ts) sends and reads them.
 */
import type {
  FeatureGroup,
  MapFeature,
  MapSettings,
  RichText,
  StylePreset,
  TextDir,
  VersionPointer,
  Viewport,
} from "./model.js";

/** Every error the API answers with. `error` in the body; the UI switches on it. */
export type ApiErrorCode =
  | "invalid_request" // 400: the body or parameters do not match the contract
  | "unauthorised" // 401: no session, the token was rejected, or the workspace expired
  | "forbidden" // 403: the role does not allow this
  | "quota_exceeded" // 403: maps, features or versions limit reached
  | "human_check_failed" // 403: the human-verification widget refused
  | "guest_signup_disabled" // 403: guests are turned off
  | "not_found" // 404
  | "stale_revision" // 409: someone else saved first
  | "body_too_large" // 413
  | "rate_limited" // 429, with Retry-After
  | "guest_capacity" // 503, with Retry-After
  | "network" // client only: the request never arrived
  | "internal_error"; // 500

/** What the server writes to the who-saved-first fields of a stale-revision refusal. */
export interface CurrentRevision {
  rev: number;
  updatedBy: string;
  updatedAt: string;
}

/** The one error body. `reason` is a sentence a person can read; `retryAfter` mirrors the header. */
export interface ErrorBody {
  error: ApiErrorCode;
  reason?: string;
  retryAfter?: number;
  current?: CurrentRevision;
}

/** Changes to a keyed list: whole items put (added or replaced) by id, and ids deleted. */
export interface KeyedChanges<T> {
  put: T[];
  delete: string[];
}

/**
 * Map settings change as a patch, so two editors changing different parts of
 * a map do not overwrite each other, and "keep mine" overwrites only what this
 * editor changed. A section present here replaces the stored section whole;
 * presets and groups change item by item.
 */
export interface SettingsPatch {
  basemap?: MapSettings["basemap"];
  openingView?: Viewport;
  legend?: MapSettings["legend"];
  titleBlock?: MapSettings["titleBlock"];
  timeline?: MapSettings["timeline"];
  embed?: MapSettings["embed"];
  presets?: KeyedChanges<StylePreset>;
  groups?: KeyedChanges<FeatureGroup>;
}

export interface EditRequest {
  /** The revision this edit was made against. */
  rev: number;
  put: MapFeature[];
  delete: string[];
  /** Map-level changes travel with the same revision check. */
  settings?: SettingsPatch;
  title?: RichText;
  uiDir?: Exclude<TextDir, "auto">;
  /** Apply even if the revision is stale ("keep mine"). Only what this request names is overwritten. */
  force?: boolean;
}

export interface EditResult {
  rev: number;
  updatedAt: string;
}

export interface PublishResult {
  status: "published" | "unchanged";
  version: number;
  etag: string;
}

export interface CreateMapRequest {
  title: RichText;
  uiDir: Exclude<TextDir, "auto">;
  template: "blank" | "conflict-tracker" | "storm-track" | "regional-results";
}

export interface GuestSignupRequest {
  turnstileToken?: string;
}

export interface GuestSignupResult {
  token: string;
  tenantSlug: string;
  expiresAt: string;
}

/** The body of `latest.json`, the object readers poll. */
export type PointerBody = VersionPointer;

