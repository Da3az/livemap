import type { EditRequest } from "@/api/client";
import type { IsoDateTime, MapDoc, MapFeature, MapSettings, RichText } from "@/model/types";
import { sortKeyed } from "./ordering";

/** Direction of the editor chrome: the map's `uiDir`. */
export type UiDir = MapDoc["uiDir"];

/**
 * The part of a map the user edits and undo restores. Immutable: every change
 * produces a new `Doc` that shares whatever did not change.
 */
export interface Doc {
  readonly title: RichText;
  readonly uiDir: UiDir;
  readonly settings: MapSettings;
  readonly features: ReadonlyMap<string, MapFeature>;
}

/** A set of replacements. A feature mapped to null is removed. */
export interface Patch {
  readonly features: ReadonlyMap<string, MapFeature | null>;
  readonly settings?: MapSettings;
  readonly title?: RichText;
  readonly uiDir?: UiDir;
}

/** Build a `Doc` from what the API returns. */
export function docFrom(map: Pick<MapDoc, "title" | "uiDir" | "settings">, features: readonly MapFeature[]): Doc {
  const byId = new Map<string, MapFeature>();
  for (const feature of features) byId.set(feature.id, feature);
  return { title: map.title, uiDir: map.uiDir, settings: map.settings, features: byId };
}

/** Structural equality for the plain JSON values the model is made of. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const left: Record<string, unknown> = { ...a };
  const right: Record<string, unknown> = { ...b };
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(right, key) || !deepEqual(left[key], right[key])) return false;
  }
  return true;
}

/** Two features are the same apart from who touched them last and when. */
export function sameFeature(a: MapFeature, b: MapFeature): boolean {
  if (a === b) return true;
  return deepEqual({ ...a, updatedAt: "", updatedBy: "" }, { ...b, updatedAt: "", updatedBy: "" });
}

/** Apply a patch, sharing everything it does not mention. */
export function applyPatch(doc: Doc, patch: Patch): Doc {
  let features = doc.features;
  if (patch.features.size > 0) {
    const next = new Map(doc.features);
    for (const [id, feature] of patch.features) {
      if (feature === null) next.delete(id);
      else next.set(id, feature);
    }
    features = next;
  }
  return {
    title: patch.title ?? doc.title,
    uiDir: patch.uiDir ?? doc.uiDir,
    settings: patch.settings ?? doc.settings,
    features,
  };
}

/** Lay `later` over `earlier`: the result of applying one and then the other. */
export function mergePatches(earlier: Patch, later: Patch): Patch {
  const features = new Map(earlier.features);
  for (const [id, feature] of later.features) features.set(id, feature);
  return {
    features,
    ...pickDefined("settings", later.settings ?? earlier.settings),
    ...pickDefined("title", later.title ?? earlier.title),
    ...pickDefined("uiDir", later.uiDir ?? earlier.uiDir),
  };
}

function pickDefined<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  const out: { [P in K]?: V } = {};
  if (value !== undefined) out[key] = value;
  return out;
}

/** What a finished `Draft` hands back: the new document and both directions of the change. */
export interface DraftResult {
  doc: Doc;
  undo: Patch;
  redo: Patch;
  /** Ids created by this change. */
  added: string[];
  /** Ids removed by this change. */
  removed: string[];
}

/**
 * A mutable view over a `Doc` for the duration of one command. It records what
 * was touched, so the command's undo step holds only that.
 */
export class Draft {
  readonly base: Doc;
  title: RichText;
  uiDir: UiDir;
  settings: MapSettings;
  private readonly stampAt: IsoDateTime;
  private readonly stampBy: string;
  private current: Map<string, MapFeature> | null = null;
  private readonly touched = new Set<string>();
  private sortedCache: MapFeature[] | null = null;

  constructor(base: Doc, stamp: { at: IsoDateTime; by: string }) {
    this.base = base;
    this.title = base.title;
    this.uiDir = base.uiDir;
    this.settings = base.settings;
    this.stampAt = stamp.at;
    this.stampBy = stamp.by;
  }

  get(id: string): MapFeature | undefined {
    return (this.current ?? this.base.features).get(id);
  }

  has(id: string): boolean {
    return (this.current ?? this.base.features).has(id);
  }

  get size(): number {
    return (this.current ?? this.base.features).size;
  }

  values(): IterableIterator<MapFeature> {
    return (this.current ?? this.base.features).values();
  }

