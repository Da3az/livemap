/**
 * The in-memory `ApiClient`. It wraps the rule-enforcing server in `server.ts`
 * with what a network adds: a wait, the failures forced through `mockControl`,
 * and results the caller cannot use to reach into the server's state.
 *
 * The dev switches (`mockControl`, the `?mock=` and `?persona=` URL
 * parameters, the sign-in tokens) are documented at the top of `control.ts`.
 */
import type { ApiClient } from "@/api/client";
import { type MockMethod, mockControl, nextLatency, takeFailure } from "./control";
import { apiError } from "./errors";
import { currentOf } from "./personas";
import { server } from "./server";
import { getWorld } from "./world";

export { type FailureOverrides, type ForcedFailure, MOCK_METHODS, MOCK_PERSONAS, type MockControl, type MockMethod, mockControl } from "./control";
export { PLACE_COUNT } from "./gazetteer";
export { PEOPLE } from "./seed";
export { MOCK_TOKENS, ROLE_CAPABILITIES } from "./server";
export { GUEST_LIMITS, MEMBER_LIMITS, type PersonaId } from "./world";

/** Calls a rate-limited client can still make: the ones that say who it is. */
const NEVER_THROTTLED: MockMethod[] = ["getConfig", "getSession", "signOut", "signInAsGuest", "signInWithToken"];

function wait(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/** Everything that happens to a call before the server sees it. */
async function arrive(method: MockMethod, mapId?: string): Promise<void> {
  await wait(nextLatency());
  const failure = takeFailure(method);
  if (failure) {
    throw apiError(failure.code, {
      ...(failure.reason !== undefined ? { reason: failure.reason } : {}),
      ...(failure.retryAfter !== undefined ? { retryAfter: failure.retryAfter } : {}),
      ...(failure.status !== undefined ? { status: failure.status } : {}),
      ...(failure.code === "stale_revision" ? { current: currentOf(mapId) } : {}),
    });
  }
  if (getWorld().switches.rateLimited && !NEVER_THROTTLED.includes(method)) throw apiError("rate_limited");
}

export function createMockApiClient(): ApiClient {
  if (typeof window !== "undefined") mockControl.applyUrl(window.location.search);

  return {
    async getConfig() {
      await arrive("getConfig");
      return structuredClone(server.getConfig());
    },
    async signInAsGuest(input) {
      await arrive("signInAsGuest");
      return structuredClone(server.signInAsGuest(input));
    },
    async signInWithToken(token) {
      await arrive("signInWithToken");
      return structuredClone(server.signInWithToken(token));
    },
    async signOut() {
      await arrive("signOut");
      server.signOut();
    },
    async getSession() {
      await arrive("getSession");
      return structuredClone(server.getSession());
    },
    async listTemplates() {
      await arrive("listTemplates");
      return structuredClone(server.listTemplates());
    },
    async listMaps(input) {
      await arrive("listMaps");
      return structuredClone(server.listMaps(input));
    },
    async createMap(input) {
      await arrive("createMap");
      return structuredClone(server.createMap(input));
    },
    async getMap(id) {
      await arrive("getMap", id);
      return structuredClone(server.getMap(id));
    },
    async archiveMap(id) {
      await arrive("archiveMap", id);
      server.archiveMap(id);
    },
    async unarchiveMap(id) {
      await arrive("unarchiveMap", id);
      server.unarchiveMap(id);
    },
    async editMap(id, edit) {
      await arrive("editMap", id);
      return server.editMap(id, structuredClone(edit));
    },
    async publishMap(id) {
      await arrive("publishMap", id);
      return server.publishMap(id);
    },
    async listVersions(id) {
      await arrive("listVersions", id);
      return structuredClone(server.listVersions(id));
    },
    async getVersion(id, version) {
      await arrive("getVersion", id);
      return structuredClone(server.getVersion(id, version));
    },
    async rollbackMap(id, input) {
      await arrive("rollbackMap", id);
      return server.rollbackMap(id, input);
    },
    async getPublished(tenantSlug, mapSlug) {
      await arrive("getPublished");
      return structuredClone(server.getPublished(tenantSlug, mapSlug));
    },
    async getPublishedPointer(tenantSlug, mapSlug, input) {
      await arrive("getPublishedPointer");
      return structuredClone(server.getPublishedPointer(tenantSlug, mapSlug, input));
    },
    async getPublishedVersion(tenantSlug, mapSlug, version) {
      await arrive("getPublishedVersion");
      return structuredClone(server.getPublishedVersion(tenantSlug, mapSlug, version));
    },
    async searchPlaces(query, input) {
      await arrive("searchPlaces");
      return server.searchPlaces(query, input);
    },
  };
}
