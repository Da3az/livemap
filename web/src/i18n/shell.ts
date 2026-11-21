import type { Role } from "@/model/types";
import { defineStrings } from "@/i18n";

/**
 * Strings for the app shell: the header, sign-in and the workspace.
 * The shell is English and left to right (DECISIONS B.3), so the Arabic slot
 * points at the same dictionary until that changes.
 */

const number = new Intl.NumberFormat("en-GB");
const n = (value: number): string => number.format(value);
const plural = (count: number, one: string, many: string): string => `${n(count)} ${count === 1 ? one : many}`;

const ROLE_NAMES: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  contributor: "Contributor",
  viewer: "Viewer",
};

const en = {
  n,
  plural,

  /* ------------------------------------------------------------- time */
  time: {
    justNow: "just now",
    minutesAgo: (m: number) => `${m} min ago`,
    hoursAgo: (h: number) => `${h} h ago`,
    yesterday: "yesterday",
    daysAgo: (d: number) => `${d} days ago`,
    now: "now",
    inSeconds: (s: number) => `in ${s} s`,
    inMinutes: (m: number) => `in ${m} min`,
    inHours: (h: number, m: number) => (m > 0 ? `in ${h} h ${m} min` : `in ${h} h`),
    inDays: (d: number) => `in ${d} days`,
    leftMinutes: (m: number) => `${m} min left`,
    leftHours: (h: number) => `${h} h left`,
    leftDays: (d: number) => `${d} days left`,
  },

  /* ----------------------------------------------------------- header */
  header: {
    home: "livemap, all maps",
    role: (role: Role) => ROLE_NAMES[role],
    guest: "Guest",
    readOnly: "Read-only",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutFailed: "Could not sign out. Try again.",
    menu: "Menu",
    signedInAs: (name: string) => `Signed in as ${name}`,
  },

  /* ---------------------------------------------------------- sign-in */
  signin: {
    product: "Draw, publish and update interactive maps of live events.",
    checkingSession: "Checking for an existing session",
    expired: "Your session ended",
    serverUnreachable: "The server could not be reached",
    serverUnreachableBody: "Nothing has been lost. Check the connection and try again.",
    retry: "Try again",
    retryNow: "Try now",

    guestHeading: "Start a guest workspace",
    guestLead: "No account. A guest workspace is temporary and private to this browser.",
    factLasts: "Lasts",
    factLastsValue: (hours: number) => `${plural(hours, "hour", "hours")} from the moment it starts`,
    factHolds: "Holds",
    factHoldsValue: (maps: number) => plural(maps, "map", "maps"),
    factEach: "Each map",
    factEachValue: (features: number, versions: number) =>
      `up to ${plural(features, "feature", "features")}, ${plural(versions, "published version", "published versions")}`,
    factAfter: "Afterwards",
    factAfterValue: "the workspace and its maps are removed",
    guestButton: "Continue as guest",
    /* the published map shown on the front door, captioned as the desk captions it */
    specimenLabel: (title: string) => `A map published from this server: ${title}`,
    specimenLive: (version: number) => `Live · v${version}`,
    specimenAsOf: (when: string) => `As of ${when}`,
    guestStarting: "Starting workspace…",
    guestLoading: "Checking whether guest workspaces are available",
    guestOffHeading: "Guest workspaces are switched off",
    guestOffBody:
      "This server does not start guest workspaces. To work here you need a session token for an existing workspace; its owner or admin can issue one.",
    capacityTitle: "Every guest workspace is in use",
    capacityBody: (clock: string) => `One frees up when another guest's workspace runs out. You can try again in ${clock}.`,
    capacityReady: "You can try again now.",
    rateTitle: "Too many attempts from this address",
    rateBody: (clock: string) => `The server is holding requests back. You can try again in ${clock}.`,
    rateReady: "You can try again now.",
    networkTitle: "The request did not reach the server",
    networkBody: "No workspace was started. Check the connection and try again.",
    humanFailedTitle: "The human check did not pass",
    humanFailedBody: "Run the check again, then continue.",
    humanNeeded: "Complete the human check first.",
    otherTitle: "The server could not start a workspace",

    humanLabel: "Human check",
    humanPrompt: "Confirm you are human",
    humanVerifying: "Verifying…",
    humanVerified: "Verified",
    humanCaption: "Verification widget",

    tokenHeading: "Sign in with a session token",
    tokenLead: "For members of a workspace. An owner or admin issues the token.",
    tokenLabel: "Session token",
    tokenButton: "Sign in",
    tokenSigningIn: "Signing in…",
    tokenEmpty: "Paste the token first.",
    tokenRejectedTitle: "That token was not accepted",
    tokenRejectedBody: "Check that all of it was pasted, or ask for a new one. Tokens stop working when a membership changes.",
    tokenOtherTitle: "The server could not sign you in",
    devHint: "Development build. The mock accepts:",
    devUse: (token: string) => `Use ${token}`,
  },

  /* -------------------------------------------------------- workspace */
  ws: {
    title: "Maps",
    sessionFailedTitle: "The workspace could not be loaded",
    retry: "Try again",
    retryNow: "Try now",
    dismiss: "Dismiss",

    views: "View",
    active: "Active",
    archived: "Archived",

    search: "Search titles",
    searchPlaceholder: "Search titles",
    clearSearch: "Clear search",
    matches: (shown: number, total: number) => `${n(shown)} of ${n(total)}`,
    noMatchTitle: (query: string) => `No title matches “${query}”`,
    noMatchBody: "Search ignores accents and Arabic diacritics, and looks in titles only.",

    newMap: "New map",
    usage: "Maps in use",
    usageOf: (used: number, max: number) => `${n(used)} of ${n(max)}`,
    usageLeft: (left: number) => (left === 1 ? "1 left" : `${n(left)} left`),
    usageFull: "Full",
    usageArchivedNote: "Archived maps are not counted.",
    nearTitle: (left: number) => (left === 1 ? "Room for one more map" : `Room for ${n(left)} more maps`),
    fullTitle: (max: number) => `This workspace is full: ${n(max)} of ${n(max)} maps`,
    fullBody: "Archive a map to make room. Archived maps are kept and are not counted.",

    guestTitle: "Temporary workspace",
    guestBody: (date: string) => `Removed with its maps on ${date}`,
    guestLimits: (maps: number, features: number, versions: number | null) =>
      versions === null
        ? `${plural(maps, "map", "maps")} · ${n(features)} features a map`
        : `${plural(maps, "map", "maps")} · ${n(features)} features a map · ${n(versions)} versions a map`,

    roleHeading: "Your access",
    roleViewer:
      "You can open maps and their versions. Creating, editing and archiving need an editing role; an owner or admin can change yours.",
    roleContributor:
      "Contributor. You can create maps and edit the ones you created; the others open read-only. Publishing and archiving are done by editors and admins.",
    roleEditor: "Editor. You can create, edit and publish. Archiving and restoring are done by an owner or admin.",

    keysHeading: "Keys",
    keyMove: "Move through rows",
    keyOpen: "Open the map",
    keyVersions: "Its versions",
    keyNew: "New map",
    keySearch: "Search",
    keyEsc: "Close or clear",

    colTitle: "Title",
    colDir: "Dir.",
    colDirFull: "Direction",
    colFeatures: "Features",
    colRev: "Rev.",
    colRevFull: "Revision",
    colState: "State",
    colUpdated: "Updated",
    colBy: "By",
    colActions: "Actions",
    sortBy: "Sort by",
    sortAsc: "ascending",
    sortDesc: "descending",
    sortTitle: "Title",
    sortUpdated: "Updated",
    sortFeatures: "Features",
    tableLabel: (view: string, count: number) => `${view} maps, ${n(count)}`,

    rtl: "RTL",
    ltr: "LTR",
    rtlFull: "Right to left",
    ltrFull: "Left to right",
    featuresOf: (count: number, max: number) => `${n(count)} of ${n(max)}`,
    featuresNear: (max: number) => `Close to the limit of ${n(max)} features`,
    rev: (rev: number) => `Rev. ${n(rev)}`,
    revAhead: (count: number) => `${plural(count, "revision", "revisions")} not yet published`,

    stateNever: "Not published",
    stateLive: (version: number) => `Live · v${version}`,
    stateAhead: (version: number) => `Draft ahead of v${version}`,
    stateArchived: "Archived",
    stateArchivedLive: (version: number) => `Archived · v${version} still live`,

    yours: "Yours",
    readOnly: "Read-only",
    open: "Open",
    view: "View",
    versions: "Versions",
    archive: "Archive",
    restore: "Restore",
    archiving: "Archiving…",
    restoring: "Restoring…",
    openNamed: (title: string) => `Open ${title}`,
    viewNamed: (title: string) => `View ${title} (read-only)`,
    versionsNamed: (title: string) => `Versions of ${title}`,
    archiveNamed: (title: string) => `Archive ${title}`,
    restoreNamed: (title: string) => `Restore ${title}`,
    detailsNamed: (title: string) => `Details of ${title}`,

    archivedDone: "Archived.",
    archivedDoneBody: "It is in the Archived view and no longer counts against the limit.",
    restoredDone: "Restored.",
    restoredDoneBody: "It is back in the Active view.",
    undo: "Undo",
    archiveFailed: "Not archived",
    restoreFailed: "Not restored",
    rateWait: (clock: string) => `Too many requests. You can try again in ${clock}.`,
    networkFailed: "The request did not reach the server.",

    loading: "Loading maps",
    loadFailedTitle: "The maps could not be loaded",
    loadNetworkBody: "The server could not be reached. Nothing has been lost.",
    loadRateTitle: "Too many requests",
    loadRateBody: (clock: string) => `The server is holding requests back. Loading again in ${clock}.`,
    loadRateReady: "Loading again…",

    emptyActive: "No maps yet. Start the first one here.",
    emptyActiveReadOnly: "No maps in this workspace yet.",
    emptyArchived: "Nothing is archived. A map you archive is kept here and can be restored.",

    footerIdle: (count: number, sort: string) => `${plural(count, "map", "maps")}, sorted by ${sort}`,
    centre: "Centre",
    zoom: (z: string) => `zoom ${z}`,
    updatedBy: (when: string, who: string) => `Updated ${when} by ${who}`,
    createdBy: "Created by",
    updatedByLabel: "Updated by",

    newHeading: "New map",
    newStart: "Start from",
    newTitle: "Title",
    newTitleHint: "Arabic or English. It can be changed later.",
    newDir: "Direction",
    dirAuto: "Auto",
    dirFromTitle: (dir: string) => `${dir}, from the title's first letter`,
    dirFromTemplate: (dir: string) => `${dir}, the template's default until a title is typed`,
    dirManual: (dir: string) => `${dir}, set by you`,
    create: "Create and open",
    creating: "Creating…",
    cancel: "Cancel",
    templatesLoading: "Loading templates",
    templatesFailed: "The templates could not be loaded",
    createQuotaTitle: "The map was not created: the workspace is full",
    createRateTitle: "The map was not created: too many requests",
    createRateBody: (clock: string) => `You can try again in ${clock}. What you typed is kept.`,
    createRateReady: "You can try again now. What you typed is kept.",
    createForbiddenTitle: "The map was not created: your role does not allow it",
    createNetworkTitle: "The map was not created: the server could not be reached",
    createNetworkBody: "What you typed is kept. Try again.",
    createOtherTitle: "The map was not created",
    untitledLtr: "Untitled map",
    untitledRtl: "خريطة بلا عنوان",
    presets: (dir: string) => `Opens ${dir}`,
  },
};

export type ShellStrings = typeof en;

export const useShellStrings = defineStrings({ en, ar: en });
