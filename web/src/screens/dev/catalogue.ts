/**
 * Every screen in every state, and how to reach each one.
 *
 * Read by the gallery (`/dev/states`) and by `scripts/screenshots.mjs`,
 * which imports this file directly under Node's type stripping. So: plain
 * data and plain functions only, and `import type` for everything else.
 *
 * Paths carry the mock's URL switches (see the top of
 * `src/api/mock/control.ts`): `persona=`, `mock=<method>:<code>[:once]`,
 * `latency=`, `humancheck=`. `stateUrl()` adds `mock-reset=1` and `fast=1`.
 */
import type { Dir, Recipe, ScreenDef, StateDef, Step, Target, Width } from "./types";

export const WIDTHS: Width[] = [1440, 1280, 834, 390];
/** The sizes the screenshot matrix shoots. 1280 is offered in the gallery only. */
export const MATRIX_WIDTHS: Width[] = [1440, 834, 390];
export const HEIGHTS: Record<Width, number> = { 390: 844, 834: 1112, 1280: 800, 1440: 900 };

/** Long enough that a loading state is still loading when it is looked at. */
const FOREVER = 600_000;

/** The route with the switches every state starts from: a clean seed, and no latency unless asked. */
export function stateUrl(recipe: Recipe): string {
  const [path = "/", query = ""] = recipe.path.split("?");
  const params = new URLSearchParams(query);
  params.set("mock-reset", "1");
  if (!recipe.keepLatency && !params.has("latency")) params.set("fast", "1");
  return `${path}?${params.toString()}`;
}

/* ------------------------------------------------------------ helpers */

const click = (target: Target, extra: Partial<Extract<Step, { do: "click" }>> = {}): Step => ({ do: "click", target, ...extra });
const press = (keys: string): Step => ({ do: "press", keys });
const fill = (target: Target, value: string): Step => ({ do: "fill", target, value });
const waitFor = (target: Target, timeout?: number): Step => ({ do: "waitFor", target, ...(timeout ? { timeout } : {}) });
const wait = (ms: number): Step => ({ do: "wait", ms });
const button = (name: string, exact = true): Target => ({ role: "button", name, exact });
const radio = (name: string, exact = true): Target => ({ role: "radio", name, exact });
/** A button whose name starts with `name`, such as "Features 62". */
const startsWith = (name: string): Target => ({ role: "button", name, prefix: true });
const link = (name: string, exact = true): Target => ({ role: "link", name, exact });

/** One state with the same recipe shape in both directions. */
function both(id: string, title: string, how: string, make: (f: EditorFixture) => Recipe, widths?: Width[]): StateDef {
  return { id, title, how, ltr: make(EDITOR.ltr), rtl: make(EDITOR.rtl), ...(widths ? { widths } : {}) };
}

/* ------------------------------------------------------------- sign-in */

const SIGNIN_STATES: StateDef[] = [
  { id: "default", title: "Default", how: "Signed out, guest signup on.", ltr: { path: "/", map: true } },
  {
    id: "loading",
    title: "Loading config and session",
    how: "Every call takes ten minutes, so the config and session are still on their way.",
    ltr: { path: `/?latency=${FOREVER}`, keepLatency: true },
  },
  {
    id: "signing-in",
    title: "Signing in",
    how: "Token typed, then the mock's latency raised before pressing Sign in.",
    ltr: {
      path: "/",
      steps: [
        fill({ role: "textbox", name: "Session token" }, "mock-owner"),
        { do: "mock", call: { fn: "setLatency", ms: FOREVER } },
        click(button("Sign in")),
        waitFor(button("Signing in…")),
      ],
    },
  },
  {
    id: "token-rejected",
    title: "Token rejected",
    how: "A token the mock does not know, then Sign in.",
    ltr: { path: "/", steps: [fill({ role: "textbox", name: "Session token" }, "lm_live_8f2c41d07a"), click(button("Sign in")), waitFor({ text: "That token was not accepted" })] },
  },
  {
    id: "token-empty",
    title: "Token missing",
    how: "Sign in pressed with the field empty.",
    ltr: { path: "/", steps: [click(button("Sign in")), waitFor({ text: "Paste the token first." })] },
  },
  {
    id: "guest-capacity",
    title: "Guest capacity full",
    how: "persona=guest-capacity: starting a guest workspace answers 503.",
    ltr: { path: "/?persona=guest-capacity", steps: [click(button("Continue as guest")), waitFor({ text: "Every guest workspace is in use" })] },
  },
  {
    id: "rate-limited",
    title: "Rate limited",
    how: "signInAsGuest answers 429.",
    ltr: { path: "/?mock=signInAsGuest:rate_limited", steps: [click(button("Continue as guest")), waitFor({ text: "Too many attempts from this address" })] },
  },
  {
    id: "guest-disabled",
    title: "Guest signup disabled",
    how: "persona=guest-disabled: the server has guest workspaces switched off.",
    ltr: { path: "/?persona=guest-disabled" },
  },
  {
    id: "human-check",
    title: "Human check",
    how: "humancheck=1: guest signup asks for the check.",
    ltr: { path: "/?humancheck=1" },
  },
  {
    id: "human-check-missing",
    title: "Human check not done",
    how: "humancheck=1, then Continue as guest without the check.",
    ltr: { path: "/?humancheck=1", steps: [click(button("Continue as guest")), waitFor({ text: "Complete the human check first." })] },
  },
  {
    id: "network-failure",
    title: "Network failure",
    how: "signInAsGuest cannot reach the server.",
    ltr: { path: "/?mock=signInAsGuest:network", steps: [click(button("Continue as guest")), waitFor({ text: "The request did not reach the server" })] },
  },
  {
    id: "config-unreachable",
    title: "Config unreachable",
    how: "getConfig cannot reach the server (it is retried twice first).",
    ltr: { path: "/?mock=getConfig:network", ready: { text: "The server could not be reached" } },
  },
  {
    id: "session-unreachable",
    title: "Session check unreachable",
    how: "getSession cannot reach the server.",
    ltr: { path: "/?mock=getSession:network", ready: { text: "The server could not be reached" } },
  },
  {
    id: "session-ended",
    title: "Session ended",
    how: "persona=guest-expired on /maps: the first call answers 401 and the workspace sends you to sign-in with a notice.",
    ltr: { path: "/maps?persona=guest-expired", ready: { text: "Your session ended" } },
  },
];