  /** Features in ascending draw order (bottom first). */
  sorted(): MapFeature[] {
    this.sortedCache ??= sortKeyed(this.values());
    return this.sortedCache;
  }

  private writable(): Map<string, MapFeature> {
    this.current ??= new Map(this.base.features);
    this.sortedCache = null;
    return this.current;
  }

  /** Create or replace a feature, stamping who and when. A no-op when nothing but the stamp would change. */
  put(feature: MapFeature): void {
    const existing = this.get(feature.id);
    if (existing !== undefined && sameFeature(existing, feature)) return;
    this.putExact({ ...feature, updatedAt: this.stampAt, updatedBy: this.stampBy });
  }

  /** Create or replace a feature exactly as given (reloading someone else's version). */
  putExact(feature: MapFeature): void {
    this.writable().set(feature.id, feature);
    this.touched.add(feature.id);
  }

  remove(id: string): void {
    if (!this.has(id)) return;
    this.writable().delete(id);
    this.touched.add(id);
  }

  /** null when the command changed nothing. */
  finish(): DraftResult | null {
    const undo = new Map<string, MapFeature | null>();
    const redo = new Map<string, MapFeature | null>();
    const added: string[] = [];
    const removed: string[] = [];
    for (const id of this.touched) {
      const before = this.base.features.get(id) ?? null;
      const after = this.current?.get(id) ?? null;
      if (before === after) continue;
      undo.set(id, before);
      redo.set(id, after);
      if (before === null) added.push(id);
      if (after === null) removed.push(id);
    }
    const settingsChanged = this.settings !== this.base.settings;
    const titleChanged = this.title !== this.base.title;
    const dirChanged = this.uiDir !== this.base.uiDir;
    if (undo.size === 0 && !settingsChanged && !titleChanged && !dirChanged) return null;
    const undoPatch: Patch = {
      features: undo,
      ...(settingsChanged ? { settings: this.base.settings } : {}),
      ...(titleChanged ? { title: this.base.title } : {}),
      ...(dirChanged ? { uiDir: this.base.uiDir } : {}),
    };
    const redoPatch: Patch = {
      features: redo,
      ...(settingsChanged ? { settings: this.settings } : {}),
      ...(titleChanged ? { title: this.title } : {}),
      ...(dirChanged ? { uiDir: this.uiDir } : {}),
    };
    return { doc: applyPatch(this.base, redoPatch), undo: undoPatch, redo: redoPatch, added, removed };
  }
}

/** What differs between the document and the last saved state. */
export interface ChangeSet {
  /** Features created or changed since the last save, whole. */
  put: MapFeature[];
  /** Ids deleted since the last save. */
  delete: string[];
  /** The settings, when any of them changed; otherwise null. */
  settings: MapSettings | null;
  title: RichText | null;
  uiDir: UiDir | null;
  /** True when there is nothing to save. */
  empty: boolean;
}

/** The pending change set of `doc` against `baseline`. */
export function changeSet(baseline: Doc, doc: Doc): ChangeSet {
  const put: MapFeature[] = [];
  const removed: string[] = [];
  if (doc.features !== baseline.features) {
    for (const [id, feature] of doc.features) {
      const saved = baseline.features.get(id);
      if (saved === undefined || !sameFeature(saved, feature)) put.push(feature);
    }
    for (const id of baseline.features.keys()) if (!doc.features.has(id)) removed.push(id);
  }
  const settings = doc.settings !== baseline.settings && !deepEqual(doc.settings, baseline.settings) ? doc.settings : null;
  const title = deepEqual(doc.title, baseline.title) ? null : doc.title;
  const uiDir = doc.uiDir === baseline.uiDir ? null : doc.uiDir;
  return {
    put,
    delete: removed,
    settings,
    title,
    uiDir,
    empty: put.length === 0 && removed.length === 0 && settings === null && title === null && uiDir === null,
  };
}

/** The request body for a change set. */
export function toEditRequest(changes: ChangeSet, rev: number, force: boolean): EditRequest {
  return {
    rev,
    put: changes.put,
    delete: changes.delete,
    ...(changes.settings !== null ? { settings: changes.settings } : {}),
    ...(changes.title !== null ? { title: changes.title } : {}),
    ...(changes.uiDir !== null ? { uiDir: changes.uiDir } : {}),
    ...(force ? { force: true } : {}),
  };
}
