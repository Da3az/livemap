import type { DrawProgress, PointerInfo, ToolId } from "@/editor/controller";
import type { IsoDateTime, MapDoc, MapFeature, Session, Viewport } from "@/model/types";
import type { DrawDefaults } from "./defaults";
import type { Doc, Patch } from "./doc";
import type { StyleClipboard } from "./style";
import type { Bilingual } from "./text";

/** The server-side facts about the open map that are not part of the editable document. */
export type MapMeta = Pick<
  MapDoc,
  "id" | "tenantId" | "slug" | "rev" | "publishedVersion" | "publishedRev" | "archived" | "updatedAt" | "updatedBy"
>;

/** Why the map cannot be edited. */
export type ReadOnlyReason = "viewer" | "archived";

/** Who is editing and what they may do. */
export interface Access {
  /** null: the map can be edited. */
  readOnly: ReadOnlyReason | null;
  canPublish: boolean;
  userId: string;
  limits: Session["limits"];
}

/** Why a command did nothing. Shown in place; never thrown. */
export type Refusal =
  | { code: "read_only"; why: ReadOnlyReason }
  /** Adding would pass the plan's features-per-map limit. */
  | { code: "feature_limit"; max: number; wouldBe: number }
  /** Every target is locked, directly or through its group. */
  | { code: "locked" }
  /** No selection and no ids given, or none of them exist. */
  | { code: "no_target" }
  | { code: "not_found"; what: "feature" | "group" | "preset" | "legend_item" }
  /** The command needs a playhead time and the timeline has none. */
  | { code: "no_playhead" }
  /** The clipboard is empty or holds nothing usable here. */
  | { code: "empty_clipboard" }
  | { code: "invalid"; detail: string };

/** What every command returns. `changed` is false when it was accepted but had nothing to do. */
export type CommandResult = { ok: true; changed: boolean } | { ok: false; refusal: Refusal };

/** What is selected. Order is the order of selection; the last id is the primary one. */
export interface Selection {
  readonly ids: readonly string[];
  /** Set when a group row is selected; `ids` then holds its features. */
  readonly groupId: string | null;
}

/** The editor's position in time. The window's width is the map's own `settings.timeline.windowMs`. */
export interface TimelineState {
  /**
   * Where the author is looking in time; null is "All time", with no filter.
   * Authoring state only: never saved, never an undo step, and independent of
   * `settings.timeline.enabled`, which only says whether readers get a timeline.
   */
  readonly playhead: IsoDateTime | null;
  readonly playing: boolean;
}

/** Interface state that is not part of the document and is not undone. */
export interface ViewState {
  readonly snapping: boolean;
  readonly listCollapsed: boolean;
  readonly inspectorCollapsed: boolean;
  /** The feature whose vertices are being edited, if any. */
  readonly reshapingId: string | null;
  readonly paletteOpen: boolean;
  readonly shortcutSheetOpen: boolean;
  /** Groups folded in this person's list. Not part of the map: each person folds their own. */
  readonly collapsedGroups: ReadonlySet<string>;
}

/** One undo step. `label` is what the Edit menu shows after "Undo". */
export interface HistoryStep {
  readonly id: number;
  readonly label: Bilingual;
  readonly undo: Patch;
  readonly redo: Patch;
  readonly selectionBefore: Selection;
  readonly selectionAfter: Selection;
  /** Steps with the same key merge while the step is open. */
  readonly coalesceKey: string | null;
  /** Milliseconds; when the step last absorbed a change. */
  readonly touchedAt: number;
  /** False once nothing more may merge into it. */
  readonly open: boolean;
}

export interface HistoryState {
  /** Oldest first; the last entry is what Undo reverts. */
  readonly undo: readonly HistoryStep[];
  /** The last entry is what Redo reapplies. */
  readonly redo: readonly HistoryStep[];
}

/** Where saving stands. The UI switches on `kind` and renders it in place. */
export type SaveState =
  /** Nothing has been attempted since the map was opened. */
  | { kind: "idle" }
  | { kind: "saving"; startedAt: number }
  | { kind: "saved"; at: IsoDateTime; rev: number }
  | { kind: "nothing_to_save" }
  /**
   * Someone else saved first. Offer `reloadTheirs` (the user's work stays
   * reachable through undo) or `save(api, { force: true })` to keep mine.
   */
  | { kind: "stale"; current: { rev: number; updatedBy: string; updatedAt: IsoDateTime } | null }
  | { kind: "quota_exceeded"; reason: string | null }
  /** `retryAt` is epoch milliseconds: the countdown runs to it. */
  | { kind: "rate_limited"; retryAt: number; retryAfterSeconds: number }
  | { kind: "not_permitted"; why: ReadOnlyReason | "forbidden"; reason: string | null }
  | { kind: "signed_out" }
  | { kind: "offline" }
  | { kind: "too_large"; featureCount: number }
  | { kind: "unknown"; message: string };

/** Where publishing stands. */
export type PublishState =
  | { kind: "idle" }
  | { kind: "publishing"; startedAt: number }
  | { kind: "published"; version: number; etag: string; at: number }
  /** The live version already matches the draft. */
  | { kind: "unchanged"; version: number }
  /** The draft had unsaved changes and saving them failed; see the save state. */
  | { kind: "save_failed" }
  | { kind: "quota_exceeded"; reason: string | null }
  | { kind: "rate_limited"; retryAt: number; retryAfterSeconds: number }
  | { kind: "not_permitted"; why: ReadOnlyReason | "forbidden"; reason: string | null }
  | { kind: "signed_out" }
  | { kind: "offline" }
  | { kind: "unknown"; message: string };

/** What the map engine last reported. Changes often; select narrowly. */
export interface LiveState {
  readonly ready: boolean;
  readonly draw: DrawProgress | null;
  readonly pointer: PointerInfo | null;
  readonly viewport: Viewport | null;
  readonly problem: { code: "tiles_failed" | "shape_rejected" | "context_lost"; detail: string } | null;
}

/** Everything the store holds. Immutable; a new object on every change. */
export interface EditorState {
  readonly meta: MapMeta;
  readonly access: Access;
  /** The document being edited. */
  readonly doc: Doc;
  /** The document as last saved or loaded. */
  readonly baseline: Doc;
  readonly selection: Selection;
  readonly tool: ToolId;
  readonly drawDefaults: DrawDefaults;
  readonly timeline: TimelineState;
  readonly view: ViewState;
  readonly history: HistoryState;
  readonly save: SaveState;
  readonly publish: PublishState;
  readonly clipboard: { readonly features: readonly MapFeature[]; readonly style: StyleClipboard | null };
  readonly live: LiveState;
  /** The most recent refused command, for an in-place notice. `seq` distinguishes repeats. */
  readonly refusal: { seq: number; refusal: Refusal } | null;
}