/* ----------------------------------------------------------- workspace */

const SHAHEEN = "إعصار شاهين: المسار والتحذيرات ومراكز الإيواء";
const BEIRUT = "Beirut port explosion: how far the damage reached";
/** On a phone a row's actions sit in its details; open them first where that button exists. */
const rowAction = (title: string, action: string): Step[] => [click(button(`Details of ${title}`), { optional: true }), click(button(action))];
const TITLE_FIELD: Target = { role: "textbox", name: "Title" };

/** Creates one guest map from the workspace and comes back to the list. */
function createGuestMap(title: string): Step[] {
  return [
    { do: "navigate", path: "/maps?new=1" },
    fill(TITLE_FIELD, title),
    click(button("Create and open")),
    waitFor({ css: "[data-editor-root]" }, 10_000),
    { do: "navigate", path: "/maps" },
    /* The list (phone) or the table (wider) is back with the New map button over it. */
    waitFor(startsWith("New map")),
  ];
}

const WORKSPACE_STATES: StateDef[] = [
  { id: "list", title: "List", how: "Owner, ten active maps.", ltr: { path: "/maps?persona=owner" } },
  { id: "empty-guest", title: "Empty (guest)", how: "persona=guest: a new guest workspace; the new-map form stands in the empty table.", ltr: { path: "/maps?persona=guest" } },
  { id: "loading", title: "Loading", how: "Every call takes ten minutes.", ltr: { path: `/maps?persona=owner&latency=${FOREVER}`, keepLatency: true } },
  { id: "error", title: "Error", how: "listMaps answers 500.", ltr: { path: "/maps?persona=owner&mock=listMaps:internal_error", ready: { text: "The maps could not be loaded" } } },
  {
    id: "session-error",
    title: "Session failed",
    how: "getSession cannot reach the server.",
    ltr: { path: "/maps?persona=owner&mock=getSession:network", ready: { text: "The workspace could not be loaded" } },
  },
  {
    id: "quota-near",
    title: "Quota near",
    how: "A guest creates four of its five maps (no persona starts there).",
    ltr: {
      path: "/maps?persona=guest",
      steps: [
        ...createGuestMap("Floods in Valencia, October 2024"),
        ...createGuestMap("Storm Boris: rivers over their banks"),
        ...createGuestMap("فيضانات درنة: اليوم الثالث"),
        ...createGuestMap("Wildfire smoke over Montreal"),
      ],
    },
  },
  { id: "quota-full", title: "Quota full", how: "persona=guest-full: five of five maps; New map is disabled.", ltr: { path: "/maps?persona=guest-full" } },
  {
    id: "quota-exceeded-on-create",
    title: "Quota exceeded on create",
    how: "createMap answers quota_exceeded once the form is sent.",
    ltr: {
      path: "/maps?persona=guest&mock=createMap:quota_exceeded",
      steps: [fill(TITLE_FIELD, "Floods in Valencia, October 2024"), click(button("Create and open")), waitFor({ text: "The map was not created: the workspace is full" })],
    },
  },
  { id: "rate-limited", title: "Rate limited", how: "persona=rate-limited: every data call answers 429.", ltr: { path: "/maps?persona=rate-limited", ready: { text: "Too many requests", exact: false } } },
  { id: "viewer", title: "Read-only viewer", how: "persona=viewer.", ltr: { path: "/maps?persona=viewer" } },
  { id: "contributor", title: "Contributor", how: "persona=contributor: edits only his own maps.", ltr: { path: "/maps?persona=contributor" } },
  { id: "editor-role", title: "Editor role", how: "persona=editor: can publish, cannot archive.", ltr: { path: "/maps?persona=editor" } },
  { id: "archived-view", title: "Archived view", how: "view=archived.", ltr: { path: "/maps?persona=owner&view=archived" } },
  {
    id: "archive-done",
    title: "Archive done",
    how: "Archive pressed on the first row.",
    ltr: { path: "/maps?persona=owner", steps: [...rowAction(SHAHEEN, `Archive ${SHAHEEN}`), waitFor({ text: "Archived.", exact: false })] },
  },
  {
    id: "archive-refused",
    title: "Archive refused",
    how: "archiveMap answers 403, then Archive pressed.",
    ltr: { path: "/maps?persona=owner&mock=archiveMap:forbidden", steps: [...rowAction(SHAHEEN, `Archive ${SHAHEEN}`), waitFor({ text: "Not archived" })] },
  },
  {
    id: "archive-rate-limited",
    title: "Archive rate limited",
    how: "archiveMap answers 429, then Archive pressed.",
    ltr: { path: "/maps?persona=owner&mock=archiveMap:rate_limited", steps: [...rowAction(SHAHEEN, `Archive ${SHAHEEN}`), waitFor({ text: "Not archived" })] },
  },
  {
    id: "restore-done",
    title: "Restore done",
    how: "Archived view, Restore pressed.",
    ltr: { path: "/maps?persona=owner&view=archived", steps: [...rowAction(BEIRUT, `Restore ${BEIRUT}`), waitFor({ text: "Restored.", exact: false })] },
  },
  {
    id: "restore-refused",
    title: "Restore refused",
    how: "unarchiveMap cannot reach the server, then Restore pressed.",
    ltr: { path: "/maps?persona=owner&view=archived&mock=unarchiveMap:network", steps: [...rowAction(BEIRUT, `Restore ${BEIRUT}`), waitFor({ text: "Not restored" })] },
  },
  {
    id: "new-map-arabic",
    title: "New map panel, Arabic title",
    how: "new=1, an Arabic title typed: the direction follows the title.",
    ltr: { path: "/maps?persona=owner&new=1", steps: [fill(TITLE_FIELD, "زلزال الحوز: خريطة الإغاثة بعد أسبوع")] },
  },
  {
    id: "new-map-templates-failed",
    title: "New map panel, templates failed",
    how: "new=1 with listTemplates answering 500.",
    ltr: { path: "/maps?persona=owner&new=1&mock=listTemplates:internal_error", ready: { text: "The templates could not be loaded" } },
  },
  { id: "search-results", title: "Search with results", how: "q=earthquake.", ltr: { path: "/maps?persona=owner&q=earthquake" } },
  { id: "search-arabic", title: "Search in Arabic, diacritics folded", how: "q=اعصار (no hamza): matches إعصار.", ltr: { path: "/maps?persona=owner&q=%D8%A7%D8%B9%D8%B5%D8%A7%D8%B1" } },
  { id: "search-none", title: "Search with none", how: "q=Kherson.", ltr: { path: "/maps?persona=owner&q=Kherson", ready: { text: "No title matches", exact: false } } },
  {
    id: "phone-row-details",
    title: "Phone row details",
    how: "Phone width, the details of the first row opened.",
    ltr: { path: "/maps?persona=owner", steps: [click(button(`Details of ${SHAHEEN}`))] },
    widths: [390],
  },
];

