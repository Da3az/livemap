/**
 * The mock's dev-only switchboard: force errors, change latency, switch who
 * is signed in, and reset the data. Nothing here exists on a real server.
 *
 * FROM CODE
 *
 *   import { mockControl } from "@/api/mock";
 *
 *   mockControl.failNext("editMap", "stale_revision");     // the next editMap only
 *   mockControl.failAlways("listMaps", "rate_limited");    // every listMaps until cleared
 *   mockControl.failAlways("*", "network");                // every method
 *   mockControl.failNext("publishMap", "quota_exceeded", { reason: "…", retryAfter: 10, status: 403 });
 *   mockControl.clearFailures();                            // or clearFailures("listMaps")
 *   mockControl.setLatency(1500);                           // fixed ms; null restores 150–400 ms
 *   mockControl.setPersona("viewer");
 *   mockControl.simulateRemoteEdit(mapId);                  // a colleague saves: your next save is a real 409
 *   mockControl.expireSession();                            // the next call answers 401
 *   mockControl.requireHumanCheck(true);                    // guest signup needs a token; "fail" is refused
 *   mockControl.reset();                                    // back to the seed, signed out
 *   mockControl.subscribe(() => queryClient.invalidateQueries());
 *
 * FROM THE URL (read once, when the client is created)
 *
 *   ?mock=<method>:<code>[:once][,<method>:<code>[:once]…]
 *       <method>  any ApiClient method name, or * for all of them
 *       <code>    any ApiErrorCode
 *       :once     fail only the next call; without it, every call fails
 *     e.g. /maps?mock=listMaps:rate_limited
 *          /maps/m_shaheen?mock=editMap:stale_revision:once,publishMap:quota_exceeded
 *
 *   ?persona=<persona>
 *       signed-out      nobody signed in
 *       owner           Layla Haddad, owner of Al Mashriq Newsroom
 *       admin           Sarah Whitfield
 *       editor          عمر الفارسي: can publish, cannot archive
 *       contributor     يوسف بن عمر: can edit only the maps he created, cannot publish
 *       viewer          Hannah Lindqvist: read-only
 *       guest           a new, empty guest workspace
 *       guest-full      a guest workspace already holding its 5 maps
 *       guest-expired   a guest whose session has run out (the first call answers 401)
 *       guest-disabled  signed out, and the server has guest signup switched off
 *       guest-capacity  signed out, and starting a guest workspace answers 503
 *       rate-limited    the owner, with every data call answering 429
 *     A persona is applied once: reloading the same URL keeps the workspace it made.
 *
 *   ?latency=<ms>     fixed latency for every call
 *   ?fast=1           no latency at all (for screenshots)
 *   ?humancheck=1     guest signup asks for the human check (the stand-in widget);
 *                     humancheck=0 switches it off again. Same as requireHumanCheck().
 *   ?mock-reset=1     discard this tab's stored data and start from the seed
 *
 * Parameters combine: /maps?persona=guest-full&fast=1&mock=createMap:quota_exceeded
 *
 * SIGNING IN BY TOKEN
 *
 *   mock-owner, mock-admin, mock-editor, mock-contributor, mock-viewer
 *   (exported as MOCK_TOKENS). Anything else is refused with 401.
 */
import type { ApiClient, ApiErrorCode } from "@/api/client";
import { ERROR_CODES, isErrorCode } from "./errors";
import { applyPersona, expireSession, simulateRemoteEdit } from "./personas";
import { getWorld, type PersonaId, resetWorld, saveMeta } from "./world";

export type MockMethod = keyof ApiClient;

export const MOCK_METHODS: MockMethod[] = [
  "getConfig",
  "signInAsGuest",
  "signInWithToken",
  "signOut",
  "getSession",
  "listTemplates",
  "listMaps",
  "createMap",
  "getMap",
  "archiveMap",
  "unarchiveMap",
  "editMap",
  "publishMap",
  "listVersions",
  "getVersion",
  "rollbackMap",
  "getPublished",
  "getPublishedPointer",
  "getPublishedVersion",
  "searchPlaces",
];

export const MOCK_PERSONAS: PersonaId[] = [
  "signed-out",
  "owner",
  "admin",
  "editor",
  "contributor",
  "viewer",
  "guest",
  "guest-full",
  "guest-expired",
  "guest-disabled",
  "guest-capacity",
  "rate-limited",
];

export interface FailureOverrides {
  /** The sentence the server sends with the refusal. */
  reason?: string;
  /** Seconds. */
  retryAfter?: number;
  status?: number;
}

export interface ForcedFailure extends FailureOverrides {
  code: ApiErrorCode;
  once: boolean;
}

type Target = MockMethod | "*";

const DEFAULT_LATENCY: [number, number] = [150, 400];

const failures = new Map<Target, ForcedFailure>();
const listeners = new Set<() => void>();
let fixedLatency: number | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function isMethod(value: string): value is MockMethod {
  return MOCK_METHODS.some((method) => method === value);
}

function isPersona(value: string): value is PersonaId {
  return MOCK_PERSONAS.some((persona) => persona === value);
}

