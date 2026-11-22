import type {
  AppConfig,
  MapDoc,
  MapFeature,
  MapSummary,
  MapVersion,
  RichText,
  Session,
  TemplateSummary,
  TextDir,
  VersionPointer,
  VersionRecord,
} from "@/model/types";

import type { ApiErrorCode, CurrentRevision, EditRequest, EditResult, PublishResult } from "@livemap/core";

export type { ApiErrorCode, EditRequest, PublishResult };

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** A sentence from the server explaining a refusal, when it sent one. */
  readonly reason: string | null;
  /** Seconds, for rate_limited and guest_capacity. */
  readonly retryAfter: number | null;
  /** Present on stale_revision: what the server holds now. */
  readonly current: CurrentRevision | null;

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    reason?: string | null;
    retryAfter?: number | null;
    current?: ApiError["current"];
  }) {
    super(init.reason ?? init.code);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.reason = init.reason ?? null;
    this.retryAfter = init.retryAfter ?? null;
    this.current = init.current ?? null;
  }
}

/** What a pointer poll answers. */
export type PublishedPointerResult = { notModified: true } | { notModified: false; pointer: VersionPointer };

/**
 * All data access goes through this interface. Components never call fetch.
 * `createMockApiClient` implements it in memory; INTEGRATION.md lists what a
 * real implementation must replace.
 */
export interface ApiClient {
  getConfig(): Promise<AppConfig>;

  /** Start a temporary guest workspace. */
  signInAsGuest(input: { humanCheckToken?: string }): Promise<Session>;
  /** Sign in with a pasted session token. */
  signInWithToken(token: string): Promise<Session>;
  signOut(): Promise<void>;
  /** The current session, or an `unauthorised` ApiError. */
  getSession(): Promise<Session>;

  listTemplates(): Promise<TemplateSummary[]>;
  listMaps(input: { archived: boolean }): Promise<MapSummary[]>;
  createMap(input: { title: RichText; uiDir: Exclude<TextDir, "auto">; template: TemplateSummary["id"] }): Promise<MapDoc>;
  getMap(id: string): Promise<{ map: MapDoc; features: MapFeature[] }>;
  archiveMap(id: string): Promise<void>;
  unarchiveMap(id: string): Promise<void>;

  /** Save. Rejects with `stale_revision` when someone else saved first. */
  editMap(id: string, edit: EditRequest): Promise<EditResult>;

  publishMap(id: string): Promise<PublishResult>;
  listVersions(id: string): Promise<{ pointer: VersionPointer; versions: VersionRecord[] }>;
  /** One published artifact, for preview and for the diff between versions. */
  getVersion(id: string, version: number): Promise<MapVersion>;
  rollbackMap(id: string, input: { toVersion: number }): Promise<{ status: "rolled_back"; version: number }>;

  /** What the embed loads: the live artifact for a slug, or null when unpublished. */
  getPublished(tenantSlug: string, mapSlug: string): Promise<MapVersion | null>;
  /**
   * The live pointer for a slug, anonymous and a few hundred bytes: what a
   * reader polls. Passing the etag it last saw answers `notModified` (a 304)
   * when nothing was published since, so a poll costs no artifact.
   */
  getPublishedPointer(tenantSlug: string, mapSlug: string, input?: { ifNoneMatch?: string | null }): Promise<PublishedPointerResult>;
  /** One immutable published artifact of a slug, anonymous: fetched once per version the pointer names. */
  getPublishedVersion(tenantSlug: string, mapSlug: string, version: number): Promise<MapVersion>;
}
