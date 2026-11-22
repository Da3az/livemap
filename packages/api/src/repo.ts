import { randomUUID } from "node:crypto";
import {
  applySettingsPatch,
  type CurrentRevision,
  type MapDoc,
  type MapFeature,
  type MapSettings,
  type MapSummary,
  type RichText,
  type SettingsPatch,
  type TextDir,
} from "@livemap/core";
import { authorizeMapEdit, can } from "./authz.js";

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

/** Shown wherever a name is due for someone who is no longer a member of the workspace. */
export const FORMER_MEMBER = "Former member";

export type VersionOrigin =
  | { readonly type: "publish"; readonly rev: number }
  | { readonly type: "rollback"; readonly fromVersion: number };

/** One row of the version ledger, with the publisher's name resolved. */
export interface VersionRow {
  readonly mapId: string;
  readonly version: number;
  readonly etag: string;
  readonly storageKey: string;
  readonly byteSize: number;
  readonly featureCount: number;
  readonly publishedAt: string;
  readonly publishedBy: { readonly userId: string; readonly name: string };
  /** The draft revision this version's content was built from. A rollback copies its source's. */
  readonly sourceRev: number;
  readonly origin: VersionOrigin;
}

/**
 * What the publish pipeline hands the ledger. The version number is allocated
 * inside the transaction that inserts the row, so a caller cannot know it up
 * front; the publisher is always the actor.
 */
export type VersionDraft = Omit<VersionRow, "version" | "mapId" | "publishedBy">;

export interface EditInput {
  /** The revision the edit was made against. */
  readonly rev: number;
  /** Apply even when `rev` is stale. Only what this edit names is overwritten. */
  readonly force: boolean;
  readonly put: readonly MapFeature[];
  readonly delete: readonly string[];
  readonly settings?: SettingsPatch;
  readonly title?: RichText;
  readonly uiDir?: Exclude<TextDir, "auto">;
}

/**
 * Why this is a union rather than `number | null`: a stale revision, a missing
 * map, a refusal, a full quota and a broken reference each need a different
 * answer, and only one of them is worth retrying.
 */
export type EditOutcome =
  | { readonly status: "applied"; readonly rev: number; readonly updatedAt: string }
  | { readonly status: "stale"; readonly current: CurrentRevision }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden"; readonly reason: string }
  | { readonly status: "quota"; readonly reason: string }
  | { readonly status: "invalid"; readonly reason: string };

export interface NewMap {
  readonly title: RichText;
  readonly uiDir: Exclude<TextDir, "auto">;
  readonly settings: MapSettings;
}

export interface CreateLimits {
  readonly maxMaps: number;
}

export interface EditLimits {
  readonly maxFeaturesPerMap: number;
}

export type CreateOutcome =
  | { readonly status: "created"; readonly map: MapDoc }
  | { readonly status: "quota"; readonly reason: string };

export type ArchiveOutcome =
  | { readonly status: "ok" }
  | { readonly status: "not_found" }
  | { readonly status: "forbidden"; readonly reason: string }
  | { readonly status: "quota"; readonly reason: string };

export interface SessionInfo {
  readonly userName: string;
  readonly tenantName: string;
}

/** Everything a publish needs to read, from one consistent snapshot. */
export interface PublishSnapshot {
  readonly doc: MapDoc;
  readonly features: MapFeature[];
  readonly latest: VersionRow | null;
}

export function featureQuotaReason(limits: EditLimits, wouldBe: number): string {
  return `A map in this workspace can hold ${limits.maxFeaturesPerMap.toLocaleString("en")} features; this save would make ${wouldBe.toLocaleString("en")}.`;
}

export function mapQuotaReason(limits: CreateLimits): string {
  return `This workspace can hold ${limits.maxMaps.toLocaleString("en")} maps that are not archived. Archive one to make room.`;
}

export const ARCHIVED_REASON = "This map is archived. Restore it before editing or publishing it.";

/**
 * Every feature's group and preset must exist in the map's settings. Checked
 * against the whole map after a write, not only the features the write named:
 * a settings change can delete a group that unsaved-by-this-request features
 * still point at.
 */
export function referenceProblem(settings: MapSettings, features: Iterable<MapFeature>): string | null {
  const groups = new Set(settings.groups.map((group) => group.id));
  const presets = new Set(settings.presets.map((preset) => preset.id));
  for (const feature of features) {
    if (feature.groupId !== null && !groups.has(feature.groupId)) {
      return `Feature "${feature.id}" is in group "${feature.groupId}", which this map does not have.`;
    }
    if (feature.presetId !== null && !presets.has(feature.presetId)) {
      return `Feature "${feature.id}" uses preset "${feature.presetId}", which this map does not have.`;
    }
  }
  return null;
}