export interface MockControl {
  readonly methods: readonly MockMethod[];
  readonly personas: readonly PersonaId[];
  readonly errorCodes: readonly ApiErrorCode[];

  /** Fail the next call of `method` (or of any method, with "*"), then behave again. */
  failNext(method: Target, code: ApiErrorCode, overrides?: FailureOverrides): void;
  /** Fail every call of `method` until `clearFailures`. */
  failAlways(method: Target, code: ApiErrorCode, overrides?: FailureOverrides): void;
  clearFailures(method?: Target): void;
  /** The failures in force, for a dev panel to show. */
  getFailures(): { method: Target; failure: ForcedFailure }[];

  /** Fixed latency in ms, or null for the default 150–400 ms. */
  setLatency(ms: number | null): void;
  getLatency(): number | null;

  setPersona(persona: PersonaId): void;
  /** The persona last applied, or null after a real sign-in or sign-out. */
  getPersona(): PersonaId | null;

  /** Bump a map's revision as if a colleague had saved. False when the map does not exist. */
  simulateRemoteEdit(mapId: string, by?: string): boolean;
  expireSession(): void;
  requireHumanCheck(required: boolean): void;

  /** Discard stored data and return to the seed, signed out, with no forced failures. */
  reset(): void;

  /** Apply `?mock=`, `?persona=`, `?latency=`, `?fast=1`, `?humancheck=` and `?mock-reset=1`. Returns what it could not understand. */
  applyUrl(search: string): string[];

  /** Called after anything above changes what the API would answer. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export const mockControl: MockControl = {
  methods: MOCK_METHODS,
  personas: MOCK_PERSONAS,
  errorCodes: ERROR_CODES,

  failNext(method, code, overrides = {}) {
    failures.set(method, { ...overrides, code, once: true });
    notify();
  },

  failAlways(method, code, overrides = {}) {
    failures.set(method, { ...overrides, code, once: false });
    notify();
  },

  clearFailures(method) {
    if (method) failures.delete(method);
    else failures.clear();
    notify();
  },

  getFailures() {
    return [...failures.entries()].map(([method, failure]) => ({ method, failure }));
  },

  setLatency(ms) {
    fixedLatency = ms === null ? null : Math.max(0, ms);
  },

  getLatency() {
    return fixedLatency;
  },

  setPersona(persona) {
    applyPersona(persona);
    notify();
  },

  getPersona() {
    return getWorld().persona;
  },

  simulateRemoteEdit(mapId, by) {
    return simulateRemoteEdit(mapId, by);
  },

  expireSession() {
    expireSession();
    notify();
  },

  requireHumanCheck(required) {
    getWorld().switches.humanCheck = required;
    saveMeta();
    notify();
  },

  reset() {
    failures.clear();
    resetWorld();
    notify();
  },

  applyUrl(search) {
    const params = new URLSearchParams(search);
    const problems: string[] = [];

    if (params.get("mock-reset") === "1") {
      failures.clear();
      resetWorld();
    }

    if (params.get("fast") === "1") fixedLatency = 0;
    const humanCheck = params.get("humancheck");
    if (humanCheck === "1" || humanCheck === "0") {
      getWorld().switches.humanCheck = humanCheck === "1";
      saveMeta();
    } else if (humanCheck !== null) problems.push(`humancheck: "${humanCheck}" should be 1 or 0`);
    const latency = params.get("latency");
    if (latency !== null) {
      const ms = Number(latency);
      if (Number.isFinite(ms) && ms >= 0) fixedLatency = ms;
      else problems.push(`latency: "${latency}" is not a number of milliseconds`);
    }

    for (const part of (params.get("mock") ?? "").split(",")) {
      const text = part.trim();
      if (text.length === 0) continue;
      const [method = "", code = "", flag] = text.split(":");
      if (method !== "*" && !isMethod(method)) problems.push(`mock: "${method}" is not an ApiClient method`);
      else if (!isErrorCode(code)) problems.push(`mock: "${code}" is not an ApiErrorCode`);
      else if (flag !== undefined && flag !== "once") problems.push(`mock: "${flag}" should be "once" or left out`);
      else failures.set(method, { code, once: flag === "once" });
    }

    const persona = params.get("persona");
    if (persona !== null) {
      if (!isPersona(persona)) problems.push(`persona: "${persona}" is not one of ${MOCK_PERSONAS.join(", ")}`);
      else if (getWorld().persona !== persona) applyPersona(persona);
    }

    notify();
    return problems;
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The failure to raise for this call, if one is set; a one-shot is used up. */
export function takeFailure(method: MockMethod): ForcedFailure | null {
  for (const target of [method, "*"] as const) {
    const failure = failures.get(target);
    if (failure) {
      if (failure.once) failures.delete(target);
      return failure;
    }
  }
  return null;
}

/** How long this call should take, in ms. */
export function nextLatency(): number {
  if (fixedLatency !== null) return fixedLatency;
  const [min, max] = DEFAULT_LATENCY;
  return Math.round(min + Math.random() * (max - min));
}
