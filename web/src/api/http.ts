/**
 * The real `ApiClient`: HTTP to packages/api, and plain fetches of published
 * artifacts from wherever the server says they are served (`artifactBase`,
 * the CDN in production). The read path never goes through the API.
 */
import type { ApiErrorCode, ErrorBody, PublishResult } from "@livemap/core";
import { fromArtifact } from "@/model/published";
import type {
  AppConfig,
  MapDoc,
  MapFeature,
  MapSummary,
  MapVersion,
  PlaceResult,
  Session,
  TemplateSummary,
  VersionPointer,
  VersionRecord,
} from "@/model/types";
import type { MapVersion as Artifact } from "@livemap/core";
import { ApiError, type ApiClient, type EditRequest, type PublishedPointerResult } from "./client";

const KNOWN_CODES: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  "invalid_request",
  "unauthorised",
  "forbidden",
  "quota_exceeded",
  "human_check_failed",
  "guest_signup_disabled",
  "not_found",
  "stale_revision",
  "body_too_large",
  "rate_limited",
  "guest_capacity",
  "network",
  "internal_error",
]);

/**
 * Where the session token lives. A guest cannot sign in again once its token
 * is lost, so a guest's survives the tab in localStorage; a pasted member
 * token lasts only as long as the tab, in sessionStorage. Storage can throw
 * (a sandboxed frame, a privacy mode); the token then lives for the visit.
 */
const TOKEN_KEY = "livemap.session";

class TokenStore {
  private memory: string | null = null;

  read(): string | null {
    if (this.memory !== null) return this.memory;
    for (const storage of [safeStorage("session"), safeStorage("local")]) {
      try {
        const value = storage?.getItem(TOKEN_KEY) ?? null;
        if (value) return (this.memory = value);
      } catch {
        /* unavailable: memory only */
      }
    }
    return null;
  }

  write(token: string, kind: "guest" | "member"): void {
    this.clear();
    this.memory = token;
    try {
      safeStorage(kind === "guest" ? "local" : "session")?.setItem(TOKEN_KEY, token);
    } catch {
      /* unavailable: memory only */
    }
  }

  clear(): void {
    this.memory = null;
    for (const storage of [safeStorage("session"), safeStorage("local")]) {
      try {
        storage?.removeItem(TOKEN_KEY);
      } catch {
        /* unavailable */
      }
    }
  }
}

function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function retryAfterOf(response: Response, body: ErrorBody | null): number | null {
  const header = response.headers.get("retry-after");
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds;
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, Math.round((at - Date.now()) / 1000));
  }
  return typeof body?.retryAfter === "number" ? body.retryAfter : null;
}

/** Every non-2xx answer becomes an `ApiError`; the screens switch on `code` and receive nothing else. */
async function errorFrom(response: Response): Promise<ApiError> {
  let body: ErrorBody | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string") body = parsed as ErrorBody;
  } catch {
    /* not JSON */
  }
  const known = body !== null && KNOWN_CODES.has(body.error) && body.error !== "network";
  const code: ApiErrorCode = known ? body!.error : response.status === 404 ? "not_found" : "internal_error";
  return new ApiError({
    status: response.status,
    code,
    reason: body?.reason ?? null,
    retryAfter: retryAfterOf(response, body),
    current: body?.current ?? null,
  });
}

function networkError(error: unknown): ApiError {
  return new ApiError({ status: 0, code: "network", reason: error instanceof Error ? error.message : null });
}

/**
 * @param baseUrl Where the API is served, without a trailing slash. Empty for
 * the same origin as the page, which is how production serves it.
 */