/* -------------------------------------------------------------- editor */

interface EditorFixture {
  dir: Dir;
  map: string;
  /** Feature ids, one of each kind, on `map`. */
  area: string;
  line: string;
  arrow: string;
  point: string;
  number: string;
  annotation: string;
  /** A front line; on its own map where the main one has none. */
  frontline: { map: string; id: string };
  /** A locked feature, or one to lock first. */
  locked: { map: string; id: string; lockFirst: boolean };
  group: string;
  second: string;
  /** A map someone else created, for a contributor. */
  notOwn: string;
  archived: string;
  t: {
    back: string;
    settings: string;
    preview: string;
    transfer: string;
    importTab: string;
    imageTab: string;
    play: string;
    phone: string;
    tablet: string;
    desktop: string;
    furniture: { folded: string; hidden: string };
    showList: string;
    showInspector: string;
  };
}

const EDITOR: Record<Dir, EditorFixture> = {
  ltr: {
    dir: "ltr",
    map: "m_earthquake",
    area: "eq-001",
    line: "eq-010",
    arrow: "eq-013",
    point: "eq-024",
    number: "eq-020",
    annotation: "eq-059",
    frontline: { map: "m_alamein", id: "al-005" },
    locked: { map: "m_suez", id: "sz-004", lockFirst: false },
    group: "g:eq-notes",
    second: "eq-025",
    notOwn: "m_earthquake",
    archived: "m_beirut",
    t: {
      back: "Maps",
      settings: "Map settings",
      preview: "Preview",
      transfer: "Import / Export",
      importTab: "Import",
      imageTab: "Image",
      play: "Play",
      phone: "Phone 390",
      tablet: "Tablet 834",
      desktop: "Desktop 1200",
      furniture: { folded: "Folded", hidden: "Hidden" },
      showList: "Features",
      showInspector: "Properties",
    },
  },
  rtl: {
    dir: "rtl",
    map: "m_shaheen",
    area: "sh-001",
    line: "sh-009",
    arrow: "sh-021",
    point: "sh-036",
    number: "sh-025",
    annotation: "sh-063",
    frontline: { map: "m_shaheen", id: "sh-020" },
    locked: { map: "m_shaheen", id: "sh-036", lockFirst: true },
    group: "g:sh-notes",
    second: "sh-037",
    notOwn: "m_shaheen",
    archived: "m_stadiums",
    t: {
      back: "الخرائط",
      settings: "إعدادات الخريطة",
      preview: "معاينة",
      transfer: "استيراد / تصدير",
      importTab: "استيراد",
      imageTab: "صورة",
      play: "تشغيل",
      phone: "هاتف 390",
      tablet: "لوحي 834",
      desktop: "حاسوب 1200",
      furniture: { folded: "مطويّان", hidden: "مخفيان" },
      showList: "العناصر",
      showInspector: "الخصائص",
    },
  },
};