/**
 * ASCII-only on purpose: the slug becomes part of a URL that is pasted into
 * articles, and a title in Arabic is still a title — it just does not make a
 * usable path segment, so it falls back to "map".
 */
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

export interface MapRepo {
  /**
   * The role the database grants this user in this tenant, or null when there
   * is no membership. The token's own role claim is not consulted: a token
   * outlives a demotion, and outlives the tenant itself once a guest workspace
   * is reaped.
   */
  membershipRole(ctx: RepoCtx): Promise<string | null>;
  sessionInfo(ctx: RepoCtx): Promise<SessionInfo>;

  listMaps(ctx: RepoCtx, opts: { readonly archived: boolean }): Promise<MapSummary[]>;
  /** Maps that are not archived: the number the map quota is measured against. */
  countMaps(ctx: RepoCtx): Promise<number>;
  createMap(ctx: RepoCtx, map: NewMap, limits: CreateLimits): Promise<CreateOutcome>;
  /** Archived maps included: they stay readable, and refuse edits. */
  getMap(ctx: RepoCtx, mapId: string): Promise<{ map: MapDoc; features: MapFeature[] } | null>;

  /** Atomic, guarded by the revision the caller read unless forced, and authorised against the map row. */
  applyEdit(ctx: RepoCtx, mapId: string, edit: EditInput, limits: EditLimits): Promise<EditOutcome>;

  /** Archiving hides a map from the workspace list. It does not unpublish it. */
  setArchived(ctx: RepoCtx, mapId: string, archived: boolean, limits: CreateLimits): Promise<ArchiveOutcome>;

  /** Newest first. Empty for a map that does not exist. */
  listVersions(ctx: RepoCtx, mapId: string): Promise<VersionRow[]>;
  getVersion(ctx: RepoCtx, mapId: string, version: number): Promise<VersionRow | null>;
  getLatestVersion(ctx: RepoCtx, mapId: string): Promise<VersionRow | null>;

  /** The document, its features and the newest version, all from one snapshot. */
  loadForPublish(ctx: RepoCtx, mapId: string): Promise<PublishSnapshot | null>;

  /**
   * Allocates the next version number and inserts the ledger row in ONE
   * transaction, serialised against concurrent publishers. `build` is called
   * with the allocated number while that transaction is open, because the
   * artifact's storage key and byte size depend on it; it must not touch the
   * database. Returns null when the map is gone.
   */
  recordNextVersion(ctx: RepoCtx, mapId: string, build: (version: number) => VersionDraft): Promise<VersionRow | null>;

  /**
   * Points the map at a version, records which draft revision is live, and
   * runs `writePointer` while the per-map lock is held. Guarded so a slower,
   * older publish can never move the map — or the pointer readers poll —
   * backwards: when a newer version is already live, nothing is written and
   * the answer is false. If `writePointer` fails, the map is not repointed.
   */
  setPublished(
    ctx: RepoCtx,
    mapId: string,
    live: { readonly version: number; readonly rev: number },
    writePointer: () => Promise<void>,
  ): Promise<boolean>;

  /**
   * Records that an unchanged publish confirmed the draft at `rev`: the live
   * version stays, and the draft up to `rev` counts as published.
   */
  confirmPublishedRev(ctx: RepoCtx, mapId: string, live: { readonly version: number; readonly rev: number }): Promise<void>;
}

interface MemoryMap {
  doc: MapDoc;
  createdBy: string;
  updatedBy: string;
  features: Map<string, MapFeature & { updatedById: string }>;
  versions: VersionRow[];
}

/**
 * In-memory implementation, for the local demo and development.
 *
 * It mirrors the ownership and archive rules, because routes depend on telling
 * 403 from 409. It does NOT mirror the role policies — those are the
 * database's job; `PostgresRepo` is the one that proves them.
 */
export class MemoryMapRepo implements MapRepo {
  private readonly maps = new Map<string, MemoryMap>();
  private readonly members = new Map<string, Map<string, string>>();
  private readonly people = new Map<string, string>();
  private readonly tenants = new Map<string, string>();

  private key(tenantId: string, mapId: string): string {
    return `${tenantId}/${mapId}`;
  }

  /** Records a membership, with the names `/me` and the ledger show. */
  grant(tenantId: string, userId: string, role: string, names: { readonly user?: string; readonly tenant?: string } = {}): void {
    const m = this.members.get(tenantId) ?? new Map<string, string>();
    m.set(userId, role);
    this.members.set(tenantId, m);
    if (names.user) this.people.set(userId, names.user);
    if (names.tenant) this.tenants.set(tenantId, names.tenant);
  }

  /** What the reaper does to a guest tenant. */
  dropTenant(tenantId: string): void {
    this.members.set(tenantId, new Map());
    for (const k of [...this.maps.keys()]) if (k.startsWith(`${tenantId}/`)) this.maps.delete(k);
  }

