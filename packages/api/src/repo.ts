import type { MapDoc, MapFeature } from "@livemap/core";
import { authorizeMapEdit } from "./authz.js";

/**
 * Who is acting. Every repo call takes one, and `PostgresRepo` turns it into
 * the three transaction-local GUCs the policies in
 * migrations/0002_role_aware_rls.sql read: app.tenant_id, app.user_id and
 * app.role.
 *
 * It is a struct rather than three positional arguments because the role is the
 * part that is easy to forget, and forgetting it is not a visible bug — the
 * policies simply deny the write. A missing field is a type error instead.
 */
export interface RepoCtx {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
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

/**
 * A version record minus the two fields the repo assigns. The version number in
 * particular is allocated inside the transaction that inserts the row, so a
 * caller cannot know it up front.
 */
export type VersionDraft = Omit<VersionRecord, "version" | "mapId">;

/**
 * Why this is a union rather than `number | null`.
 *
 * `null` used to mean both "stale revision" and "no such map", and once a
 * contributor can be refused by ownership it would have meant "forbidden" too.
 * All three became 409 stale_revision at the route, which is wrong twice: it
 * tells a client to retry a request that will never succeed, and it hides a
 * permission failure behind a concurrency one.
 */
export type EditOutcome =
  | { readonly status: "applied"; readonly rev: number }
  | { readonly status: "stale" }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden"; readonly reason: string };

/** Everything a publish needs to read, from one consistent snapshot. */
export interface PublishSnapshot {
  readonly doc: MapDoc;
  /** Not part of MapDoc: a published artifact must not carry an author's id. */
  readonly createdBy: string;
  readonly features: MapFeature[];
  readonly latest: VersionRecord | null;
}

export interface MapRepo {
  getMap(ctx: RepoCtx, mapId: string): Promise<MapDoc | null>;
  listFeatures(ctx: RepoCtx, mapId: string): Promise<MapFeature[]>;

  /**
   * Atomic, guarded by the revision the caller read, and authorised against the
   * map row it locks.
   */
  applyEdit(
    ctx: RepoCtx,
    mapId: string,
    expectedRev: number,
    put: readonly MapFeature[],
    remove: readonly string[],
  ): Promise<EditOutcome>;

  /**
   * One transaction: the document, its features and the newest recorded version
   * all read from the same snapshot. Three separate reads could see a concurrent
   * edit land between them and publish a map that never existed.
   */
  loadForPublish(ctx: RepoCtx, mapId: string): Promise<PublishSnapshot | null>;

  /**
   * Allocates the next version number and inserts the ledger row in ONE
   * transaction, serialised against concurrent publishers.
   *
   * `build` is called with the allocated number while that transaction is open,
   * because the artifact's storage key and byte size both depend on the version
   * and so cannot be computed before it is known. It must be pure and must not
   * touch the database.
   *
   * Returns null when the map is gone.
   */
  recordNextVersion(
    ctx: RepoCtx,
    mapId: string,
    build: (version: number) => VersionDraft,
  ): Promise<VersionRecord | null>;

  getLatestVersion(ctx: RepoCtx, mapId: string): Promise<VersionRecord | null>;
  setPublishedVersion(ctx: RepoCtx, mapId: string, version: number): Promise<void>;
}

/**
 * In-memory implementation, for tests and the local dev server.
 *
 * It mirrors the ownership rule, because routes depend on telling 403 from 409
 * and that distinction has to be testable without a database. It does NOT
 * mirror the role policies — those are the database's job, and faking them here
 * would let a test pass against a double while the real policies disagreed.
 * `test/postgres.test.ts` is where the policies themselves are proven.
 */
export class MemoryMapRepo implements MapRepo {
  private readonly maps = new Map<string, MapDoc>();
  private readonly owners = new Map<string, string>();
  private readonly features = new Map<string, Map<string, MapFeature>>();
  private readonly versions = new Map<string, VersionRecord[]>();

