/**
 * Runs a catalogue state's steps inside a page, with plain DOM events.
 *
 * One implementation serves both consumers, so a state reached in the
 * gallery is reached the same way in a screenshot:
 * - the gallery calls `runSteps` on its iframe's window;
 * - `scripts/screenshots.mjs` imports this module into the page it drives
 *   (`import("/src/screens/dev/runner.ts")`) and calls it there.
 *
 * Everything takes the target window explicitly and builds events from that
 * window's own constructors, because `instanceof` and event classes do not
 * cross realms.
 */
import type { MockControl } from "@/api/mock/control";
import type { MockCall, Modifier, Step, Target } from "./types";

export type StepReport =
  | { phase: "running"; index: number; total: number; step: Step }
  | { phase: "done"; total: number }
  | { phase: "failed"; index: number; total: number; step: Step; message: string };

export interface RunOptions {
  /** Resolves to the mock control living in `win` (not in the caller's realm). */
  mock: () => Promise<MockControl>;
  /** Resolves to the mock server living in `win`, for `publishDraft`. */
  server: () => Promise<{ publishMap: (id: string) => unknown }>;
  onReport?: (report: StepReport) => void;
  /** Stops a run that the caller has abandoned. */
  signal?: AbortSignal;
}

type Win = Window & typeof globalThis;

const DEFAULT_TIMEOUT = 6000;
const POLL_MS = 80;

/* ------------------------------------------------------------ roles */

const IMPLICIT_ROLES: [string, string][] = [
  ["button", "button,input[type=button],input[type=submit],input[type=reset],summary"],
  ["link", "a[href],area[href]"],
  ["textbox", "input:not([type]),input[type=text],input[type=email],input[type=url],input[type=tel],input[type=password],textarea"],
  ["searchbox", "input[type=search]"],
  ["checkbox", "input[type=checkbox]"],
  ["radio", "input[type=radio]"],
  ["slider", "input[type=range]"],
  ["spinbutton", "input[type=number]"],
  ["combobox", "select"],
  ["heading", "h1,h2,h3,h4,h5,h6"],
  ["img", "img[alt]"],
  ["list", "ul,ol"],
  ["listitem", "li"],
  ["table", "table"],
  ["row", "tr"],
  ["cell", "td"],
  ["columnheader", "th"],
  ["dialog", "dialog"],
  ["main", "main"],
  ["navigation", "nav"],
  ["complementary", "aside"],
  ["banner", "header"],
  ["form", "form"],
  ["region", "section[aria-label],section[aria-labelledby]"],
];

function roleSelector(role: string): string {
  const implicit = IMPLICIT_ROLES.find(([name]) => name === role)?.[1];
  return implicit ? `[role~="${role}"],${implicit}` : `[role~="${role}"]`;
}

function hasRole(element: Element, role: string): boolean {
  const explicit = element.getAttribute("role");
  if (explicit !== null && explicit.trim() !== "") return explicit.split(/\s+/)[0] === role;
  const implicit = IMPLICIT_ROLES.find(([name]) => name === role)?.[1];
  return implicit ? element.matches(implicit) : false;
}

/* ------------------------------------------------------------- names */

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textOf(element: Element): string {
  return squash(element.textContent ?? "");
}

/** A simplified accessible name: aria-labelledby, aria-label, a <label>, alt/title/placeholder, then the text. */
export function accessibleName(element: Element): string {
  const doc = element.ownerDocument;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)).filter((node): node is HTMLElement => node !== null);
    const text = squash(parts.map((part) => part.textContent ?? "").join(" "));
    if (text !== "") return text;
  }
  const label = element.getAttribute("aria-label");
  if (label && label.trim() !== "") return squash(label);
  if ("labels" in element) {
    const labels = (element as HTMLInputElement).labels;
    if (labels && labels.length > 0) return squash([...labels].map((node) => node.textContent ?? "").join(" "));
  }
  for (const attribute of ["alt", "title", "placeholder"]) {
    const value = element.getAttribute(attribute);
    if (value && value.trim() !== "" && !(attribute === "title" && textOf(element) !== "")) return squash(value);
  }
  return textOf(element);
}

function visible(element: Element): boolean {
  if (element.getClientRects().length === 0) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  return style ? style.visibility !== "hidden" && style.visibility !== "collapse" : true;
}

type TextMatch = "exact" | "contains" | "prefix";

function matchesText(actual: string, wanted: string, how: TextMatch): boolean {
  const want = squash(wanted);
  if (how === "exact") return actual === want;
  if (how === "prefix") return actual.startsWith(want);
  return actual.toLowerCase().includes(want.toLowerCase());
}