export function createHttpApiClient(baseUrl = ""): ApiClient {
  const base = baseUrl.replace(/\/$/, "");
  const tokens = new TokenStore();
  let config: Promise<AppConfig> | null = null;
  /** Artifact addresses seen in version lists, so a version can be fetched by number. */
  const versionUrls = new Map<string, string>();

  /** No retries here: the query client retries network failures only, and never a save. */
  async function request(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (init.auth !== false) {
      const token = tokens.read();
      if (token) headers.set("authorization", `Bearer ${token}`);
    }
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, { ...init, headers });
    } catch (error) {
      throw networkError(error);
    }
    if (!response.ok) throw await errorFrom(response);
    return response;
  }

  async function json<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
    const response = await request(path, init);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError({ status: response.status, code: "internal_error", reason: "The server answered with something that is not JSON." });
    }
  }

  const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

  function getConfig(): Promise<AppConfig> {
    config ??= json<AppConfig>("/config", { auth: false }).catch((error: unknown) => {
      config = null;
      throw error;
    });
    return config;
  }

  /** Artifacts are public and served by the CDN; `artifactBase` may be relative to the API's origin. */
  async function artifactAddress(path: string): Promise<string> {
    const { artifactBase } = await getConfig();
    const root = /^https?:\/\//.test(artifactBase) ? artifactBase : `${base}${artifactBase}`;
    return `${root.replace(/\/$/, "")}/${path}`;
  }

  /** A plain cross-origin read: no credential, nothing a CDN could tie to a person. */
  async function fetchPublic(url: string, headers: Record<string, string> = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, { headers, credentials: "omit" });
    } catch (error) {
      throw networkError(error);
    }
    if (response.status === 304) return response;
    if (!response.ok) throw await errorFrom(response);
    return response;
  }

  async function readArtifact(url: string): Promise<MapVersion> {
    const response = await fetchPublic(url);
    try {
      return fromArtifact((await response.json()) as Artifact);
    } catch {
      throw new ApiError({ status: response.status, code: "internal_error", reason: "The published map could not be read." });
    }
  }

  const pointerPath = (tenantSlug: string, mapSlug: string) => `t/${encodeURIComponent(tenantSlug)}/m/${encodeURIComponent(mapSlug)}/latest.json`;
  const versionPath = (tenantSlug: string, mapSlug: string, version: number) =>
    `t/${encodeURIComponent(tenantSlug)}/m/${encodeURIComponent(mapSlug)}/v/${version}.json`;

  async function getSession(): Promise<Session> {
    return json<Session>("/api/v1/session");
  }

  async function listVersions(id: string): Promise<{ pointer: VersionPointer; versions: VersionRecord[] }> {
    const out = await json<{ pointer: VersionPointer; versions: VersionRecord[] }>(`/api/v1/maps/${encodeURIComponent(id)}/versions`);
    for (const record of out.versions) versionUrls.set(`${id}/${record.version}`, record.url);
    return out;
  }

  async function getPublishedPointer(tenantSlug: string, mapSlug: string, input?: { ifNoneMatch?: string | null }): Promise<PublishedPointerResult> {
    const headers: Record<string, string> = {
      // Without this a layered cache can hide a new version for its whole lifetime.
      "cache-control": "no-cache",
    };
    if (input?.ifNoneMatch) headers["if-none-match"] = input.ifNoneMatch;
    const response = await fetchPublic(await artifactAddress(pointerPath(tenantSlug, mapSlug)), headers);
    if (response.status === 304) return { notModified: true };
    let body: VersionPointer;
    try {
      body = (await response.json()) as VersionPointer;
    } catch {
      throw new ApiError({ status: response.status, code: "internal_error", reason: "The published map's pointer could not be read." });
    }
    /*
     * The next poll must send back the validator the store sent, which is the
     * HTTP ETag, not the artifact's etag inside the body (an object store
     * computes its own). The bucket's CORS rule exposes the header.
     */
    return { notModified: false, pointer: { ...body, etag: response.headers.get("etag") ?? body.etag } };
  }

  async function getPublishedVersion(tenantSlug: string, mapSlug: string, version: number): Promise<MapVersion> {
    return readArtifact(await artifactAddress(versionPath(tenantSlug, mapSlug, version)));
  }

  return {
    getConfig,

    async signInAsGuest(input) {
      const created = await json<{ token: string }>(
        "/auth/guest",
        { ...post(input.humanCheckToken ? { turnstileToken: input.humanCheckToken } : {}), auth: false },
      );
      tokens.write(created.token, "guest");
      return getSession();
    },

    async signInWithToken(token) {
      tokens.write(token.trim(), "member");
      try {
        const session = await getSession();
        /* A pasted guest token is kept like any guest's, so it survives the tab. */
        if (session.guest) tokens.write(token.trim(), "guest");
        return session;
      } catch (error) {
        tokens.clear();
        throw error;
      }
    },

    async signOut() {
      /* A bearer token is stateless; forgetting it is signing out. */
      tokens.clear();
    },

    getSession,

    async listTemplates(): Promise<TemplateSummary[]> {
      return (await json<{ templates: TemplateSummary[] }>("/api/v1/templates")).templates;
    },

    async listMaps(input): Promise<MapSummary[]> {
      return (await json<{ maps: MapSummary[] }>(`/api/v1/maps?archived=${input.archived ? "true" : "false"}`)).maps;
    },

    async createMap(input): Promise<MapDoc> {
      return (await json<{ map: MapDoc }>("/api/v1/maps", post(input))).map;
    },

    async getMap(id): Promise<{ map: MapDoc; features: MapFeature[] }> {
      return json(`/api/v1/maps/${encodeURIComponent(id)}`);
    },

    async archiveMap(id) {
      await request(`/api/v1/maps/${encodeURIComponent(id)}/archive`, { method: "POST" });
    },

    async unarchiveMap(id) {
      await request(`/api/v1/maps/${encodeURIComponent(id)}/unarchive`, { method: "POST" });
    },

    async editMap(id, edit: EditRequest) {
      return json(`/api/v1/maps/${encodeURIComponent(id)}/edit`, post(edit));
    },

    async publishMap(id): Promise<PublishResult> {
      return json(`/api/v1/maps/${encodeURIComponent(id)}/publish`, { method: "POST" });
    },

    listVersions,

    async getVersion(id, version) {
      let url = versionUrls.get(`${id}/${version}`);
      if (url === undefined) {
        await listVersions(id);
        url = versionUrls.get(`${id}/${version}`);
      }
      if (url === undefined) throw new ApiError({ status: 404, code: "not_found", reason: `This map has no version ${version}.` });
      return readArtifact(/^https?:\/\//.test(url) ? url : `${base}${url}`);
    },

    async rollbackMap(id, input) {
      return json(`/api/v1/maps/${encodeURIComponent(id)}/rollback`, post(input));
    },

    async getPublished(tenantSlug, mapSlug) {
      /*
       * A static store answers 404 both for an address with no map and for a
       * map never published; neither has anything to show, and both read as
       * "nothing is published here" (the embed's not-found statement).
       */
      const answer = await getPublishedPointer(tenantSlug, mapSlug);
      if (answer.notModified || answer.pointer.version === null) return null;
      return getPublishedVersion(tenantSlug, mapSlug, answer.pointer.version);
    },

    getPublishedPointer,
    getPublishedVersion,

    async searchPlaces(query, input): Promise<PlaceResult[]> {
      const params = new URLSearchParams({ q: query, lang: input.language });
      return (await json<{ places: PlaceResult[] }>(`/api/v1/places?${params.toString()}`)).places;
    },
  };
}
