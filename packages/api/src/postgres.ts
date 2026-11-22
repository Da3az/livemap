import pg from "pg";
import {
  applySettingsPatch,
  type LngLat,
  type MapDoc,
  type MapFeature,
  type MapSettings,
  type MapSummary,
} from "@livemap/core";
import { authorizeMapEdit, can } from "./authz.js";
import {
  ARCHIVED_REASON,
  FORMER_MEMBER,
  featureQuotaReason,
  freeSlug,
  mapQuotaReason,
  referenceProblem,
  slugify,
  type ArchiveOutcome,
  type CreateLimits,
  type CreateOutcome,
  type EditInput,
  type EditLimits,
  type EditOutcome,
  type MapRepo,
  type NewMap,
  type PublishSnapshot,
  type RepoCtx,
  type SessionInfo,
  type VersionDraft,
  type VersionRow,
} from "./repo.js";

/**
 * Thrown inside a transaction to abandon it. `withCtx` commits whatever its
 * callback returns, so a refusal discovered after rows were written has to
 * leave as an exception; the caller turns it back into an outcome.
 */
class Refused extends Error {
  constructor(readonly outcome: Extract<EditOutcome, { status: "quota" | "invalid" }>) {
    super(outcome.reason);
  }
}

class QuotaRefused extends Error {}

/**
 * Map ids are uuids here, and one that is not can only miss. Asked anyway,
 * Postgres raises 22P02 (invalid_text_representation) on the cast and the
 * caller sees a 500 where a 404 was the truth. Same reasoning as
 * `livemap_current_user()` in 0002: unparseable input must behave like absent
 * input.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string): boolean => UUID_RE.test(v);

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";
/** Postgres `insufficient_privilege`, raised by the archive trigger in 0004. */
const INSUFFICIENT_PRIVILEGE = "42501";

type GeoJson =
  | { type: "Point"; coordinates: number[] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Polygon"; coordinates: number[][][] };

/**
 * Columns hold what the server acts on (draw order, group and preset
 * references, the publish strip, validity dates, lineage); `geom` holds the
 * geography, for spatial queries; `props` holds the rest of the feature as the
 * model defines it. Who changed it and when are columns, stamped by the server.
 */
const COLUMN_FIELDS = new Set([
  "id",
  "kind",
  "order",
  "groupId",
  "presetId",
  "lineageId",
  "hidden",
  "locked",
  "validFrom",
  "validTo",
  "updatedAt",
  "updatedBy",
]);

/** The model field that carries each kind's geometry. */
const GEOMETRY_FIELD: Record<MapFeature["kind"], string> = {
  area: "rings",
  line: "path",
  arrow: "control",
  frontline: "path",
  point: "at",
  annotation: "anchor",
};

function geometryOf(feature: MapFeature): GeoJson {
  switch (feature.kind) {
    case "area":
      return { type: "Polygon", coordinates: feature.rings };
    case "line":
    case "frontline":
      return { type: "LineString", coordinates: feature.path };
    case "arrow":
      return { type: "LineString", coordinates: feature.control };
    case "point":
      return { type: "Point", coordinates: feature.at };
    case "annotation":
      return { type: "Point", coordinates: feature.anchor };
  }
}

function encodeFeature(feature: MapFeature): { geom: GeoJson; props: Record<string, unknown> } {
  const props: Record<string, unknown> = {};
  const geometryField = GEOMETRY_FIELD[feature.kind];
  for (const [key, value] of Object.entries(feature)) {
    if (COLUMN_FIELDS.has(key) || key === geometryField || value === undefined) continue;
    props[key] = value;
  }
  return { geom: geometryOf(feature), props };
}

const asLngLat = (c: number[]): LngLat => [c[0] ?? 0, c[1] ?? 0];

function decodeGeometry(kind: MapFeature["kind"], g: GeoJson | null): Record<string, unknown> {
  const field = GEOMETRY_FIELD[kind];
  if (!g) return { [field]: kind === "area" ? [] : kind === "point" || kind === "annotation" ? [0, 0] : [] };
  if (g.type === "Polygon") return { [field]: g.coordinates.map((ring) => ring.map(asLngLat)) };
  if (g.type === "LineString") return { [field]: g.coordinates.map(asLngLat) };
  return { [field]: asLngLat(g.coordinates) };
}

const FEATURE_SELECT = `
  select f.id, f.kind, f.order_key, ST_AsGeoJSON(f.geom, 15) as geom, f.props,
         f.group_id, f.preset_id, f.lineage_id, f.hidden, f.locked,
         f.valid_from, f.valid_to, f.updated_at, u.name as updated_by_name
    from features f
    left join users u on u.id = f.updated_by
   where f.map_id = $1
   order by f.order_key, f.id`;

const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(value as string).toISOString());