const LIST = "[role=treegrid]";
const MAP_READY: Target = { css: "canvas.maplibregl-canvas" };
const row = (id: string): Target => ({ css: `[data-row-id="${id}"]`, scrollIn: LIST });
/** On a tablet the list is a pane over the map: open it first if it is closed. */
const select = (f: EditorFixture, id: string): Step[] => [click(startsWith(f.t.showList), { optional: true }), click(row(id))];
/** A plain edit every state can make the same way: delete the selected feature. */
const editOne = (f: EditorFixture, id: string): Step[] => [...select(f, id), press("Delete"), wait(150)];
const open = (f: EditorFixture, extra = "", mapId = f.map): string => `/maps/${mapId}?persona=owner${extra}`;

/** A small FeatureCollection to import: three places along the Orontes. */
const IMPORT_FILE = JSON.stringify({
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "Antakya" }, geometry: { type: "Point", coordinates: [36.16, 36.2] } },
    { type: "Feature", properties: { name: "Darkush" }, geometry: { type: "Point", coordinates: [36.39, 35.99] } },
    { type: "Feature", properties: { name: "Jisr al-Shughur" }, geometry: { type: "Point", coordinates: [36.32, 35.81] } },
    { type: "Feature", properties: { name: "Orontes, lower course" }, geometry: { type: "LineString", coordinates: [[36.32, 35.81], [36.39, 35.99], [36.16, 36.2], [35.96, 36.05]] } },
  ],
});

/** A save refused with `code`, shown in the message rail. */
function saveRefused(id: string, title: string, code: string): StateDef {
  return both(id, title, `An edit, then Save with editMap answering ${code} once.`, (f) => ({
    path: open(f, `&mock=editMap:${code}:once`),
    ready: MAP_READY,
    map: true,
    steps: [...editOne(f, f.point), press("Mod+S"), wait(900)],
  }), [1440, 834]);
}

const DESK: Width[] = [1440, 834];