function candidates(scope: ParentNode, target: Target): Element[] {
  if (target.css) return [...scope.querySelectorAll(target.css)];
  if (target.role) return [...scope.querySelectorAll(roleSelector(target.role))].filter((el) => hasRole(el, target.role ?? ""));
  if (target.label) return [...scope.querySelectorAll("[aria-label],input,textarea,select,[aria-labelledby]")];
  return [...scope.querySelectorAll("*")];
}

/** Every visible element in `doc` that `target` describes, in document order. */
export function resolveAll(doc: Document, target: Target): Element[] {
  const scopes: ParentNode[] = target.within ? resolveAll(doc, target.within) : [doc];
  const exact: TextMatch = target.prefix ? "prefix" : (target.exact ?? true) ? "exact" : "contains";
  const found = new Set<Element>();
  for (const scope of scopes) {
    for (const element of candidates(scope, target)) {
      if (!visible(element)) continue;
      if (target.role && target.css && !hasRole(element, target.role)) continue;
      if (target.name !== undefined && !matchesText(accessibleName(element), target.name, exact)) continue;
      if (target.label !== undefined && !matchesText(accessibleName(element), target.label, exact)) continue;
      if (target.text !== undefined) {
        if (!matchesText(textOf(element), target.text, exact)) continue;
        /* The innermost element carrying the text, not every ancestor of it. */
        const child = [...element.children].some((node) => visible(node) && matchesText(textOf(node), target.text ?? "", exact));
        if (child) continue;
      }
      found.add(element);
    }
  }
  return [...found];
}

export function describeTarget(target: Target): string {
  const parts: string[] = [];
  if (target.role) parts.push(target.role);
  if (target.name !== undefined) parts.push(`"${target.name}"`);
  if (target.label !== undefined) parts.push(`label "${target.label}"`);
  if (target.text !== undefined) parts.push(`text "${target.text}"`);
  if (target.css) parts.push(target.css);
  if (target.nth !== undefined) parts.push(`#${target.nth}`);
  const own = parts.join(" ");
  return target.within ? `${own} in ${describeTarget(target.within)}` : own;
}

export function describeStep(step: Step): string {
  switch (step.do) {
    case "click":
      return `${step.double ? "double-click" : "click"}${step.modifiers?.length ? ` ${step.modifiers.join("+")}+` : ""} ${describeTarget(step.target)}${step.optional ? " if it is there" : ""}`;
    case "fill":
      return `fill ${describeTarget(step.target)} with "${step.value}"`;
    case "press":
      return `press ${step.keys}${step.target ? ` on ${describeTarget(step.target)}` : ""}`;
    case "focus":
    case "hover":
      return `${step.do} ${describeTarget(step.target)}`;
    case "waitFor":
      return `wait for ${describeTarget(step.target)}${step.gone ? " to go" : ""}`;
    case "wait":
      return `wait ${step.ms} ms`;
    case "mock":
      return `mock.${describeMock(step.call)}`;
    case "mapClick":
      return `${step.double ? "double-click" : "click"} map at ${step.points.map(([x, y]) => `${x},${y}`).join(" ")}`;
    case "navigate":
      return `go to ${step.path}`;
    case "offline":
    case "online":
    case "loseContext":
      return step.do;
    case "publishDraft":
      return `a colleague publishes ${step.mapId}`;
    case "failFetch":
      return `fail fetch of *${step.match}*`;
    case "upload":
      return `upload ${step.fileName} to ${describeTarget(step.target)}`;
  }
}

function describeMock(call: MockCall): string {
  switch (call.fn) {
    case "failNext":
    case "failAlways":
      return `${call.fn}(${call.method}, ${call.code})`;
    case "clearFailures":
      return `clearFailures(${call.method ?? ""})`;
    case "setLatency":
      return `setLatency(${call.ms})`;
    case "simulateRemoteEdit":
      return `simulateRemoteEdit(${call.mapId})`;
    case "expireSession":
      return "expireSession()";
    case "requireHumanCheck":
      return `requireHumanCheck(${call.required})`;
  }
}

/* ------------------------------------------------------------ waiting */

function sleep(win: Win, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("stopped"));
      return;
    }
    const timer = win.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        win.clearTimeout(timer);
        reject(new Error("stopped"));
      },
      { once: true },
    );
  });
}

