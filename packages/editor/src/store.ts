// Nothing may write to the feature map except through `apply()` — that is what
// keeps every change a reversible `Moment`. Saving is explicit, never automatic:
// autosaving on each drag would make the revision guard race itself.

import {
  EMPTY_HISTORY,
  between,
  compareOrder,
  redo as redoMoment,
  transact,
  undo as undoMoment,
  type HistoryState,
  type MapDoc,
  type MapFeature,
  type Moment,
} from "@livemap/core";

export type Listener = () => void;

export interface SaveResult {
  readonly ok: boolean;
  readonly rev?: number;
  readonly error?: string;
}

export interface PublishResult {
  readonly ok: boolean;
  readonly status?: "published" | "unchanged";
  readonly version?: number;
  readonly etag?: string;
  readonly error?: string;
}

export class EditorStore {
  private features = new Map<string, MapFeature>();
  private history: HistoryState = EMPTY_HISTORY;
  private listeners: Listener[] = [];

  private doc: MapDoc | null = null;
  /** Revision the client last saw from the server. Guards every write. */
  private rev = 0;
  private dirty = false;

  selectedId: string | null = null;

  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiBase: string,
    private readonly mapId: string,
    fetchImpl?: typeof fetch,
  ) {
    // Must stay wrapped: calling a bare `fetch` as `this.fetchImpl(...)` passes
    // the store as receiver, which browsers reject with "Illegal invocation".
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Features in render order. */
  list(): MapFeature[] {
    return [...this.features.values()].sort(compareOrder);
  }

  get(id: string): MapFeature | undefined {
    return this.features.get(id);
  }

  get selected(): MapFeature | null {
    return this.selectedId ? (this.features.get(this.selectedId) ?? null) : null;
  }

  get document(): MapDoc | null {
    return this.doc;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get revision(): number {
    return this.rev;
  }

  get canUndo(): boolean {
    return this.history.undo.length > 0;
  }

  get canRedo(): boolean {
    return this.history.redo.length > 0;
  }

  /**
   * The single mutation entry point. `quiet` skips the history push, so a
   * continuous gesture lands in history once rather than per frame.
   */
  apply(moment: Moment, options: { quiet?: boolean } = {}): void {
    const r = transact(this.features, this.history, moment, options);
    this.features = r.state;
    this.history = r.history;
    this.dirty = true;
    this.emit();
  }

  add(feature: MapFeature): void {
    this.apply({ put: [feature] });
    this.select(feature.id);
  }

  update(id: string, patch: Partial<MapFeature>): void {
    const existing = this.features.get(id);
    if (!existing) return;
    // Unchecked by design: a partial patch can't be typed against the union
    // without narrowing per kind. Callers must send fields valid for this kind.
    this.apply({ put: [{ ...existing, ...patch } as MapFeature] });
  }

  remove(id: string): void {
    if (!this.features.has(id)) return;
    this.apply({ delete: [id] });
    if (this.selectedId === id) this.select(null);
  }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit();
  }

  undo(): void {
    const r = undoMoment(this.features, this.history);
    this.features = r.state;
    this.history = r.history;
    this.dirty = true;
    if (this.selectedId && !this.features.has(this.selectedId)) {
      this.selectedId = null;
    }
    this.emit();
  }

  redo(): void {
    const r = redoMoment(this.features, this.history);
    this.features = r.state;
    this.history = r.history;
    this.dirty = true;
    this.emit();
  }

  /** Order key that places a new feature on top of everything. */
  topOrderKey(): string {
    const items = this.list();
    return between(items.length ? items[items.length - 1]!.at : null, null);
  }

  /** One step in z-order. Only the moved feature's key changes — no sibling renumbering. */
  reorder(id: string, direction: "up" | "down"): void {
    const items = this.list();
    const i = items.findIndex((f) => f.id === id);
    if (i < 0) return;

    if (direction === "up") {
      if (i >= items.length - 1) return;
      const above = items[i + 1]!;
      const aboveNext = items[i + 2] ?? null;
      this.update(id, { at: between(above.at, aboveNext?.at ?? null) });
    } else {
      if (i === 0) return;
      const below = items[i - 1]!;
      const belowPrev = items[i - 2] ?? null;
      this.update(id, { at: between(belowPrev?.at ?? null, below.at) });
    }
  }

  duplicate(id: string): void {
    const f = this.features.get(id);
    if (!f) return;
    const copy = {
      ...f,
      id: newId(f.kind),
      at: this.topOrderKey(),
      ...(f.label ? { label: { ...f.label, value: `${f.label.value} copy` } } : {}),
    } as MapFeature;
    this.add(copy);
  }

  async load(): Promise<void> {
    const res = await this.fetchImpl(`${this.apiBase}/api/v1/maps/${this.mapId}`);
    if (!res.ok) throw new Error(`load failed: ${res.status}`);
    const body = (await res.json()) as { map: MapDoc; features: MapFeature[] };

    this.doc = body.map;
    this.rev = body.map.rev;
    this.features = new Map(body.features.map((f) => [f.id, f]));
    // Must reset: history kept across a load would undo into a state the
    // server never had.
    this.history = EMPTY_HISTORY;
    this.dirty = false;
    this.emit();
  }

  /**
   * Sends every feature, not a diff — fine at tens of features, and the `rev`
   * guard keeps the write atomic. Revisit if maps grow large.
   */
  async save(): Promise<SaveResult> {
    const current = this.list();
    const serverIds = new Set(current.map((f) => f.id));
    const removed = [...this.deletedSinceLoad].filter((id) => !serverIds.has(id));

    const res = await this.fetchImpl(`${this.apiBase}/api/v1/maps/${this.mapId}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: this.rev, put: current, delete: removed }),
    });

    if (res.status === 409) {
      return {
        ok: false,
        error: "Someone else edited this map. Reload to get their changes.",
      };
    }
    if (!res.ok) {
      return { ok: false, error: await refusal(res, "Save failed") };
    }

    const body = (await res.json()) as { rev: number };
    this.rev = body.rev;
    this.dirty = false;
    this.deletedSinceLoad.clear();
    this.emit();
    return { ok: true, rev: body.rev };
  }

  async publish(): Promise<PublishResult> {
    if (this.dirty) {
      const saved = await this.save();
      if (!saved.ok) return { ok: false, ...(saved.error ? { error: saved.error } : {}) };
    }

    // No content-type header on purpose: Fastify 400s a request that declares
    // JSON and then sends an empty body.
    const res = await this.fetchImpl(
      `${this.apiBase}/api/v1/maps/${this.mapId}/publish`,
      { method: "POST" },
    );
    if (!res.ok) {
      return { ok: false, error: await refusal(res, "Publish failed") };
    }
    const body = (await res.json()) as Record<string, unknown>;

    // Kept in step here rather than by reloading: a reload would also reset
    // the undo history.
    const version = body["version"];
    if (this.doc && typeof version === "number") {
      this.doc = { ...this.doc, publishedVersion: version };
    }
    this.emit();
    const etag = body["etag"];
    return {
      ok: true,
      status: body["status"] as "published" | "unchanged",
      version: body["version"] as number,
      // Omitted, not set to undefined: `exactOptionalPropertyTypes` is on.
      ...(typeof etag === "string" ? { etag } : {}),
    };
  }

  /** Ids deleted locally, so a save can tell the server to drop them. */
  private readonly deletedSinceLoad = new Set<string>();

  markDeleted(id: string): void {
    this.deletedSinceLoad.add(id);
  }
}

/**
 * Turns a refusal into a sentence. The server says why in `reason` (a quota,
 * a role) or `message` (a rejected body), and a rate limit says when to come
 * back; a bare status code tells an author none of that.
 */
async function refusal(res: Response, what: string): Promise<string> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // Not JSON — a proxy's error page. The status is all there is.
  }
  if (res.status === 429) {
    const wait = res.headers.get("retry-after");
    return wait
      ? `Too many requests. Try again in ${wait}s.`
      : "Too many requests. Try again shortly.";
  }
  const why = body["reason"] ?? body["message"];
  return typeof why === "string" ? `${what}: ${why}` : `${what} (${res.status}).`;
}

let counter = 0;

export function newId(kind: string): string {
  counter += 1;
  return `${kind}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
