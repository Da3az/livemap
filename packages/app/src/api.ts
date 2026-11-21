// The one place the shell talks to the server. Everything else gets typed
// values or an ApiError — never a Response to interpret for itself.

import type { MapDoc, RichText, TextDir } from "@livemap/core";

export interface ClientConfig {
  readonly artifactBase: string;
  readonly guestSignup: boolean;
  readonly humanCheckSiteKey: string | null;
}

export interface Session {
  readonly userId: string;
  readonly tenant: { readonly id: string; readonly slug: string };
  readonly role: string;
  readonly capabilities: readonly string[];
  readonly guest: boolean;
  readonly expiresAt: string | null;
  readonly usage: { readonly maps: number };
  readonly limits: {
    readonly maxMaps: number;
    readonly maxFeaturesPerMap: number;
    readonly maxVersionsPerMap: number | null;
  };
  readonly artifactBase: string;
}

export interface MapSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: RichText;
  readonly uiDir: TextDir;
  readonly rev: number;
  readonly publishedVersion?: number;
  readonly updatedAt: string;
  readonly featureCount: number;
  readonly archived: boolean;
}

export interface TemplateSummary {
  readonly id: string;
  readonly title: string;
  readonly uiDir: TextDir;
  readonly featureCount: number;
}

export interface VersionRecord {
  readonly mapId: string;
  readonly version: number;
  readonly etag: string;
  readonly storageKey: string;
  readonly byteSize: number;
  readonly featureCount: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's machine code: `quota_exceeded`, `rate_limited`, … */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "livemap.token";

/**
 * A sentence for a refusal. The server's `reason` and `message` are written to
 * be shown; a rate limit says when to come back.
 */
async function describe(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // Not JSON — a proxy's error page. The status is all there is.
  }
  const code = typeof body["error"] === "string" ? body["error"] : "error";

  if (res.status === 429) {
    const wait = res.headers.get("retry-after");
    return new ApiError(
      429,
      code,
      wait
        ? `Too many requests. Try again in ${wait}s.`
        : "Too many requests. Try again shortly.",
    );
  }
  const why = body["reason"] ?? body["message"];
  return new ApiError(
    res.status,
    code,
    typeof why === "string" ? why : `Request failed (${res.status}, ${code}).`,
  );
}

export class Api {
  /** Called when the server rejects the stored token. Set by the router. */
  onUnauthorized: () => void = () => {};

  get token(): string | null {
    // localStorage, not sessionStorage: a guest has no way to sign in again,
    // so a credential that died with the tab would strand a workspace that
    // still has a week to live.
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token: string | null): void {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  /**
   * `fetch` with the bearer token added. An arrow property, so it can be
   * handed to the editor as a bare function without losing `this`.
   */
  readonly fetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const token = this.token;
    if (token) headers.set("authorization", `Bearer ${token}`);
    const res = await globalThis.fetch(input, { ...init, headers });
    if (res.status === 401 && token) {
      this.setToken(null);
      this.onUnauthorized();
    }
    return res;
  };

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.fetch(path, {
      method,
      // A JSON content type on an empty body is refused by the server, so the
      // header is sent only with a body.
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (!res.ok) throw await describe(res);
    return (await res.json()) as T;
  }

  async config(): Promise<ClientConfig> {
    const res = await globalThis.fetch("/config");
    if (!res.ok) throw await describe(res);
    return (await res.json()) as ClientConfig;
  }

  async guest(turnstileToken: string | null): Promise<{ token: string }> {
    const res = await globalThis.fetch("/auth/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(turnstileToken ? { turnstileToken } : {}),
    });
    if (!res.ok) throw await describe(res);
    return (await res.json()) as { token: string };
  }

  me(): Promise<Session> {
    return this.request("GET", "/api/v1/me");
  }

  async templates(): Promise<TemplateSummary[]> {
    const r = await this.request<{ templates: TemplateSummary[] }>(
      "GET",
      "/api/v1/templates",
    );
    return r.templates;
  }

  async listMaps(archived: boolean): Promise<MapSummary[]> {
    const r = await this.request<{ maps: MapSummary[] }>(
      "GET",
      `/api/v1/maps${archived ? "?archived=1" : ""}`,
    );
    return r.maps;
  }

  async getMap(id: string): Promise<MapDoc> {
    const r = await this.request<{ map: MapDoc }>("GET", `/api/v1/maps/${id}`);
    return r.map;
  }

  async createMap(title: string, template: string | null): Promise<MapDoc> {
    const r = await this.request<{ map: MapDoc }>("POST", "/api/v1/maps", {
      title: { value: title, dir: "auto" },
      ...(template ? { template } : {}),
    });
    return r.map;
  }

  async renameMap(id: string, title: RichText): Promise<MapDoc> {
    const r = await this.request<{ map: MapDoc }>(
      "PATCH",
      `/api/v1/maps/${id}`,
      { title },
    );
    return r.map;
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.request(
      "POST",
      `/api/v1/maps/${id}/${archived ? "archive" : "unarchive"}`,
    );
  }

  versions(
    id: string,
  ): Promise<{ publishedVersion: number | null; versions: VersionRecord[] }> {
    return this.request("GET", `/api/v1/maps/${id}/versions`);
  }

  rollback(id: string, toVersion: number): Promise<{ version: number }> {
    return this.request("POST", `/api/v1/maps/${id}/rollback`, { toVersion });
  }
}