const EDITOR_STATES: StateDef[] = [
  both("default", "Default", "Owner opens a published map.", (f) => ({ path: open(f), ready: MAP_READY, map: true })),
  ...(["area", "line", "arrow", "point", "number", "annotation"] as const).map((kind) =>
    both(`selected-${kind}`, `Selected: ${kind === "number" ? "number marker" : kind}`, `Its row clicked in the feature list.`, (f) => ({
      path: open(f),
      ready: MAP_READY,
      map: true,
      steps: select(f, f[kind]),
    }), DESK),
  ),
  both("selected-frontline", "Selected: front line", "Its row clicked (LTR on the El Alamein map, which has front lines).", (f) => ({
    path: open(f, "", f.frontline.map),
    ready: MAP_READY,
    map: true,
    steps: [...select(f, f.frontline.id)],
  }), DESK),
  both("multi-selection", "Multi-selection", "Two rows, the second with Ctrl held.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [...select(f, f.point), click(row(f.second), { modifiers: ["Mod"] })],
  }), DESK),
  both("group-selected", "Group selected", "A group's heading row clicked.", (f) => ({ path: open(f), ready: MAP_READY, map: true, steps: [...select(f, f.group)] }), DESK),
  both("drawing-area", "Drawing in progress", "A (area tool), then three clicks on the map without closing.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [wait(500), press("A"), { do: "mapClick", points: [[0.42, 0.36], [0.6, 0.4], [0.56, 0.62]], gap: 200 }],
  }), DESK),
  both("drawing-arrow", "Drawing an arrow", "W (arrow tool), then two clicks on the map.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [wait(500), press("W"), { do: "mapClick", points: [[0.4, 0.6], [0.55, 0.42]], gap: 200 }],
  }), DESK),
  both("reshaping", "Reshaping with handles", "An area selected, then Enter (Edit shape).", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    /* On a tablet the list pane is closed again so the handles can be seen. */
    steps: [...select(f, f.area), click(startsWith(f.t.showList), { optional: true }), { do: "press", keys: "Enter", target: { css: "body" } }, wait(300)],
  }), DESK),
  both("map-settings", "Map settings", "The Map settings button on the map.", (f) => ({ path: open(f), ready: MAP_READY, map: true, steps: [click(button(f.t.settings))] }), DESK),

  /* messages */
  both("msg-saved", "Message: saved", "An edit, then Mod+S.", (f) => ({ path: open(f), ready: MAP_READY, map: true, steps: [...editOne(f, f.point), press("Mod+S"), wait(900)] }), DESK),
  both("msg-published", "Message: published", "An edit, then Mod+Enter (save and publish).", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [...editOne(f, f.point), press("Mod+Enter"), wait(1500)],
  }), DESK),
  both("msg-nothing-changed", "Message: nothing changed", "Mod+Enter twice: the second publish has nothing new.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [press("Mod+Enter"), wait(1500), press("Mod+Enter"), wait(1500)],
  }), DESK),
  both("msg-stale", "Message: edited by someone else", "A colleague saves (simulateRemoteEdit), then an edit and Mod+S gets a 409.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [{ do: "mock", call: { fn: "simulateRemoteEdit", mapId: f.map } }, ...editOne(f, f.point), press("Mod+S"), wait(900)],
  }), DESK),
  saveRefused("msg-quota-features", "Message: quota exceeded (features)", "quota_exceeded"),
  both("msg-quota-versions", "Message: quota exceeded (versions)", "An edit, then publish with publishMap answering quota_exceeded once.", (f) => ({
    path: open(f, "&mock=publishMap:quota_exceeded:once"),
    ready: MAP_READY,
    map: true,
    steps: [...editOne(f, f.point), press("Mod+Enter"), wait(1500)],
  }), DESK),
  saveRefused("msg-rate-limited", "Message: rate limited", "rate_limited"),
  saveRefused("msg-not-permitted", "Message: not permitted", "forbidden"),
  saveRefused("msg-signed-out", "Message: signed out", "unauthorised"),
  saveRefused("msg-offline", "Message: offline", "network"),
  saveRefused("msg-too-large", "Message: too large", "body_too_large"),
  both("msg-locked", "Message: locked refusal", "A locked feature selected, then Delete (RTL locks it first with Shift+L).", (f) => ({
    path: open(f, "", f.locked.map),
    ready: MAP_READY,
    map: true,
    steps: [...select(f, f.locked.id), ...(f.locked.lockFirst ? [press("Shift+L"), wait(150)] : []), press("Delete"), wait(300)],
  }), DESK),

  /* read-only */
  both("read-only-viewer", "Read-only: viewer", "persona=viewer.", (f) => ({ path: `/maps/${f.map}?persona=viewer`, ready: MAP_READY, map: true })),
  both("read-only-contributor", "Read-only: contributor on another's map", "persona=contributor on a map someone else made.", (f) => ({
    path: `/maps/${f.notOwn}?persona=contributor`,
    ready: MAP_READY,
    map: true,
  })),
  both("read-only-archived", "Read-only: archived", "An archived map.", (f) => ({ path: open(f, "", f.archived), ready: MAP_READY, map: true })),
  both("leave-unsaved", "Leave with unsaved changes", "An edit, then the Maps link.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [...editOne(f, f.point), click(link(f.t.back)), wait(300)],
  }), DESK),

  /* loading and failure */
  {
    id: "loading",
    title: "Loading",
    how: "Every call takes ten minutes. In the shell's language: the map's direction is not known yet.",
    ltr: { path: `/maps/m_earthquake?persona=owner&latency=${FOREVER}`, keepLatency: true },
  },
  { id: "not-found", title: "Not found", how: "A map id that does not exist.", ltr: { path: "/maps/m_kherson?persona=owner", ready: { text: "This map does not exist" } } },
  { id: "load-failed", title: "Load failed", how: "getMap answers 500.", ltr: { path: "/maps/m_earthquake?persona=owner&mock=getMap:internal_error", ready: button("Try again") } },
  { id: "load-offline", title: "Load failed, offline", how: "getMap cannot reach the server.", ltr: { path: "/maps/m_earthquake?persona=owner&mock=getMap:network", ready: button("Try again") } },
  { id: "load-forbidden", title: "Load refused", how: "getMap answers 403.", ltr: { path: "/maps/m_earthquake?persona=owner&mock=getMap:forbidden" } },
  both("tiles-failed", "Tiles failed", "The workspace loads first; the basemap's fetches are made to fail; then the map is opened in place.", (f) => ({
    path: "/maps?persona=owner",
    map: true,
    steps: [{ do: "failFetch", match: "openfreemap" }, { do: "navigate", path: `/maps/${f.map}` }, waitFor(MAP_READY, 10_000), wait(1500)],
  }), DESK),
  both("context-lost", "Context lost", "The map's WebGL context is taken away and not given back.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [wait(800), { do: "loseContext" }, wait(500)],
  }), DESK),

  /* furniture, time, panels */
  both("furniture-folded", "Furniture folded", "Status bar: Title and key → Folded.", (f) => ({ path: open(f), ready: MAP_READY, map: true, steps: [click(button(f.t.furniture.folded))] }), DESK),
  both("furniture-hidden", "Furniture hidden", "Status bar: Title and key → Hidden.", (f) => ({ path: open(f), ready: MAP_READY, map: true, steps: [click(button(f.t.furniture.hidden))] }), DESK),
  both("timeline-playing", "Timeline playing", "Play on the timeline, shot mid-run.", (f) => ({ path: open(f), ready: MAP_READY, map: true, steps: [click(button(f.t.play)), wait(1200)] }), DESK),
  both("command-palette", "Command palette", "Mod+K.", (f) => ({ path: open(f), ready: MAP_READY, map: true, steps: [press("Mod+K"), wait(300)] }), DESK),
  both("shortcut-sheet", "Shortcut sheet", "Shift+/ (?).", (f) => ({ path: open(f), ready: MAP_READY, map: true, steps: [press("Shift+/"), wait(300)] }), DESK),
  both("import-review", "Import review", "Import / Export → Import, a four-feature GeoJSON file chosen.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [
      click(button(f.t.transfer)),
      click(radio(f.t.importTab)),
      { do: "upload", target: { css: "input[type=file]" }, fileName: "orontes.geojson", mime: "application/geo+json", content: IMPORT_FILE },
      wait(600),
    ],
  }), DESK),
  both("export-image", "Export image", "Import / Export → Image.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [click(button(f.t.transfer)), click(radio(f.t.imageTab)), wait(2500)],
  }), DESK),
  ...(["phone", "tablet", "desktop"] as const).map((size) =>
    both(`preview-${size}`, `Preview at ${size}`, `Preview, then the ${size} frame.`, (f) => ({
      path: open(f),
      ready: MAP_READY,
      map: true,
      steps: [click(radio(f.t.preview)), click(radio(f.t[size])), wait(1500)],
    }), [1440]),
  ),
  both("tablet-list", "Tablet: list pane", "Tablet width, the feature list opened over the map.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [click(startsWith(f.t.showList))],
  }), [834]),
  both("tablet-inspector", "Tablet: inspector pane", "Tablet width, a feature selected from the list, then the properties pane.", (f) => ({
    path: open(f),
    ready: MAP_READY,
    map: true,
    steps: [...select(f, f.point), click(startsWith(f.t.showInspector), { optional: true })],
  }), [834]),
  both("phone", "Phone editor", "Phone width: review, retitle, publish; no drawing.", (f) => ({ path: open(f), ready: MAP_READY, map: true }), [390]),
];

