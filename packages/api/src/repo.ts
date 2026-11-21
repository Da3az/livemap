import { randomUUID } from "node:crypto";
import type {
  BasemapRef,
  MapDoc,
  MapFeature,
  RichText,
  TextDir,
  Viewport,
} from "@livemap/core";
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
  | { readonly status: "forbidden"; readonly reason: string }
  | { readonly status: "quota"; readonly reason: string };

/** One row of the workspace list. Not a MapDoc: no viewport, and it carries a count. */
export interface MapSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: RichText;
  readonly uiDir: TextDir;
  readonly rev: number;
  readonly publishedVersion?: number;
  readonly updatedAt: string;
  readonly featureCount: number;
  readonly archived: boolean;
}

/**
 * What a caller may choose about a new map. No slug and no author: the slug is
 * derived and de-duplicated by the repo, and the author is always the actor.
 */
export interface MapDraft {
  readonly title: RichText;
  readonly uiDir: TextDir;
  readonly viewport: Viewport;
  readonly basemap: BasemapRef;
  readonly features: readonly MapFeature[];
}

export interface CreateLimits {
  readonly maxMaps: number;
}

export interface EditLimits {
  readonly maxFeaturesPerMap: number;
}

export type CreateOutcome =
  | { readonly status: "created"; readonly doc: MapDoc }
  | { readonly status: "quota"; readonly reason: string };

/**
 * The slug is absent on purpose. Artifact keys are `t/<tenant>/m/<slug>/…` and
 * every embed points at one, so renaming a slug would orphan the published
 * history of the map it belonged to.
 */
export interface MapPatch {
  readonly title?: RichText;
  readonly uiDir?: TextDir;
}

export type UpdateOutcome =
  | { readonly status: "updated"; readonly doc: MapDoc }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden"; readonly reason: string };

export type ArchiveOutcome =
  | { readonly status: "ok" }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden"; readonly reason: string };

/**
 * ASCII-only on purpose: the slug becomes part of a URL that is pasted into
 * articles, and a title in Arabic is still a title — it just does not make a
 * usable path segment, so it falls back to "map".
 */
export function featureQuotaReason(limits: EditLimits): string {
  return `a map in this workspace is limited to ${limits.maxFeaturesPerMap} features`;
}

export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return s || "map";
}

