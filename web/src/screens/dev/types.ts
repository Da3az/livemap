/**
 * The shape of the state catalogue and of the steps that reach a state.
 *
 * Everything here is plain data (strings, numbers, arrays, objects) so the
 * same catalogue is read by the gallery in the browser and by
 * `scripts/screenshots.mjs` in Node. Only `import type` is allowed in this
 * file and in `catalogue.ts`: Node strips types and never resolves `@/`.
 */
import type { ApiErrorCode } from "@/api/client";
import type { MockMethod } from "@/api/mock/control";

export type ScreenId = "signin" | "workspace" | "editor" | "versions" | "embed" | "dev";
export type Dir = "ltr" | "rtl";
export type Theme = "light" | "dark";
export type Width = 390 | 834 | 1280 | 1440;

/**
 * An element on the page. The fields narrow each other: `role` + `name` is
 * the accessible role and name, `css` a selector, `text` the visible text,
 * `label` an aria-label or <label>. `within` limits the search to inside
 * another target. `exact: false` matches names and text by substring,
 * `prefix: true` by their start.
 * `scrollIn` is a CSS selector of a scrolling (virtualised) container to page
 * through until the element appears. `nth` picks among several matches.
 */
export interface Target {
  role?: string;
  name?: string;
  text?: string;
  css?: string;
  label?: string;
  exact?: boolean;
  /** Match names and text that start with the given words. */
  prefix?: boolean;
  nth?: number;
  within?: Target;
  scrollIn?: string;
}

/** A call on the mock's control object. */
export type MockCall =
  | { fn: "failNext" | "failAlways"; method: MockMethod | "*"; code: ApiErrorCode; reason?: string; retryAfter?: number; status?: number }
  | { fn: "clearFailures"; method?: MockMethod | "*" }
  | { fn: "setLatency"; ms: number | null }
  | { fn: "simulateRemoteEdit"; mapId: string; by?: string }
  | { fn: "expireSession" }
  | { fn: "requireHumanCheck"; required: boolean };

/** Modifier keys held during a click. "Mod" is Ctrl, or Cmd on a Mac. */
export type Modifier = "Mod" | "Shift" | "Alt";

/**
 * One interaction. Every step that names a target waits for it (up to
 * `timeout` ms, default 6000) before acting.
 *
 * - `mapClick` clicks points on the map surface, given as fractions of the
 *   map's box ([0.5, 0.5] is its centre; x runs left to right whatever the direction).
 * - `navigate` changes the route inside the app without reloading it.
 * - `offline` / `online` make `navigator.onLine` say so and fire the event.
 * - `failFetch` makes `fetch` from the page reject for URLs containing `match`.
 * - `loseContext` takes the map's WebGL context away and does not give it back.
 * - `publishDraft` publishes a map's draft from outside the page, as a
 *   colleague would (through the mock server; mockControl has no such switch).
 * - `upload` puts a file into a file input, as if chosen in the picker.
 */
export type Step =
  | { do: "click"; target: Target; double?: boolean; modifiers?: Modifier[]; timeout?: number; optional?: boolean }
  | { do: "fill"; target: Target; value: string; timeout?: number }
  | { do: "press"; keys: string; target?: Target; timeout?: number }
  | { do: "focus"; target: Target; timeout?: number }
  | { do: "hover"; target: Target; timeout?: number }
  | { do: "waitFor"; target: Target; gone?: boolean; timeout?: number }
  | { do: "wait"; ms: number }
  | { do: "mock"; call: MockCall }
  | { do: "mapClick"; points: [number, number][]; double?: boolean; gap?: number }
  | { do: "navigate"; path: string }
  | { do: "offline" }
  | { do: "online" }
  | { do: "failFetch"; match: string }
  | { do: "loseContext" }
  | { do: "publishDraft"; mapId: string }
  | { do: "upload"; target: Target; fileName: string; mime: string; content: string };

/**
 * How to reach one state in one direction.
 *
 * `path` is the route with its query (persona, mock switches). The gallery
 * and the script add `mock-reset=1` (a clean seed) and `fast=1` (no latency)
 * unless `keepLatency` is set, which loading states need.
 */
export interface Recipe {
  path: string;
  steps?: Step[];
  /** Waited for before the steps start; defaults to the page having rendered something. */
  ready?: Target;
  /** Keep the mock's latency (no `fast=1`), for states that show waiting. */
  keepLatency?: boolean;
  /** Extra ms to let the page settle after the steps, before a shot. */
  settle?: number;
  /** A map is drawn in this state: the script waits for its tiles to stop loading. */
  map?: boolean;
}

export interface StateDef {
  id: string;
  title: string;
  /** How the state is reached, in words, for the index. */
  how: string;
  ltr: Recipe;
  /** Only on screens with a direction. */
  rtl?: Recipe;
  /** The widths this state is shot at; all three matrix widths by default. */
  widths?: Width[];
  /** A page that is linked from the gallery, not shot (the kit, the engine harness). */
  linkOnly?: boolean;
  /** Set when the state cannot be reached yet: what hook it needs. Shown in the index; not shot. */
  blocked?: string;
}

export interface ScreenDef {
  id: ScreenId;
  title: string;
  /** The screen follows the map's direction (the editor, the embed). */
  directional: boolean;
  states: StateDef[];
}