/* ------------------------------------------------------------ versions */

const ROLLBACK_V3 = button("Roll back to version 3");
const CONFIRM: Target = { role: "button", name: "Roll back: publish", exact: false };

function rollbackRefused(code: string, title: string, wanted: string): StateDef {
  return {
    id: `rollback-${code.replace(/_/g, "-")}`,
    title: `Rollback refused: ${title}`,
    how: `rollbackMap answers ${code}, then Roll back to v3 confirmed.`,
    ltr: { path: `/maps/m_earthquake/versions?persona=owner&mock=rollbackMap:${code}:once`, steps: [click(ROLLBACK_V3), click(CONFIRM), wanted ? waitFor({ text: wanted, exact: false }) : wait(800)] },
  };
}

const VERSIONS_STATES: StateDef[] = [
  { id: "history", title: "History", how: "Four published versions.", ltr: { path: "/maps/m_earthquake/versions?persona=owner" } },
  { id: "history-rollback-in-log", title: "History with a rollback", how: "A map whose log has a rollback and a draft ahead.", ltr: { path: "/maps/m_shaheen/versions?persona=owner" } },
  { id: "nothing-published", title: "Nothing published", how: "A map never published.", ltr: { path: "/maps/m_aftershocks/versions?persona=owner" } },
  { id: "loading", title: "Loading", how: "Every call takes ten minutes.", ltr: { path: `/maps/m_earthquake/versions?persona=owner&latency=${FOREVER}`, keepLatency: true } },
  { id: "error", title: "Error", how: "listVersions answers 500.", ltr: { path: "/maps/m_earthquake/versions?persona=owner&mock=listVersions:internal_error" } },
  { id: "not-permitted", title: "Not permitted", how: "listVersions answers 403.", ltr: { path: "/maps/m_earthquake/versions?persona=owner&mock=listVersions:forbidden" } },
  { id: "not-found", title: "Not found", how: "A map id that does not exist.", ltr: { path: "/maps/m_kherson/versions?persona=owner" } },
  { id: "archived", title: "Archived", how: "An archived map's versions: rollback is off.", ltr: { path: "/maps/m_beirut/versions?persona=owner" } },
  { id: "viewer", title: "Viewer", how: "persona=viewer: no rollback.", ltr: { path: "/maps/m_earthquake/versions?persona=viewer" } },
  { id: "rollback-confirm", title: "Rollback confirm", how: "Roll back to v3 pressed.", ltr: { path: "/maps/m_earthquake/versions?persona=owner", steps: [click(ROLLBACK_V3), waitFor(CONFIRM)] } },
  {
    id: "rollback-done",
    title: "Rollback done",
    how: "Roll back to v3, confirmed.",
    ltr: { path: "/maps/m_earthquake/versions?persona=owner", steps: [click(ROLLBACK_V3), click(CONFIRM), { do: "waitFor", target: CONFIRM, gone: true }, wait(400)] },
  },
  rollbackRefused("rate_limited", "rate limited", "Too many"),
  rollbackRefused("network", "offline", "reach"),
  rollbackRefused("quota_exceeded", "no room for a version", "no room"),
  rollbackRefused("forbidden", "not permitted", ""),
  rollbackRefused("not_found", "version gone", ""),
  rollbackRefused("internal_error", "server failed", ""),
  { id: "compare", title: "Compare", how: "tab=compare, v3 against v4.", ltr: { path: "/maps/m_earthquake/versions?persona=owner&tab=compare&a=3&b=4", map: true } },
  { id: "compare-draft", title: "Compare live against draft", how: "tab=compare, live v14 against the draft.", ltr: { path: "/maps/m_shaheen/versions?persona=owner&tab=compare&a=14&b=draft", map: true } },
  { id: "view-version", title: "View one version", how: "view=3.", ltr: { path: "/maps/m_earthquake/versions?persona=owner&view=3", map: true } },
  { id: "embed-tab", title: "Embed tab", how: "tab=embed.", ltr: { path: "/maps/m_earthquake/versions?persona=owner&tab=embed", map: true } },
];