  private nameOf(tenantId: string, userId: string): string {
    const member = this.members.get(tenantId)?.has(userId) ?? false;
    return member ? (this.people.get(userId) ?? FORMER_MEMBER) : FORMER_MEMBER;
  }

  private publicFeature(tenantId: string, feature: MapFeature & { updatedById: string }): MapFeature {
    const { updatedById, ...rest } = feature;
    return { ...rest, updatedBy: this.nameOf(tenantId, updatedById) } as MapFeature;
  }

  private publicDoc(tenantId: string, entry: MemoryMap): MapDoc {
    return {
      ...entry.doc,
      updatedBy: this.nameOf(tenantId, entry.updatedBy),
      createdBy: { userId: entry.createdBy, name: this.nameOf(tenantId, entry.createdBy) },
    };
  }

  async membershipRole(ctx: RepoCtx): Promise<string | null> {
    return this.members.get(ctx.tenantId)?.get(ctx.userId) ?? null;
  }

  async sessionInfo(ctx: RepoCtx): Promise<SessionInfo> {
    return { userName: this.nameOf(ctx.tenantId, ctx.userId), tenantName: this.tenants.get(ctx.tenantId) ?? "Workspace" };
  }

  private tenantMaps(tenantId: string): MemoryMap[] {
    return [...this.maps.entries()].filter(([k]) => k.startsWith(`${tenantId}/`)).map(([, v]) => v);
  }