/** `base`, or `base-2`, `base-3`… — the first one not already taken. */
export function freeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

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
    limits?: EditLimits,
  ): Promise<EditOutcome>;

  /**
   * The role the database grants this user in this tenant, or null when there
   * is no membership. The token's own role claim is not consulted: a token
   * outlives a demotion, and outlives the tenant itself once a guest workspace
   * is reaped.
   */
  membershipRole(ctx: RepoCtx): Promise<string | null>;

  listMaps(
    ctx: RepoCtx,
    opts: { readonly archived: boolean },
  ): Promise<MapSummary[]>;

  /** Archived maps included — the number a quota is measured against. */
  countMaps(ctx: RepoCtx): Promise<number>;

  /** The map and its starting features land in one transaction, or neither does. */
  createMap(
    ctx: RepoCtx,
    draft: MapDraft,
    limits: CreateLimits,
  ): Promise<CreateOutcome>;

  updateMap(ctx: RepoCtx, mapId: string, patch: MapPatch): Promise<UpdateOutcome>;

  /** Archiving hides a map from the editor. It does not unpublish it. */
  setArchived(
    ctx: RepoCtx,
    mapId: string,
    archived: boolean,
  ): Promise<ArchiveOutcome>;

  /** Newest first. Empty for a map that does not exist. */
  listVersions(ctx: RepoCtx, mapId: string): Promise<VersionRecord[]>;
  getVersion(
    ctx: RepoCtx,
    mapId: string,
    version: number,
  ): Promise<VersionRecord | null>;

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
  private readonly archived = new Set<string>();
  private readonly members = new Map<string, Map<string, string>>();

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

  /** Records a membership. A tenant with none recorded trusts the caller's claim. */
  grant(tenantId: string, userId: string, role: string): void {
    const m = this.members.get(tenantId) ?? new Map<string, string>();
    m.set(userId, role);
    this.members.set(tenantId, m);
  }

  /** Test helper: what the reaper does to a guest tenant. */
  dropTenant(tenantId: string): void {
    this.members.set(tenantId, new Map());
    for (const k of [...this.maps.keys()]) {
      if (!k.startsWith(`${tenantId}/`)) continue;
      this.maps.delete(k);
      this.owners.delete(k);
      this.features.delete(k);
      this.versions.delete(k);
      this.archived.delete(k);
    }
  }

  async membershipRole(ctx: RepoCtx): Promise<string | null> {
    // Fixtures seeded before memberships existed have no table to consult, so
    // an unknown tenant keeps the role it claims. Once a tenant has any
    // membership recorded, the record is the only answer.
    const m = this.members.get(ctx.tenantId);
    if (!m) return ctx.role;
    return m.get(ctx.userId) ?? null;
  }

  private tenantKeys(tenantId: string): string[] {
    return [...this.maps.keys()].filter((k) => k.startsWith(`${tenantId}/`));
  }

  async listMaps(
    ctx: RepoCtx,
    opts: { readonly archived: boolean },
  ): Promise<MapSummary[]> {
    return this.tenantKeys(ctx.tenantId)
      .filter((k) => this.archived.has(k) === opts.archived)
      .map((k) => {
        const d = this.maps.get(k)!;
        return {
          id: d.id,
          slug: d.slug,
          title: d.title,
          uiDir: d.uiDir,
          rev: d.rev,
          ...(d.publishedVersion === undefined
            ? {}
            : { publishedVersion: d.publishedVersion }),
          updatedAt: d.updatedAt,
          featureCount: this.features.get(k)?.size ?? 0,
          archived: opts.archived,
        };
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async countMaps(ctx: RepoCtx): Promise<number> {
    return this.tenantKeys(ctx.tenantId).length;
  }

  async createMap(
    ctx: RepoCtx,
    draft: MapDraft,
    limits: CreateLimits,
  ): Promise<CreateOutcome> {
    const existing = this.tenantKeys(ctx.tenantId);
    if (existing.length >= limits.maxMaps) {
      return {
        status: "quota",
        reason: `this workspace is limited to ${limits.maxMaps} maps`,
      };
    }

    const taken = new Set(existing.map((k) => this.maps.get(k)!.slug));
    const doc: MapDoc = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      slug: freeSlug(slugify(draft.title.value), taken),
      title: draft.title,
      viewport: draft.viewport,
      basemap: draft.basemap,
      uiDir: draft.uiDir,
      updatedAt: new Date().toISOString(),
      rev: 0,
    };
    this.seed(doc, draft.features, { createdBy: ctx.userId });
    return { status: "created", doc };
  }

  async updateMap(
    ctx: RepoCtx,
    mapId: string,
    patch: MapPatch,
  ): Promise<UpdateOutcome> {
    const k = this.key(ctx.tenantId, mapId);
    const doc = this.maps.get(k);
    if (!doc || this.archived.has(k)) return { status: "not_found" };

    const decision = authorizeMapEdit(ctx, {
      createdBy: this.owners.get(k) ?? "",
    });
    if (!decision.allowed) {
      return { status: "forbidden", reason: decision.reason! };
    }

    const next: MapDoc = {
      ...doc,
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.uiDir ? { uiDir: patch.uiDir } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.maps.set(k, next);
    return { status: "updated", doc: next };
  }

  async setArchived(
    ctx: RepoCtx,
    mapId: string,
    archived: boolean,
  ): Promise<ArchiveOutcome> {
    const k = this.key(ctx.tenantId, mapId);
    if (!this.maps.has(k)) return { status: "not_found" };

    const decision = authorizeMapEdit(ctx, {
      createdBy: this.owners.get(k) ?? "",
    });
    if (!decision.allowed) {
      return { status: "forbidden", reason: decision.reason! };
    }

    if (archived) this.archived.add(k);
    else this.archived.delete(k);
    return { status: "ok" };
  }

  async listVersions(ctx: RepoCtx, mapId: string): Promise<VersionRecord[]> {
    return this.allVersions(ctx.tenantId, mapId).reverse();
  }

  async getVersion(
    ctx: RepoCtx,
    mapId: string,
    version: number,
  ): Promise<VersionRecord | null> {
    return (
      this.allVersions(ctx.tenantId, mapId).find((v) => v.version === version) ??
      null
    );
  }

  /** An archived map is invisible to every read below, as it is in Postgres. */
  private live(k: string): MapDoc | undefined {
    return this.archived.has(k) ? undefined : this.maps.get(k);
  }

  async getMap(ctx: RepoCtx, mapId: string): Promise<MapDoc | null> {
    return this.live(this.key(ctx.tenantId, mapId)) ?? null;
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
    limits?: EditLimits,
  ): Promise<EditOutcome> {
    const k = this.key(ctx.tenantId, mapId);
    const doc = this.live(k);
    if (!doc) return { status: "not_found" };

    const decision = authorizeMapEdit(ctx, {
      createdBy: this.owners.get(k) ?? "",
    });
    if (!decision.allowed) {
      return { status: "forbidden", reason: decision.reason! };
    }

    // A stale writer loses rather than clobbering an edit it never saw.
    if (doc.rev !== expectedRev) return { status: "stale" };

    // Applied to a copy, so a refused edit leaves nothing behind — the same
    // all-or-nothing the Postgres transaction gives.
    const feats = new Map(this.features.get(k) ?? []);
    for (const id of remove) feats.delete(id);
    for (const f of put) feats.set(f.id, f);
    if (limits && feats.size > limits.maxFeaturesPerMap) {
      return { status: "quota", reason: featureQuotaReason(limits) };
    }
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
    const doc = this.live(k);
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
    if (!this.live(k)) return null;

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