function scrollContainerStep(doc: Document, css: string): boolean {
  const container = doc.querySelector(css);
  if (!container) return false;
  const before = container.scrollTop;
  container.scrollTop = before + Math.max(80, container.clientHeight * 0.8);
  return container.scrollTop !== before;
}

/** Waits for `target` and returns it, paging through `scrollIn` if it is virtualised away. */
type Found = Element & HTMLOrSVGElement;

export async function find(win: Win, target: Target, timeout = DEFAULT_TIMEOUT, signal?: AbortSignal): Promise<Found> {
  const until = Date.now() + timeout;
  let scrolledToTop = false;
  for (;;) {
    const all = resolveAll(win.document, target);
    const element = all[target.nth ?? 0];
    if (element && (element instanceof win.HTMLElement || element instanceof win.SVGElement)) {
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      return element;
    }
    if (target.scrollIn) {
      const container = win.document.querySelector(target.scrollIn);
      if (container && !scrolledToTop) {
        container.scrollTop = 0;
        scrolledToTop = true;
      } else if (container && !scrollContainerStep(win.document, target.scrollIn)) {
        container.scrollTop = 0;
      }
    }
    if (Date.now() > until) throw new Error(`not found: ${describeTarget(target)}`);
    await sleep(win, POLL_MS, signal);
  }
}

async function waitGone(win: Win, target: Target, timeout: number, signal?: AbortSignal): Promise<void> {
  const until = Date.now() + timeout;
  while (resolveAll(win.document, target).length > 0) {
    if (Date.now() > until) throw new Error(`still there: ${describeTarget(target)}`);
    await sleep(win, POLL_MS, signal);
  }
}

/* ------------------------------------------------------------- input */

function isMac(win: Win): boolean {
  return /Mac|iPhone|iPad/.test(win.navigator.platform);
}

function modifierState(win: Win, modifiers: Modifier[] = []) {
  const mod = modifiers.includes("Mod");
  return {
    ctrlKey: mod && !isMac(win),
    metaKey: mod && isMac(win),
    shiftKey: modifiers.includes("Shift"),
    altKey: modifiers.includes("Alt"),
  };
}

function centre(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function pointerAt(win: Win, x: number, y: number, fallback: Element, modifiers: Modifier[], detail: number): void {
  const hit = win.document.elementFromPoint(x, y);
  /* What a real pointer would land on, unless something else covers the target. */
  const element = hit && fallback.contains(hit) ? hit : fallback;
  const keys = modifierState(win, modifiers);
  const pointer = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true, width: 1, height: 1, view: win, ...keys };
  element.dispatchEvent(new win.PointerEvent("pointerover", pointer));
  element.dispatchEvent(new win.PointerEvent("pointermove", { ...pointer, buttons: 0 }));
  element.dispatchEvent(new win.PointerEvent("pointerdown", { ...pointer, buttons: 1, pressure: 0.5, detail }));
  element.dispatchEvent(new win.MouseEvent("mousedown", { ...pointer, buttons: 1, detail }));
  const focusable = element.closest<HTMLElement>("button,a[href],input,textarea,select,[tabindex]");
  if (focusable && win.document.activeElement !== focusable) focusable.focus({ preventScroll: true });
  element.dispatchEvent(new win.PointerEvent("pointerup", { ...pointer, buttons: 0, pressure: 0, detail }));
  element.dispatchEvent(new win.MouseEvent("mouseup", { ...pointer, buttons: 0, detail }));
  element.dispatchEvent(new win.MouseEvent("click", { ...pointer, buttons: 0, detail }));
  if (detail === 2) element.dispatchEvent(new win.MouseEvent("dblclick", { ...pointer, buttons: 0, detail }));
}

function clickElement(win: Win, element: Element, modifiers: Modifier[] = [], double = false): void {
  const { x, y } = centre(element);
  pointerAt(win, x, y, element, modifiers, 1);
  if (double) pointerAt(win, x, y, element, modifiers, 2);
}

const CODES: Record<string, string> = {
  Enter: "Enter",
  Escape: "Escape",
  Delete: "Delete",
  Backspace: "Backspace",
  Tab: "Tab",
  Space: "Space",
  " ": "Space",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  "/": "Slash",
  "?": "Slash",
  ",": "Comma",
  ".": "Period",
  "[": "BracketLeft",
  "]": "BracketRight",
};