  async listMaps(ctx: RepoCtx, opts: { readonly archived: boolean }): Promise<MapSummary[]> {
    return this.tenantMaps(ctx.tenantId)
      .filter((entry) => entry.doc.archived === opts.archived)
      .map((entry): MapSummary => {
        const doc = this.publicDoc(ctx.tenantId, entry);
        return {
          id: doc.id,
          slug: doc.slug,
          title: doc.title,
          uiDir: doc.uiDir,
          rev: doc.rev,
          publishedVersion: doc.publishedVersion,
          publishedRev: doc.publishedRev,
          updatedAt: doc.updatedAt,
          updatedBy: doc.updatedBy,
          createdBy: doc.createdBy,
          featureCount: entry.features.size,
          archived: doc.archived,
          thumbnail: { center: doc.settings.openingView.center, zoom: doc.settings.openingView.zoom, basemap: doc.settings.basemap.styleId },
        };
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async countMaps(ctx: RepoCtx): Promise<number> {
    return this.tenantMaps(ctx.tenantId).filter((entry) => !entry.doc.archived).length;
  }

  async createMap(ctx: RepoCtx, map: NewMap, limits: CreateLimits): Promise<CreateOutcome> {
    if ((await this.countMaps(ctx)) >= limits.maxMaps) return { status: "quota", reason: mapQuotaReason(limits) };
    const taken = new Set(this.tenantMaps(ctx.tenantId).map((entry) => entry.doc.slug));
    const now = new Date().toISOString();
    const id = randomUUID();
    const entry: MemoryMap = {
      doc: {
        id,
        tenantId: ctx.tenantId,
        slug: freeSlug(slugify(map.title.value), taken),
        title: map.title,
        uiDir: map.uiDir,
        settings: map.settings,
        rev: 0,
        publishedVersion: null,
        publishedRev: null,
        archived: false,
        updatedAt: now,
        updatedBy: ctx.userId,
        createdBy: { userId: ctx.userId, name: "" },
      },
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
      features: new Map(),
      versions: [],
    };
    this.maps.set(this.key(ctx.tenantId, id), entry);
    return { status: "created", map: this.publicDoc(ctx.tenantId, entry) };
  }

  async getMap(ctx: RepoCtx, mapId: string): Promise<{ map: MapDoc; features: MapFeature[] } | null> {
    const entry = this.maps.get(this.key(ctx.tenantId, mapId));
    if (!entry) return null;
    return {
      map: this.publicDoc(ctx.tenantId, entry),
      features: [...entry.features.values()].map((feature) => this.publicFeature(ctx.tenantId, feature)),
    };
  }

  async applyEdit(ctx: RepoCtx, mapId: string, edit: EditInput, limits: EditLimits): Promise<EditOutcome> {
    const entry = this.maps.get(this.key(ctx.tenantId, mapId));
    if (!entry) return { status: "not_found" };
    const decision = authorizeMapEdit(ctx, { createdBy: entry.createdBy });
    if (!decision.allowed) return { status: "forbidden", reason: decision.reason! };
    if (entry.doc.archived) return { status: "forbidden", reason: ARCHIVED_REASON };
    if (!edit.force && entry.doc.rev !== edit.rev) {
      return {
        status: "stale",
        current: { rev: entry.doc.rev, updatedBy: this.nameOf(ctx.tenantId, entry.updatedBy), updatedAt: entry.doc.updatedAt },
      };
    }

    // Applied to copies, so a refused edit leaves nothing behind — the same
    // all-or-nothing the Postgres transaction gives.
    const now = new Date().toISOString();
    const features = new Map(entry.features);
    for (const id of edit.delete) features.delete(id);
    for (const feature of edit.put) features.set(feature.id, { ...feature, updatedAt: now, updatedById: ctx.userId });
    if (features.size > limits.maxFeaturesPerMap) {
      return { status: "quota", reason: featureQuotaReason(limits, features.size) };
    }
    const settings = edit.settings ? applySettingsPatch(entry.doc.settings, edit.settings) : entry.doc.settings;
    const problem = referenceProblem(settings, features.values());
    if (problem) return { status: "invalid", reason: problem };

    entry.features = features;
    entry.updatedBy = ctx.userId;
    entry.doc = {
      ...entry.doc,
      settings,
      ...(edit.title ? { title: edit.title } : {}),
      ...(edit.uiDir ? { uiDir: edit.uiDir } : {}),
      rev: entry.doc.rev + 1,
      updatedAt: now,
    };
    return { status: "applied", rev: entry.doc.rev, updatedAt: now };
  }

  async setArchived(ctx: RepoCtx, mapId: string, archived: boolean, limits: CreateLimits): Promise<ArchiveOutcome> {
    const entry = this.maps.get(this.key(ctx.tenantId, mapId));
    if (!entry) return { status: "not_found" };
    if (!can(ctx.role, "map:archive")) {
      return { status: "forbidden", reason: "Only an owner or an admin of this workspace can archive or restore maps." };
    }
    if (entry.doc.archived === archived) return { status: "ok" };
    if (!archived && (await this.countMaps(ctx)) >= limits.maxMaps) return { status: "quota", reason: mapQuotaReason(limits) };
    entry.doc = { ...entry.doc, archived };
    return { status: "ok" };
  }

  private withName(tenantId: string, row: VersionRow): VersionRow {
    return { ...row, publishedBy: { userId: row.publishedBy.userId, name: this.nameOf(tenantId, row.publishedBy.userId) } };
  }

  async listVersions(ctx: RepoCtx, mapId: string): Promise<VersionRow[]> {
    const entry = this.maps.get(this.key(ctx.tenantId, mapId));
    return entry ? [...entry.versions].sort((a, b) => b.version - a.version).map((row) => this.withName(ctx.tenantId, row)) : [];
  }

  async getVersion(ctx: RepoCtx, mapId: string, version: number): Promise<VersionRow | null> {
    return (await this.listVersions(ctx, mapId)).find((row) => row.version === version) ?? null;
  }

  async getLatestVersion(ctx: RepoCtx, mapId: string): Promise<VersionRow | null> {
    return (await this.listVersions(ctx, mapId))[0] ?? null;
  }

  async loadForPublish(ctx: RepoCtx, mapId: string): Promise<PublishSnapshot | null> {
    const loaded = await this.getMap(ctx, mapId);
    if (!loaded) return null;
    return { doc: loaded.map, features: loaded.features, latest: await this.getLatestVersion(ctx, mapId) };
  }

  async recordNextVersion(ctx: RepoCtx, mapId: string, build: (version: number) => VersionDraft): Promise<VersionRow | null> {
    const entry = this.maps.get(this.key(ctx.tenantId, mapId));
    if (!entry || entry.doc.archived) return null;
    const version = entry.versions.reduce((max, row) => Math.max(max, row.version), 0) + 1;
    const row: VersionRow = { ...build(version), mapId, version, publishedBy: { userId: ctx.userId, name: "" } };
    entry.versions.push(row);
    return this.withName(ctx.tenantId, row);
  }

  async setPublished(
    ctx: RepoCtx,
    mapId: string,
    live: { readonly version: number; readonly rev: number },
    writePointer: () => Promise<void>,
  ): Promise<boolean> {
    const entry = this.maps.get(this.key(ctx.tenantId, mapId));
    if (!entry) return false;
    if (entry.doc.publishedVersion !== null && entry.doc.publishedVersion > live.version) return false;
    await writePointer();
    entry.doc = { ...entry.doc, publishedVersion: live.version, publishedRev: Math.min(live.rev, entry.doc.rev) };
    return true;
  }

  async confirmPublishedRev(ctx: RepoCtx, mapId: string, live: { readonly version: number; readonly rev: number }): Promise<void> {
    const entry = this.maps.get(this.key(ctx.tenantId, mapId));
    if (!entry || entry.doc.publishedVersion !== live.version) return;
    entry.doc = { ...entry.doc, publishedRev: Math.max(entry.doc.publishedRev ?? 0, Math.min(live.rev, entry.doc.rev)) };
  }
}