/* --------------------------------------------------------------- embed */

const EMBED_MAP: Record<Dir, { slug: string; ahead: { slug: string; id: string } }> = {
  ltr: { slug: "turkiye-syria-earthquakes-aid", ahead: { slug: "evia-wildfire-perimeter", id: "m_wildfire" } },
  rtl: { slug: "cyclone-shaheen", ahead: { slug: "cyclone-shaheen", id: "m_shaheen" } },
};
const embedPath = (slug: string, query = ""): string => `/embed/al-mashriq/${slug}${query ? `?${query}` : ""}`;
/* The reader's timeline opens at its end, so its button replays. */
const PLAY: Record<Dir, string> = { ltr: "Replay", rtl: "إعادة" };

function embedBoth(id: string, title: string, how: string, make: (dir: Dir) => Recipe, widths?: Width[]): StateDef {
  return { id, title, how, ltr: make("ltr"), rtl: make("rtl"), ...(widths ? { widths } : {}) };
}

const EMBED_STATES: StateDef[] = [
  embedBoth("interactive", "Interactive", "The published map.", (dir) => ({ path: embedPath(EMBED_MAP[dir].slug), ready: MAP_READY, map: true })),
  embedBoth("static", "Static", "static=1: a picture, no gestures.", (dir) => ({ path: embedPath(EMBED_MAP[dir].slug, "static=1"), map: true, settle: 1500 })),
  embedBoth("no-key", "Key off", "legend=0.", (dir) => ({ path: embedPath(EMBED_MAP[dir].slug, "legend=0"), ready: MAP_READY, map: true })),
  embedBoth("playing", "Playing", "Play on the timeline, shot mid-run.", (dir) => ({
    path: embedPath(EMBED_MAP[dir].slug),
    ready: MAP_READY,
    map: true,
    steps: [click({ role: "button", name: PLAY[dir] }), wait(1200)],
  })),
  embedBoth("key-folded-phone", "Key folded on phone", "Phone width: the key starts folded.", (dir) => ({ path: embedPath(EMBED_MAP[dir].slug), ready: MAP_READY, map: true }), [390]),
  { id: "loading", title: "Loading", how: "Every call takes ten minutes; the language is not known yet, so both are given.", ltr: { path: embedPath("cyclone-shaheen", `latency=${FOREVER}`), keepLatency: true } },
  { id: "not-published", title: "Not published", how: "A map that was never published.", ltr: { path: embedPath("aftershock-sequence-february-2023") } },
  { id: "not-found", title: "Not found", how: "A slug that does not exist.", ltr: { path: embedPath("kherson-dam-breach") } },
  { id: "failed", title: "Failed", how: "Every published-map call answers 500.", ltr: { path: embedPath("cyclone-shaheen", "mock=getPublished:internal_error,getPublishedPointer:internal_error,getPublishedVersion:internal_error") } },
  {
    id: "offline-cold",
    title: "Offline, cold",
    how: "Every call fails as unreachable and the browser reports offline: nothing to show.",
    ltr: { path: embedPath("cyclone-shaheen", "mock=*:network"), steps: [{ do: "offline" }, wait(400)] },
  },
  embedBoth("offline-stale", "Offline, stale", "The map loads, then the browser reports offline: the map stays, with a note.", (dir) => ({
    path: embedPath(EMBED_MAP[dir].slug),
    ready: MAP_READY,
    map: true,
    steps: [{ do: "offline" }, wait(400)],
  })),
  embedBoth("updated", "Updated in place", "The map loads, a colleague publishes the draft, and the next poll (10 s) swaps it in with a note.", (dir) => ({
    path: embedPath(EMBED_MAP[dir].ahead.slug, "persona=owner"),
    ready: MAP_READY,
    map: true,
    steps: [wait(500), { do: "publishDraft", mapId: EMBED_MAP[dir].ahead.id }, wait(11_500)],
  })),
];