  private key(tenantId: string, mapId: string): string {
    return `${tenantId}/${mapId}`;
  }

  seed(
    doc: MapDoc,
    features: readonly MapFeature[],
    opts: { readonly createdBy?: string } = {},
  ): void {
    const k = this.key(doc.tenantId, doc.id);
    this.maps.set(k, doc);
    this.owners.set(k, opts.createdBy ?? "u-seed");
    this.features.set(k, new Map(features.map((f) => [f.id, f])));
  }

  async getMap(ctx: RepoCtx, mapId: string): Promise<MapDoc | null> {
    return this.maps.get(this.key(ctx.tenantId, mapId)) ?? null;
  }

  async listFeatures(ctx: RepoCtx, mapId: string): Promise<MapFeature[]> {
    const m = this.features.get(this.key(ctx.tenantId, mapId));
    return m ? [...m.values()] : [];
  }

  async applyEdit(
    ctx: RepoCtx,
    mapId: string,
    expectedRev: number,
    put: readonly MapFeature[],
    remove: readonly string[],
  ): Promise<EditOutcome> {
    const k = this.key(ctx.tenantId, mapId);
    const doc = this.maps.get(k);
    if (!doc) return { status: "not_found" };

    const decision = authorizeMapEdit(ctx, {
      createdBy: this.owners.get(k) ?? "",
    });
    if (!decision.allowed) {
      return { status: "forbidden", reason: decision.reason! };
    }

    // A stale writer loses rather than clobbering an edit it never saw.
    if (doc.rev !== expectedRev) return { status: "stale" };

    const feats = this.features.get(k) ?? new Map<string, MapFeature>();
    for (const id of remove) feats.delete(id);
    for (const f of put) feats.set(f.id, f);
    this.features.set(k, feats);

    const rev = doc.rev + 1;
    this.maps.set(k, { ...doc, rev, updatedAt: new Date().toISOString() });
    return { status: "applied", rev };
  }

  async loadForPublish(
    ctx: RepoCtx,
    mapId: string,
  ): Promise<PublishSnapshot | null> {
    const k = this.key(ctx.tenantId, mapId);
    const doc = this.maps.get(k);
    if (!doc) return null;
    return {
      doc,
      createdBy: this.owners.get(k) ?? "",
      features: await this.listFeatures(ctx, mapId),
      latest: await this.getLatestVersion(ctx, mapId),
    };
  }

  async recordNextVersion(
    ctx: RepoCtx,
    mapId: string,
    build: (version: number) => VersionDraft,
  ): Promise<VersionRecord | null> {
    const k = this.key(ctx.tenantId, mapId);
    if (!this.maps.has(k)) return null;

    const list = this.versions.get(k) ?? [];
    const version =
      list.length === 0 ? 1 : Math.max(...list.map((v) => v.version)) + 1;
    const record: VersionRecord = { ...build(version), mapId, version };
    list.push(record);
    this.versions.set(k, list);
    return record;
  }

  async getLatestVersion(
    ctx: RepoCtx,
    mapId: string,
  ): Promise<VersionRecord | null> {
    const list = this.versions.get(this.key(ctx.tenantId, mapId)) ?? [];
    if (list.length === 0) return null;
    return list.reduce((a, b) => (a.version > b.version ? a : b));
  }

  async setPublishedVersion(
    ctx: RepoCtx,
    mapId: string,
    version: number,
  ): Promise<void> {
    const k = this.key(ctx.tenantId, mapId);
    const doc = this.maps.get(k);
    if (doc) this.maps.set(k, { ...doc, publishedVersion: version });
  }

  /** Test helper: all recorded versions for a map, ascending. */
  allVersions(tenantId: string, mapId: string): VersionRecord[] {
    return [...(this.versions.get(this.key(tenantId, mapId)) ?? [])].sort(
      (a, b) => a.version - b.version,
    );
  }
}