/** "Mod+Shift+Z" → a keydown/keyup pair with the code a US keyboard would send. */
function pressKeys(win: Win, keys: string, on: Element | null): void {
  const parts = keys.split("+");
  const key = parts[parts.length - 1] ?? "";
  const modifiers = parts.slice(0, -1).filter((part): part is Modifier => part === "Mod" || part === "Shift" || part === "Alt");
  const state = modifierState(win, modifiers);
  let code = CODES[key];
  let typed = key === "Space" ? " " : key;
  if (code === undefined && /^[a-z]$/i.test(key)) code = `Key${key.toUpperCase()}`;
  if (code === undefined && /^[0-9]$/.test(key)) code = `Digit${key}`;
  if (/^[a-z]$/i.test(key)) typed = state.shiftKey ? key.toUpperCase() : key.toLowerCase();
  if (key === "/" && state.shiftKey) typed = "?";
  const target = on ?? win.document.activeElement ?? win.document.body;
  const init = { bubbles: true, cancelable: true, composed: true, key: typed, code: code ?? key, view: win, ...state };
  const down = new win.KeyboardEvent("keydown", init);
  const allowed = target.dispatchEvent(down);
  /* A synthetic Enter does not submit a form on its own; do what the browser would. */
  if (allowed && key === "Enter" && target instanceof win.HTMLInputElement && target.form) target.form.requestSubmit();
  target.dispatchEvent(new win.KeyboardEvent("keyup", init));
}

function setValue(win: Win, element: Found, value: string): void {
  element.focus();
  const proto = element instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (element instanceof win.HTMLInputElement || element instanceof win.HTMLTextAreaElement) {
    setter?.call(element, value);
    element.dispatchEvent(new win.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    element.dispatchEvent(new win.Event("change", { bubbles: true }));
    return;
  }
  if (element instanceof win.HTMLElement && element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new win.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    return;
  }
  throw new Error("not a text field");
}

/** The element that carries a MapLibre map's pointer input. */
function mapSurface(win: Win): HTMLElement {
  const surface = win.document.querySelector<HTMLElement>(".maplibregl-canvas-container");
  if (!surface) throw new Error("no map on the page");
  return surface;
}

async function clickMap(win: Win, points: [number, number][], double: boolean, gap: number, signal?: AbortSignal): Promise<void> {
  const surface = mapSurface(win);
  const box = (surface.closest(".maplibregl-map") ?? surface).getBoundingClientRect();
  for (const [index, [fx, fy]] of points.entries()) {
    const x = box.left + box.width * fx;
    const y = box.top + box.height * fy;
    const last = index === points.length - 1;
    pointerAt(win, x, y, surface, [], 1);
    if (double && last) {
      await sleep(win, 60, signal);
      pointerAt(win, x, y, surface, [], 2);
    }
    /* Hover where the pointer is, so a drawing tool shows its rubber band. */
    surface.dispatchEvent(new win.PointerEvent("pointermove", { bubbles: true, clientX: x + 1, clientY: y + 1, pointerType: "mouse", pointerId: 1 }));
    await sleep(win, gap, signal);
  }
}

function fakeOnline(win: Win, online: boolean): void {
  Object.defineProperty(win.navigator, "onLine", { configurable: true, get: () => online });
  win.dispatchEvent(new win.Event(online ? "online" : "offline"));
}

function failFetch(win: Win, match: string): void {
  const original = win.fetch.bind(win);
  win.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes(match)) return Promise.reject(new TypeError(`Failed to fetch (blocked by the gallery: ${match})`));
    return original(input, init);
  };
}

function loseContext(win: Win): void {
  const canvas = win.document.querySelector<HTMLCanvasElement>("canvas.maplibregl-canvas");
  const lose = canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context");
  if (!lose) throw new Error("no WebGL map canvas");
  lose.loseContext();
}

function upload(win: Win, input: Found, fileName: string, mime: string, content: string): void {
  if (!(input instanceof win.HTMLInputElement) || input.type !== "file") throw new Error("not a file input");
  const transfer = new win.DataTransfer();
  transfer.items.add(new win.File([content], fileName, { type: mime }));
  input.files = transfer.files;
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  input.dispatchEvent(new win.Event("change", { bubbles: true }));
}

/** Navigates inside the single-page app: the router listens for popstate. */
function navigate(win: Win, path: string): void {
  win.history.pushState({ usr: null, key: Math.random().toString(36).slice(2), idx: (win.history.length ?? 0) + 1 }, "", path);
  win.dispatchEvent(new win.PopStateEvent("popstate", { state: win.history.state }));
}