function decodeFeature(r: Record<string, any>): MapFeature {
  const kind = r.kind as MapFeature["kind"];
  return {
    ...(r.props as Record<string, unknown>),
    ...decodeGeometry(kind, r.geom ? (JSON.parse(r.geom) as GeoJson) : null),
    id: r.id,
    kind,
    order: r.order_key,
    groupId: r.group_id,
    presetId: r.preset_id,
    lineageId: r.lineage_id,
    hidden: r.hidden,
    locked: r.locked,
    validFrom: iso(r.valid_from),
    validTo: iso(r.valid_to),
    updatedAt: iso(r.updated_at)!,
    updatedBy: r.updated_by_name ?? FORMER_MEMBER,
  } as MapFeature;
}

/**
 * Names come from a left join on `users`, whose policy shows only people with a
 * membership in this tenant; someone removed since comes back without a name.
 */
const MAP_SELECT = `
  select m.id, m.tenant_id, m.slug, m.title, m.title_dir, m.ui_dir, m.settings,
         m.rev, m.published_version, m.published_rev, m.archived_at,
         m.updated_at, m.created_by,
         uu.name as updated_by_name, cu.name as created_by_name
    from maps m
    left join users uu on uu.id = m.updated_by
    left join users cu on cu.id = m.created_by
   where m.id = $1`;

function decodeMap(r: Record<string, any>): MapDoc {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    title: { value: r.title, dir: r.title_dir },
    uiDir: r.ui_dir,
    settings: r.settings as MapSettings,
    rev: Number(r.rev),
    publishedVersion: r.published_version === null ? null : Number(r.published_version),
    publishedRev: r.published_rev === null ? null : Number(r.published_rev),
    archived: r.archived_at !== null,
    updatedAt: iso(r.updated_at)!,
    updatedBy: r.updated_by_name ?? FORMER_MEMBER,
    createdBy: { userId: r.created_by, name: r.created_by_name ?? FORMER_MEMBER },
  };
}

const VERSION_SELECT = `
  select v.map_id, v.version, v.etag, v.storage_key, v.byte_size, v.feature_count,
         v.published_at, v.published_by, u.name as published_by_name,
         v.source_rev, v.origin_type, v.origin_from_version
    from map_versions v
    left join users u on u.id = v.published_by`;

function decodeVersion(r: Record<string, any>): VersionRow {
  return {
    mapId: r.map_id,
    version: Number(r.version),
    etag: r.etag,
    storageKey: r.storage_key,
    byteSize: Number(r.byte_size),
    featureCount: Number(r.feature_count),
    publishedAt: iso(r.published_at)!,
    publishedBy: { userId: r.published_by, name: r.published_by_name ?? FORMER_MEMBER },
    sourceRev: Number(r.source_rev),
    origin:
      r.origin_type === "rollback"
        ? { type: "rollback", fromVersion: Number(r.origin_from_version) }
        : { type: "publish", rev: Number(r.source_rev) },
  };
}

/**
 * Every table the migrations put under row-level security. Hard-coded rather
 * than discovered, because the point of `assertRlsActive` is to catch a table
 * that SHOULD have policies and does not — a query that asks the catalogue
 * which tables have RLS can never notice the one that lost it.
 */
export const RLS_TABLES = [
  "tenants",
  "users",
  "memberships",
  "themes",
  "assets",
  "maps",
  "features",
  "map_versions",
  "publish_requests",
  "feeds",
] as const;

export interface PostgresRepoOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly statementTimeoutMs?: number;
}

export class PostgresRepo implements MapRepo {
  private readonly pool: pg.Pool;