/* ----------------------------------------------------------------- dev */

const DEV_STATES: StateDef[] = [
  { id: "kit", title: "Component kit", how: "Every ui component in every state.", ltr: { path: "/dev/kit" }, linkOnly: true },
  { id: "engine", title: "Engine harness", how: "The map engine on its own: rendering, drawing, stress switches.", ltr: { path: "/dev/engine?persona=owner" }, linkOnly: true },
  { id: "extras", title: "Editor extras harness", how: "The editor's secondary panels on their own (?map=, ?open=palette|sheet|preview).", ltr: { path: "/dev/extras?persona=owner" }, linkOnly: true },
];

export const CATALOGUE: ScreenDef[] = [
  { id: "signin", title: "Sign-in", directional: false, states: SIGNIN_STATES },
  { id: "workspace", title: "Workspace", directional: false, states: WORKSPACE_STATES },
  { id: "editor", title: "Editor", directional: true, states: EDITOR_STATES },
  { id: "versions", title: "Versions", directional: false, states: VERSIONS_STATES },
  { id: "embed", title: "Embed", directional: true, states: EMBED_STATES },
  { id: "dev", title: "Developer pages", directional: false, states: DEV_STATES },
];

/** The recipe for one direction, falling back to LTR where a state has only one. */
export function recipeFor(state: StateDef, dir: Dir): Recipe {
  return dir === "rtl" && state.rtl ? state.rtl : state.ltr;
}

export function directionsOf(state: StateDef): Dir[] {
  return state.rtl ? ["ltr", "rtl"] : ["ltr"];
}