async function callMock(control: MockControl, call: MockCall): Promise<void> {
  switch (call.fn) {
    case "failNext":
    case "failAlways": {
      const overrides = {
        ...(call.reason !== undefined ? { reason: call.reason } : {}),
        ...(call.retryAfter !== undefined ? { retryAfter: call.retryAfter } : {}),
        ...(call.status !== undefined ? { status: call.status } : {}),
      };
      control[call.fn](call.method, call.code, overrides);
      return;
    }
    case "clearFailures":
      control.clearFailures(call.method);
      return;
    case "setLatency":
      control.setLatency(call.ms);
      return;
    case "simulateRemoteEdit":
      if (!control.simulateRemoteEdit(call.mapId, call.by)) throw new Error(`no map ${call.mapId}`);
      return;
    case "expireSession":
      control.expireSession();
      return;
    case "requireHumanCheck":
      control.requireHumanCheck(call.required);
      return;
  }
}

async function runStep(win: Win, step: Step, options: RunOptions): Promise<void> {
  const { signal } = options;
  switch (step.do) {
    case "click": {
      if (step.optional && resolveAll(win.document, step.target).length === 0) {
        await sleep(win, step.timeout ?? 400, signal);
        if (resolveAll(win.document, step.target).length === 0) return;
      }
      const element = await find(win, step.target, step.timeout, signal);
      clickElement(win, element, step.modifiers, step.double);
      return;
    }
    case "fill":
      setValue(win, await find(win, step.target, step.timeout, signal), step.value);
      return;
    case "press":
      pressKeys(win, step.keys, step.target ? await find(win, step.target, step.timeout, signal) : null);
      return;
    case "focus":
      (await find(win, step.target, step.timeout, signal)).focus();
      return;
    case "hover": {
      const element = await find(win, step.target, step.timeout, signal);
      const { x, y } = centre(element);
      const init = { bubbles: true, clientX: x, clientY: y, pointerType: "mouse", pointerId: 1, view: win };
      element.dispatchEvent(new win.PointerEvent("pointerover", init));
      element.dispatchEvent(new win.PointerEvent("pointerenter", { ...init, bubbles: false }));
      element.dispatchEvent(new win.MouseEvent("mouseover", init));
      element.dispatchEvent(new win.PointerEvent("pointermove", init));
      element.dispatchEvent(new win.MouseEvent("mousemove", init));
      return;
    }
    case "waitFor":
      if (step.gone) await waitGone(win, step.target, step.timeout ?? DEFAULT_TIMEOUT, signal);
      else await find(win, step.target, step.timeout, signal);
      return;
    case "wait":
      await sleep(win, step.ms, signal);
      return;
    case "mock":
      await callMock(await options.mock(), step.call);
      return;
    case "mapClick":
      await clickMap(win, step.points, step.double ?? false, step.gap ?? 120, signal);
      return;
    case "navigate":
      navigate(win, step.path);
      return;
    case "offline":
      fakeOnline(win, false);
      return;
    case "online":
      fakeOnline(win, true);
      return;
    case "failFetch":
      failFetch(win, step.match);
      return;
    case "loseContext":
      loseContext(win);
      return;
    case "publishDraft":
      (await options.server()).publishMap(step.mapId);
      return;
    case "upload":
      upload(win, await find(win, step.target, DEFAULT_TIMEOUT, signal), step.fileName, step.mime, step.content);
      return;
  }
}

/** Runs `steps` in order, reporting each. Resolves with the failure report, or `done`. */
export async function runSteps(win: Window, steps: readonly Step[], options: RunOptions): Promise<StepReport> {
  const realm = win as Win;
  const total = steps.length;
  for (const [index, step] of steps.entries()) {
    options.onReport?.({ phase: "running", index, total, step });
    try {
      await runStep(realm, step, options);
      /* Let React commit what the step caused before the next one looks for its result. */
      await sleep(realm, 60, options.signal);
    } catch (error) {
      const report: StepReport = { phase: "failed", index, total, step, message: error instanceof Error ? error.message : String(error) };
      options.onReport?.(report);
      return report;
    }
  }
  const report: StepReport = { phase: "done", total };
  options.onReport?.(report);
  return report;
}

/** Waits for the page to have rendered something and, when given, for `ready`. */
export async function waitForPage(win: Window, ready: Target | undefined, timeout = 15_000): Promise<void> {
  const realm = win as Win;
  const until = Date.now() + timeout;
  while ((realm.document.getElementById("root")?.childElementCount ?? 0) === 0) {
    if (Date.now() > until) throw new Error("the page rendered nothing");
    await sleep(realm, POLL_MS);
  }
  if (ready) await find(realm, ready, Math.max(1000, until - Date.now()));
  await realm.document.fonts.ready;
}