  constructor(opts: PostgresRepoOptions) {
    this.pool = new pg.Pool({
      connectionString: opts.connectionString,
      max: opts.max ?? 10,
      statement_timeout: opts.statementTimeoutMs ?? 5_000,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  get poolStats(): { total: number; idle: number; waiting: number } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /**
   * Every query runs inside a transaction with the full actor context set LOCAL
   * to it: app.tenant_id, app.user_id and app.role. The policies in
   * migrations/0002_role_aware_rls.sql read all three — tenant_id for
   * isolation, and the other two for the role and row-ownership checks.
   *
   * `local = true` is the load-bearing part. A plain `SET` persists on the
   * pooled connection after release, so the next request to borrow it would
   * inherit the previous tenant's scope — the exact cross-tenant leak the RLS
   * policies exist to prevent. The same hazard now applies three times over: a
   * leaked app.role would hand the next request the previous caller's
   * permissions.
   *
   * All three go in one round trip, because set_config is a function call and
   * a select can make three of them at once.
   */
  private async withCtx<T>(
    ctx: RepoCtx,
    fn: (c: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `select set_config('app.tenant_id', $1, true),
                set_config('app.user_id',   $2, true),
                set_config('app.role',      $3, true)`,
        [ctx.tenantId, ctx.userId, ctx.role],
      );
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (err) {
      try {
        await client.query("rollback");
      } catch {
        // The connection is already broken; the pool will discard it.
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async membershipRole(ctx: RepoCtx): Promise<string | null> {
    return this.withCtx(ctx, async (c) => {
      // The select policy on memberships is tenant-only, so this needs no role
      // to already be established — which is the point, since it is what
      // establishes one.
      const { rows } = await c.query(
        `select role from memberships
          where tenant_id = livemap_current_tenant()
            and user_id = livemap_current_user()`,
      );
      return rows[0] ? (rows[0].role as string) : null;
    });
  }

  async sessionInfo(ctx: RepoCtx): Promise<SessionInfo> {
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(
        `select (select name from users where id = livemap_current_user()) as user_name,
                (select name from tenants where id = livemap_current_tenant()) as tenant_name`,
      );
      return { userName: rows[0]?.user_name ?? FORMER_MEMBER, tenantName: rows[0]?.tenant_name ?? "Workspace" };
    });
  }

  async listMaps(ctx: RepoCtx, opts: { readonly archived: boolean }): Promise<MapSummary[]> {
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(
        `select m.id, m.slug, m.title, m.title_dir, m.ui_dir, m.rev,
                m.published_version, m.published_rev, m.updated_at, m.created_by,
                m.archived_at is not null as archived,
                m.settings->'openingView'->'center' as center,
                (m.settings->'openingView'->>'zoom')::float8 as zoom,
                m.settings->'basemap'->>'styleId' as basemap,
                uu.name as updated_by_name, cu.name as created_by_name,
                (select count(*)::int from features f where f.map_id = m.id) as feature_count
           from maps m
           left join users uu on uu.id = m.updated_by
           left join users cu on cu.id = m.created_by
          where (m.archived_at is not null) = $1
          order by m.updated_at desc`,
        [opts.archived],
      );
      return rows.map(
        (r): MapSummary => ({
          id: r.id,
          slug: r.slug,
          title: { value: r.title, dir: r.title_dir },
          uiDir: r.ui_dir,
          rev: Number(r.rev),
          publishedVersion: r.published_version === null ? null : Number(r.published_version),
          publishedRev: r.published_rev === null ? null : Number(r.published_rev),
          updatedAt: iso(r.updated_at)!,
          updatedBy: r.updated_by_name ?? FORMER_MEMBER,
          createdBy: { userId: r.created_by, name: r.created_by_name ?? FORMER_MEMBER },
          featureCount: Number(r.feature_count),
          archived: r.archived,
          thumbnail: { center: asLngLat(r.center as number[]), zoom: Number(r.zoom), basemap: r.basemap },
        }),
      );
    });
  }

  async countMaps(ctx: RepoCtx): Promise<number> {
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from maps where archived_at is null`);
      return Number(rows[0]!.n);
    });
  }

  async createMap(ctx: RepoCtx, map: NewMap, limits: CreateLimits): Promise<CreateOutcome> {
    // The slug is chosen by reading the ones in use, which two concurrent
    // creates can both do before either inserts. The unique index settles it;
    // the loser's transaction is already aborted by then, so the retry has to
    // be a fresh one rather than a second attempt inside it.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.createMapTx(ctx, map, limits);
      } catch (err) {
        if (err instanceof QuotaRefused) return { status: "quota", reason: mapQuotaReason(limits) };
        const code = (err as { code?: string }).code;
        if (code === UNIQUE_VIOLATION && attempt < 3) continue;
        throw err;
      }
    }
  }

  private createMapTx(ctx: RepoCtx, map: NewMap, limits: CreateLimits): Promise<CreateOutcome> {
    return this.withCtx(ctx, async (c) => {
      const { rows: existing } = await c.query(`select slug, archived_at is not null as archived from maps`);
      if (existing.filter((r) => !r.archived).length >= limits.maxMaps) throw new QuotaRefused();
      const slug = freeSlug(slugify(map.title.value), new Set(existing.map((r) => r.slug as string)));

      // created_by and updated_by come from the session, never from the
      // caller: row ownership for a contributor hangs on created_by.
      const { rows } = await c.query(
        `insert into maps (tenant_id, slug, title, title_dir, ui_dir, settings, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6::jsonb, livemap_current_user(), livemap_current_user())
         returning id`,
        [ctx.tenantId, slug, map.title.value, map.title.dir, map.uiDir, JSON.stringify(map.settings)],
      );
      const created = await c.query(MAP_SELECT, [rows[0]!.id]);
      return { status: "created", map: decodeMap(created.rows[0]!) } as const;
    });
  }

  async getMap(ctx: RepoCtx, mapId: string): Promise<{ map: MapDoc; features: MapFeature[] } | null> {
    if (!isUuid(mapId)) return null;
    return this.withCtx(ctx, async (c) => {
      const map = await c.query(MAP_SELECT, [mapId]);
      if (map.rowCount === 0) return null;
      const features = await c.query(FEATURE_SELECT, [mapId]);
      return { map: decodeMap(map.rows[0]!), features: features.rows.map(decodeFeature) };
    });
  }

  async applyEdit(ctx: RepoCtx, mapId: string, edit: EditInput, limits: EditLimits): Promise<EditOutcome> {
    if (!isUuid(mapId)) return { status: "not_found" };
    try {
      return await this.applyEditTx(ctx, mapId, edit, limits);
    } catch (err) {
      if (err instanceof Refused) return err.outcome;
      throw err;
    }
  }

  private applyEditTx(ctx: RepoCtx, mapId: string, edit: EditInput, limits: EditLimits): Promise<EditOutcome> {
    return this.withCtx(ctx, async (c) => {
      // Read the map first, so the ways this can fail stay distinguishable. A
      // plain select, NOT `for update`: per the Postgres docs, SELECT ... FOR
      // UPDATE applies the UPDATE policy's USING clause as well as the SELECT
      // policy's, so a row an ownership policy refuses would come back empty
      // and get reported as "no such map". The guarded update below locks.
      const head = await c.query(
        `select m.rev, m.created_by, m.archived_at is not null as archived, m.updated_at, u.name as updated_by_name
           from maps m left join users u on u.id = m.updated_by
          where m.id = $1`,
        [mapId],
      );
      const row = head.rows[0];
      if (!row) return { status: "not_found" } as const;

      // The DB policies are the backstop; this is the copy that can say why.
      const decision = authorizeMapEdit(ctx, { createdBy: row.created_by });
      if (!decision.allowed) return { status: "forbidden", reason: decision.reason! } as const;
      if (row.archived) return { status: "forbidden", reason: ARCHIVED_REASON } as const;

      // The guard and the bump are one statement. Zero rows means the caller
      // read a stale rev — a lost write — unless the caller chose to overwrite.
      // The row lock this takes serialises concurrent writers behind it, which
      // also makes the settings read-modify-write below safe.
      const guard = await c.query(
        `update maps
            set rev = rev + 1, updated_at = now(), updated_by = livemap_current_user(),
                title = coalesce($3, title), title_dir = coalesce($4, title_dir), ui_dir = coalesce($5, ui_dir)
          where id = $1 and ($2::bigint is null or rev = $2) and archived_at is null
        returning rev, updated_at, settings`,
        [mapId, edit.force ? null : edit.rev, edit.title?.value ?? null, edit.title?.dir ?? null, edit.uiDir ?? null],
      );
      if (guard.rowCount === 0) {
        return {
          status: "stale",
          current: { rev: Number(row.rev), updatedBy: row.updated_by_name ?? FORMER_MEMBER, updatedAt: iso(row.updated_at)! },
        } as const;
      }
      const applied = guard.rows[0]!;

      let settings = applied.settings as MapSettings;
      if (edit.settings) {
        settings = applySettingsPatch(settings, edit.settings);
        await c.query(`update maps set settings = $2::jsonb where id = $1`, [mapId, JSON.stringify(settings)]);
      }

      if (edit.delete.length > 0) {
        await c.query(`delete from features where map_id = $1 and id = any($2::text[])`, [mapId, [...edit.delete]]);
      }
      await this.putFeatures(c, ctx, mapId, edit.put);

      // Counted after the write rather than predicted before it: a put may
      // replace a row or add one, and only the table knows which.
      const { rows: count } = await c.query(`select count(*)::int as n from features where map_id = $1`, [mapId]);
      const total = Number(count[0]!.n);
      if (total > limits.maxFeaturesPerMap) {
        throw new Refused({ status: "quota", reason: featureQuotaReason(limits, total) });
      }

      // Every feature's group and preset must exist after this write, whether
      // or not this request touched that feature: a settings change can remove
      // a group other features still name.
      const { rows: refs } = await c.query(
        `select id, group_id as "groupId", preset_id as "presetId" from features
          where map_id = $1 and (group_id is not null or preset_id is not null)`,
        [mapId],
      );
      const problem = referenceProblem(settings, refs as MapFeature[]);
      if (problem) throw new Refused({ status: "invalid", reason: problem });

      return { status: "applied", rev: Number(applied.rev), updatedAt: iso(applied.updated_at)! } as const;
    });
  }

  /** Upsert by (map_id, id). The server stamps who changed each feature and when. */
  private async putFeatures(c: pg.PoolClient, ctx: RepoCtx, mapId: string, put: readonly MapFeature[]): Promise<void> {
    for (const feature of put) {
      const encoded = encodeFeature(feature);
      await c.query(
        `insert into features
           (id, map_id, tenant_id, kind, order_key, geom, props, group_id, preset_id, lineage_id,
            hidden, locked, valid_from, valid_to, updated_by, updated_at)
         values ($1, $2, $3, $4, $5, ST_GeomFromGeoJSON($6)::geography, $7::jsonb, $8, $9, $10,
                 $11, $12, $13, $14, livemap_current_user(), now())
         on conflict (map_id, id) do update
            set kind = excluded.kind, order_key = excluded.order_key, geom = excluded.geom,
                props = excluded.props, group_id = excluded.group_id, preset_id = excluded.preset_id,
                lineage_id = excluded.lineage_id, hidden = excluded.hidden, locked = excluded.locked,
                valid_from = excluded.valid_from, valid_to = excluded.valid_to,
                updated_by = excluded.updated_by, updated_at = now()`,
        [
          feature.id,
          mapId,
          ctx.tenantId,
          feature.kind,
          feature.order,
          JSON.stringify(encoded.geom),
          JSON.stringify(encoded.props),
          feature.groupId,
          feature.presetId,
          feature.lineageId,
          feature.hidden,
          feature.locked,
          feature.validFrom,
          feature.validTo,
        ],
      );
    }
  }

  async setArchived(ctx: RepoCtx, mapId: string, archived: boolean, limits: CreateLimits): Promise<ArchiveOutcome> {
    if (!isUuid(mapId)) return { status: "not_found" };
    if (!can(ctx.role, "map:archive")) {
      return { status: "forbidden", reason: "Only an owner or an admin of this workspace can archive or restore maps." };
    }
    try {
      return await this.withCtx(ctx, async (c) => {
        const head = await c.query(`select archived_at is not null as archived from maps where id = $1`, [mapId]);
        if (head.rowCount === 0) return { status: "not_found" } as const;
        if (head.rows[0]!.archived === archived) return { status: "ok" } as const;
        if (!archived) {
          const { rows } = await c.query(`select count(*)::int as n from maps where archived_at is null`);
          if (Number(rows[0]!.n) >= limits.maxMaps) return { status: "quota", reason: mapQuotaReason(limits) } as const;
        }
        // `updated_at` is left alone: archiving is not an edit of the map.
        await c.query(`update maps set archived_at = case when $2 then now() end where id = $1`, [mapId, archived]);
        return { status: "ok" } as const;
      });
    } catch (err) {
      // The trigger in 0004 is the backstop for the role rule above.
      if ((err as { code?: string }).code === INSUFFICIENT_PRIVILEGE) {
        return { status: "forbidden", reason: "Only an owner or an admin of this workspace can archive or restore maps." };
      }
      throw err;
    }
  }

  async listVersions(ctx: RepoCtx, mapId: string): Promise<VersionRow[]> {
    if (!isUuid(mapId)) return [];
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(`${VERSION_SELECT} where v.map_id = $1 order by v.version desc`, [mapId]);
      return rows.map(decodeVersion);
    });
  }

  async getVersion(ctx: RepoCtx, mapId: string, version: number): Promise<VersionRow | null> {
    if (!isUuid(mapId)) return null;
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(`${VERSION_SELECT} where v.map_id = $1 and v.version = $2`, [mapId, version]);
      return rows[0] ? decodeVersion(rows[0]) : null;
    });
  }

  async getLatestVersion(ctx: RepoCtx, mapId: string): Promise<VersionRow | null> {
    if (!isUuid(mapId)) return null;
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(`${VERSION_SELECT} where v.map_id = $1 order by v.version desc limit 1`, [mapId]);
      return rows[0] ? decodeVersion(rows[0]) : null;
    });
  }

  async loadForPublish(ctx: RepoCtx, mapId: string): Promise<PublishSnapshot | null> {
    if (!isUuid(mapId)) return null;
    // One transaction for all three reads. Separately they could straddle a
    // concurrent edit and publish a document whose features never coexisted
    // with it, or compare a hash against a ledger row written in between.
    return this.withCtx(ctx, async (c) => {
      const map = await c.query(MAP_SELECT, [mapId]);
      if (map.rowCount === 0) return null;
      const features = await c.query(FEATURE_SELECT, [mapId]);
      const latest = await c.query(`${VERSION_SELECT} where v.map_id = $1 order by v.version desc limit 1`, [mapId]);
      return {
        doc: decodeMap(map.rows[0]!),
        features: features.rows.map(decodeFeature),
        latest: latest.rows[0] ? decodeVersion(latest.rows[0]) : null,
      };
    });
  }

  async recordNextVersion(ctx: RepoCtx, mapId: string, build: (version: number) => VersionDraft): Promise<VersionRow | null> {
    if (!isUuid(mapId)) return null;
    return this.withCtx(ctx, async (c) => {
      // Allocation and insert in ONE transaction, serialised per map by a
      // transaction-scoped advisory lock. `select ... for update` on the maps
      // row would be the obvious lock, but per the Postgres docs it also
      // applies the maps UPDATE policy, which a publishing role need not
      // satisfy. The lock is released on commit or rollback.
      await c.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [mapId]);

      const exists = await c.query(`select 1 from maps where id = $1 and archived_at is null`, [mapId]);
      if (exists.rowCount === 0) return null;

      const { rows: n } = await c.query(`select coalesce(max(version), 0) + 1 as next from map_versions where map_id = $1`, [mapId]);
      const version = Number(n[0]!.next);

      // Inside the transaction because the artifact's storage key and byte size
      // both depend on the number just allocated.
      const draft = build(version);
      await c.query(
        `insert into map_versions
           (map_id, version, tenant_id, etag, storage_key, byte_size, feature_count,
            published_at, published_by, source_rev, origin_type, origin_from_version)
         values ($1, $2, $3, $4, $5, $6, $7, $8, livemap_current_user(), $9, $10, $11)`,
        [
          mapId,
          version,
          ctx.tenantId,
          draft.etag,
          draft.storageKey,
          draft.byteSize,
          draft.featureCount,
          draft.publishedAt,
          draft.sourceRev,
          draft.origin.type,
          draft.origin.type === "rollback" ? draft.origin.fromVersion : null,
        ],
      );
      const { rows } = await c.query(`${VERSION_SELECT} where v.map_id = $1 and v.version = $2`, [mapId, version]);
      return decodeVersion(rows[0]!);
    });
  }

  async setPublished(
    ctx: RepoCtx,
    mapId: string,
    live: { readonly version: number; readonly rev: number },
    writePointer: () => Promise<void>,
  ): Promise<boolean> {
    if (!isUuid(mapId)) return false;
    return this.withCtx(ctx, async (c) => {
      // Serialised with the allocation above, and guarded: a slower publish of
      // an older version must not move the map backwards. `updated_at` is left
      // alone, since publishing is not an edit of the draft.
      await c.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [mapId]);
      const out = await c.query(
        `update maps set published_version = $2, published_rev = least($3::bigint, rev)
          where id = $1 and (published_version is null or published_version <= $2)`,
        [mapId, live.version, live.rev],
      );
      if ((out.rowCount ?? 0) === 0) return false;
      // Inside the transaction and under the lock: the object store cannot
      // join it, but holding the lock means no other publish of this map can
      // write its pointer in between, and a failed write rolls the map back.
      await writePointer();
      return true;
    });
  }

  async confirmPublishedRev(ctx: RepoCtx, mapId: string, live: { readonly version: number; readonly rev: number }): Promise<void> {
    if (!isUuid(mapId)) return;
    await this.withCtx(ctx, async (c) => {
      await c.query(
        `update maps set published_rev = greatest(coalesce(published_rev, 0), least($3::bigint, rev))
          where id = $1 and published_version = $2`,
        [mapId, live.version, live.rev],
      );
    });
  }

  /**
   * Proves at boot that the isolation everything above depends on is actually
   * attached.
   *
   * Nothing else notices if it is not. A database migrated without the policy
   * block, a `alter table ... owner to livemap_app` run by a well-meaning
   * script, or a connection string pointing at a role with BYPASSRLS — each one
   * starts cleanly and then serves cross-tenant rows. These are cheap read-only
   * catalogue queries, so there is no reason not to run them on every start.
   *
   * Throws with the specific failure rather than returning a boolean: a server
   * that cannot prove tenant isolation must not accept traffic, and a caller
   * should not be able to ignore the result.
   */
  async assertRlsActive(
    tables: readonly string[] = RLS_TABLES,
  ): Promise<void> {
    const c = await this.pool.connect();
    try {
      const { rows: who } = await c.query(
        `select current_user as role,
                (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
      );
      const self = who[0]!;

      if (self.bypass) {
        throw new Error(
          `the application is connected as "${self.role}", which has BYPASSRLS — ` +
            "every policy is inert on this connection. Point APP_DATABASE_URL at " +
            "livemap_app; the bypassrls roles exist for migrations and platform work.",
        );
      }

      const { rows } = await c.query(
        `select c.relname,
                c.relrowsecurity      as enabled,
                c.relforcerowsecurity as forced,
                r.rolname             as owner,
                (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           join pg_roles r     on r.oid = c.relowner
          where n.nspname = 'public' and c.relname = any($1::text[])`,
        [[...tables]],
      );

      const found = new Map(rows.map((r) => [r.relname as string, r]));
      const problems: string[] = [];

      for (const t of tables) {
        const r = found.get(t);
        if (!r) {
          problems.push(`${t}: table is missing — run the migrations`);
          continue;
        }
        if (!r.enabled) problems.push(`${t}: row level security is not enabled`);
        if (!r.forced) problems.push(`${t}: FORCE row level security is not set`);
        if (Number(r.policies) === 0) {
          problems.push(`${t}: row level security is on but no policy is attached`);
        }
        if (r.owner === self.role) {
          problems.push(
            `${t}: owned by the connecting role "${r.owner}" — an owner bypasses RLS`,
          );
        }
      }

      if (problems.length > 0) {
        throw new Error(
          `tenant isolation is not in force:\n  ${problems.join("\n  ")}`,
        );
      }
    } finally {
      c.release();
    }
  }

  /** Readiness probe: proves the pool can reach the database. */
  async ping(): Promise<boolean> {
    try {
      const c = await this.pool.connect();
      try {
        await c.query("select 1");
        return true;
      } finally {
        c.release();
      }
    } catch {
      return false;
    }
  }
}
