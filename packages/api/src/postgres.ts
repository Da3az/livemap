import pg from "pg";
import type {
  ArrowHead,
  FacingSide,
  FillStyle,
  HexColor,
  LabelStyle,
  LeaderStyle,
  LngLat,
  MapDoc,
  MapFeature,
  RichText,
  Ring,
  StrokeStyle,
  TextDir,
} from "@livemap/core";
import { authorizeMapEdit } from "./authz.js";
import { featureQuotaReason, freeSlug, slugify } from "./repo.js";
import type {
  ArchiveOutcome,
  CreateLimits,
  CreateOutcome,
  EditLimits,
  EditOutcome,
  MapDraft,
  MapPatch,
  MapRepo,
  MapSummary,
  PublishSnapshot,
  RepoCtx,
  UpdateOutcome,
  VersionDraft,
  VersionRecord,
} from "./repo.js";

/**
 * Thrown inside a transaction to abandon it. `withCtx` commits whatever its
 * callback returns, so a refusal discovered after rows were written has to
 * leave as an exception; the caller turns it back into an outcome.
 */
class Refused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

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

type GeoJson =
  | { type: "Point"; coordinates: number[] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Polygon"; coordinates: number[][][] };

/**
 * Shape of the `props` jsonb column. Asserted rather than validated: this is a
 * trust boundary with our own database, not with a client. Anything that got
 * in came through `encodeFeature`.
 */
interface StoredProps {
  label?: RichText;
  labelStyle?: LabelStyle;
  meta?: Record<string, string>;
  fill?: FillStyle;
  stroke?: StrokeStyle;
  curvature?: number;
  head?: ArrowHead;
  chevrons?: boolean;
  facing?: FacingSide;
  toothSpacing?: number;
  toothSize?: number;
  icon?: string;
  iconColor?: HexColor;
  iconSize?: number;
  disc?: { readonly fill: HexColor; readonly ring: HexColor };
  offset?: readonly [number, number];
  text?: RichText;
  leader?: LeaderStyle | null;
}

/**
 * Splits a feature into the spatial column and the JSON payload. The geometry
 * is a real PostGIS column because it is the part we query spatially; the
 * open-ended per-feature style stays in jsonb.
 *
 * For an arrow the stored geometry is the CONTROL POINTS, not the rendered
 * curve — the curve is derived at render time.
 */
function encodeFeature(f: MapFeature): {
  kind: string;
  at: string;
  geom: GeoJson | null;
  props: Record<string, unknown>;
} {
  const common = {
    ...(f.label ? { label: f.label } : {}),
    ...(f.labelStyle ? { labelStyle: f.labelStyle } : {}),
    ...(f.meta ? { meta: f.meta } : {}),
  };

  switch (f.kind) {
    case "area":
      return {
        kind: f.kind,
        at: f.at,
        geom: {
          type: "Polygon",
          coordinates: f.rings.map((r) => r.map((p) => [p[0], p[1]])),
        },
        props: { ...common, fill: f.fill, stroke: f.stroke },
      };
    case "line":
      return {
        kind: f.kind,
        at: f.at,
        geom: {
          type: "LineString",
          coordinates: f.path.map((p) => [p[0], p[1]]),
        },
        props: { ...common, stroke: f.stroke },
      };
    case "arrow":
      return {
        kind: f.kind,
        at: f.at,
        geom: {
          type: "LineString",
          coordinates: f.control.map((p) => [p[0], p[1]]),
        },
        props: {
          ...common,
          curvature: f.curvature,
          head: f.head,
          stroke: f.stroke,
          chevrons: f.chevrons,
        },
      };
    case "frontline":
      return {
        kind: f.kind,
        at: f.at,
        geom: {
          type: "LineString",
          coordinates: f.path.map((p) => [p[0], p[1]]),
        },
        props: {
          ...common,
          facing: f.facing,
          stroke: f.stroke,
          toothSpacing: f.toothSpacing,
          toothSize: f.toothSize,
        },
      };
    case "point":
      return {
        kind: f.kind,
        at: f.at,
        geom: { type: "Point", coordinates: [f.at_[0], f.at_[1]] },
        props: {
          ...common,
          icon: f.icon,
          iconColor: f.iconColor,
          iconSize: f.iconSize,
          ...(f.disc ? { disc: f.disc } : {}),
        },
      };
    case "annotation":
      return {
        kind: f.kind,
        at: f.at,
        geom: { type: "Point", coordinates: [f.anchor[0], f.anchor[1]] },
        props: {
          ...common,
          offset: f.offset,
          text: f.text,
          labelStyle: f.labelStyle,
          leader: f.leader,
        },
      };
  }
}

const asLngLat = (c: number[]): LngLat => [c[0]!, c[1]!];

function decodeFeature(row: {
  id: string;
  kind: string;
  at: string;
  geom: string | null;
  props: Record<string, unknown>;
}): MapFeature {
  const g: GeoJson | null = row.geom ? JSON.parse(row.geom) : null;
  const p = row.props as StoredProps;
  const base = { id: row.id, at: row.at };
  const common = {
    ...(p.label ? { label: p.label } : {}),
    ...(p.labelStyle ? { labelStyle: p.labelStyle } : {}),
    ...(p.meta ? { meta: p.meta } : {}),
  };
  const line = () =>
    g?.type === "LineString" ? g.coordinates.map(asLngLat) : [];
  const point = (): LngLat =>
    g?.type === "Point" ? asLngLat(g.coordinates) : [0, 0];

  switch (row.kind) {
    case "area": {
      const rings: Ring[] =
        g?.type === "Polygon" ? g.coordinates.map((r) => r.map(asLngLat)) : [];
      return {
        ...base,
        ...common,
        kind: "area",
        rings,
        fill: p.fill!,
        stroke: p.stroke!,
      };
    }
    case "line":
      return {
        ...base,
        ...common,
        kind: "line",
        path: line(),
        stroke: p.stroke!,
      };
    case "arrow":
      return {
        ...base,
        ...common,
        kind: "arrow",
        control: line(),
        curvature: p.curvature!,
        head: p.head!,
        stroke: p.stroke!,
        chevrons: p.chevrons!,
      };
    case "frontline":
      return {
        ...base,
        ...common,
        kind: "frontline",
        path: line(),
        facing: p.facing!,
        stroke: p.stroke!,
        toothSpacing: p.toothSpacing!,
        toothSize: p.toothSize!,
      };
    case "point":
      return {
        ...base,
        ...common,
        kind: "point",
        at_: point(),
        icon: p.icon!,
        iconColor: p.iconColor!,
        iconSize: p.iconSize!,
        ...(p.disc ? { disc: p.disc } : {}),
      };
    case "annotation":
      return {
        ...base,
        ...common,
        kind: "annotation",
        anchor: point(),
        offset: p.offset!,
        text: p.text!,
        labelStyle: p.labelStyle!,
        leader: p.leader ?? null,
      };
    default:
      throw new Error(`unknown feature kind: ${row.kind}`);
  }
}

/**
 * One statement, two callers. `created_by` is selected but deliberately not
 * part of the returned MapDoc: the doc is embedded verbatim in every published
 * artifact, and those are public, so an author's user id must not ride along.
 * `loadForPublish` returns it as a separate field instead.
 */
const MAP_SELECT = `
  select id, tenant_id, slug, title, title_dir, ui_dir,
         ST_X(center::geometry) as lng, ST_Y(center::geometry) as lat,
         zoom, bearing, pitch, basemap_style_id, label_langs,
         rev, published_version, updated_at, created_by
    from maps
   where id = $1 and archived_at is null`;

function decodeMap(r: Record<string, any>): MapDoc {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    title: { value: r.title, dir: r.title_dir },
    viewport: {
      center: [Number(r.lng), Number(r.lat)],
      zoom: Number(r.zoom),
      bearing: Number(r.bearing),
      pitch: Number(r.pitch),
    },
    basemap: { styleId: r.basemap_style_id, labelLangs: r.label_langs },
    uiDir: r.ui_dir,
    updatedAt: new Date(r.updated_at).toISOString(),
    rev: Number(r.rev),
    ...(r.published_version === null
      ? {}
      : { publishedVersion: Number(r.published_version) }),
  } as MapDoc;
}

const VERSION_COLUMNS = `map_id, version, etag, storage_key, byte_size,
         feature_count, published_at, published_by`;

const LATEST_VERSION_SELECT = `
  select ${VERSION_COLUMNS}
    from map_versions
   where map_id = $1
   order by version desc
   limit 1`;

function decodeVersion(r: Record<string, any>): VersionRecord {
  return {
    mapId: r.map_id,
    version: Number(r.version),
    etag: r.etag,
    storageKey: r.storage_key,
    byteSize: Number(r.byte_size),
    featureCount: Number(r.feature_count),
    publishedAt: new Date(r.published_at).toISOString(),
    publishedBy: r.published_by,
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

  async getMap(ctx: RepoCtx, mapId: string): Promise<MapDoc | null> {
    if (!isUuid(mapId)) return null;
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(MAP_SELECT, [mapId]);
      return rows[0] ? decodeMap(rows[0]) : null;
    });
  }

  async listFeatures(ctx: RepoCtx, mapId: string): Promise<MapFeature[]> {
    if (!isUuid(mapId)) return [];
    return this.withCtx(ctx, async (c) => {
      // Ordered by the fractional index so the caller never has to sort.
      const { rows } = await c.query(
        `select id, kind, at, ST_AsGeoJSON(geom) as geom, props
           from features
          where map_id = $1
          order by at`,
        [mapId],
      );
      return rows.map(decodeFeature);
    });
  }

  async applyEdit(
    ctx: RepoCtx,
    mapId: string,
    expectedRev: number,
    put: readonly MapFeature[],
    remove: readonly string[],
    limits?: EditLimits,
  ): Promise<EditOutcome> {
    if (!isUuid(mapId)) return { status: "not_found" };
    try {
      return await this.applyEditTx(ctx, mapId, expectedRev, put, remove, limits);
    } catch (err) {
      if (err instanceof Refused) return { status: "quota", reason: err.reason };
      throw err;
    }
  }

  private applyEditTx(
    ctx: RepoCtx,
    mapId: string,
    expectedRev: number,
    put: readonly MapFeature[],
    remove: readonly string[],
    limits: EditLimits | undefined,
  ): Promise<EditOutcome> {
    return this.withCtx(ctx, async (c) => {
      // Read the map first, so the three ways this can fail stay
      // distinguishable. A plain select, NOT `for update`: per the Postgres
      // docs, SELECT ... FOR UPDATE applies the UPDATE policy's USING clause
      // as well as the SELECT policy's, so a row an ownership policy refuses
      // would come back empty and get reported as "no such map". The lock is
      // not needed here anyway — the guarded update below takes it.
      const head = await c.query(
        `select rev, created_by from maps where id = $1 and archived_at is null`,
        [mapId],
      );
      if (head.rowCount === 0) return { status: "not_found" } as const;

      // The DB policies are the backstop; this is the copy that can say why.
      // Without it an ownership refusal would reach the guarded update, match
      // zero rows, and surface as 409 stale_revision — telling the client to
      // retry something that can never succeed.
      const decision = authorizeMapEdit(ctx, {
        createdBy: head.rows[0]!.created_by,
      });
      if (!decision.allowed) {
        return { status: "forbidden", reason: decision.reason! } as const;
      }

      // The guard and the bump are one statement. Zero rows means the caller
      // read a stale rev — a lost write — and the row lock this takes
      // serialises concurrent writers behind it.
      const guard = await c.query(
        `update maps
            set rev = rev + 1, updated_at = now()
          where id = $1 and rev = $2 and archived_at is null
        returning rev`,
        [mapId, expectedRev],
      );
      if (guard.rowCount === 0) return { status: "stale" } as const;

      if (remove.length > 0) {
        await c.query(
          `delete from features where map_id = $1 and id = any($2::text[])`,
          [mapId, [...remove]],
        );
      }

      await this.putFeatures(c, ctx, mapId, put);

      // Counted after the write rather than predicted before it: a put may
      // replace a row or add one, and only the table knows which.
      if (limits) {
        const { rows } = await c.query(
          `select count(*)::int as n from features where map_id = $1`,
          [mapId],
        );
        if (rows[0]!.n > limits.maxFeaturesPerMap) {
          throw new Refused(featureQuotaReason(limits));
        }
      }

      return { status: "applied", rev: Number(guard.rows[0]!.rev) } as const;
    });
  }

  /** Upsert, shared by an edit and by a new map's starting features. */
  private async putFeatures(
    c: pg.PoolClient,
    ctx: RepoCtx,
    mapId: string,
    put: readonly MapFeature[],
  ): Promise<void> {
    for (const f of put) {
      const e = encodeFeature(f);
      await c.query(
        `insert into features
           (id, map_id, tenant_id, kind, at, geom, props, updated_by, updated_at)
         values ($1, $2, $3, $4, $5,
                 case when $6::text is null then null
                      else ST_GeomFromGeoJSON($6)::geography end,
                 $7::jsonb, livemap_current_user(), now())
         on conflict (map_id, id) do update
            set kind = excluded.kind,
                at = excluded.at,
                geom = excluded.geom,
                props = excluded.props,
                updated_by = excluded.updated_by,
                updated_at = now()`,
        [
          f.id,
          mapId,
          ctx.tenantId,
          e.kind,
          e.at,
          e.geom ? JSON.stringify(e.geom) : null,
          JSON.stringify(e.props),
        ],
      );
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

  async listMaps(
    ctx: RepoCtx,
    opts: { readonly archived: boolean },
  ): Promise<MapSummary[]> {
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(
        `select m.id, m.slug, m.title, m.title_dir, m.ui_dir, m.rev,
                m.published_version, m.updated_at,
                (select count(*)::int from features f where f.map_id = m.id)
                  as feature_count
           from maps m
          where (m.archived_at is not null) = $1
          order by m.updated_at desc`,
        [opts.archived],
      );
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: { value: r.title, dir: r.title_dir },
        uiDir: r.ui_dir,
        rev: Number(r.rev),
        ...(r.published_version === null
          ? {}
          : { publishedVersion: Number(r.published_version) }),
        updatedAt: new Date(r.updated_at).toISOString(),
        featureCount: Number(r.feature_count),
        archived: opts.archived,
      }));
    });
  }

  async countMaps(ctx: RepoCtx): Promise<number> {
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from maps`);
      return Number(rows[0]!.n);
    });
  }

  async createMap(
    ctx: RepoCtx,
    draft: MapDraft,
    limits: CreateLimits,
  ): Promise<CreateOutcome> {
    // The slug is chosen by reading the ones in use, which two concurrent
    // creates can both do before either inserts. The unique index settles it;
    // the loser's transaction is already aborted by then, so the retry has to
    // be a fresh one rather than a second attempt inside it.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.createMapTx(ctx, draft, limits);
      } catch (err) {
        if (err instanceof Refused) return { status: "quota", reason: err.reason };
        const code = (err as { code?: string }).code;
        if (code === UNIQUE_VIOLATION && attempt < 3) continue;
        throw err;
      }
    }
  }

  private createMapTx(
    ctx: RepoCtx,
    draft: MapDraft,
    limits: CreateLimits,
  ): Promise<CreateOutcome> {
    return this.withCtx(ctx, async (c) => {
      const { rows: existing } = await c.query(`select slug from maps`);
      if (existing.length >= limits.maxMaps) {
        throw new Refused(`this workspace is limited to ${limits.maxMaps} maps`);
      }

      const slug = freeSlug(
        slugify(draft.title.value),
        new Set(existing.map((r) => r.slug as string)),
      );

      // created_by comes from the session, never from the caller: the insert
      // policy checks the tenant and the role but not the author, and row
      // ownership for a contributor hangs on this column.
      const { rows } = await c.query(
        `insert into maps
           (tenant_id, slug, title, title_dir, ui_dir, center, zoom, bearing,
            pitch, basemap_style_id, label_langs, created_by)
         values ($1, $2, $3, $4, $5,
                 ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
                 $8, $9, $10, $11, $12::text[], livemap_current_user())
         returning id`,
        [
          ctx.tenantId,
          slug,
          draft.title.value,
          draft.title.dir,
          draft.uiDir,
          draft.viewport.center[0],
          draft.viewport.center[1],
          draft.viewport.zoom,
          draft.viewport.bearing,
          draft.viewport.pitch,
          draft.basemap.styleId,
          [...draft.basemap.labelLangs],
        ],
      );
      const mapId = rows[0]!.id as string;

      await this.putFeatures(c, ctx, mapId, draft.features);

      const map = await c.query(MAP_SELECT, [mapId]);
      return { status: "created", doc: decodeMap(map.rows[0]!) } as const;
    });
  }

  async updateMap(
    ctx: RepoCtx,
    mapId: string,
    patch: MapPatch,
  ): Promise<UpdateOutcome> {
    if (!isUuid(mapId)) return { status: "not_found" };
    return this.withCtx(ctx, async (c) => {
      // Plain select first, for the same reason as in `applyEdit`: a locking
      // read would apply the UPDATE policy and report a refusal as a miss.
      const head = await c.query(
        `select created_by from maps where id = $1 and archived_at is null`,
        [mapId],
      );
      if (head.rowCount === 0) return { status: "not_found" } as const;

      const decision = authorizeMapEdit(ctx, {
        createdBy: head.rows[0]!.created_by,
      });
      if (!decision.allowed) {
        return { status: "forbidden", reason: decision.reason! } as const;
      }

      // `rev` is deliberately left alone. It guards the feature set, and an
      // editor holding the map open would otherwise lose its next save to a
      // rename made in another tab.
      await c.query(
        `update maps
            set title     = coalesce($2, title),
                title_dir = coalesce($3, title_dir),
                ui_dir    = coalesce($4, ui_dir),
                updated_at = now()
          where id = $1 and archived_at is null`,
        [
          mapId,
          patch.title?.value ?? null,
          patch.title?.dir ?? null,
          patch.uiDir ?? null,
        ],
      );

      const map = await c.query(MAP_SELECT, [mapId]);
      if (map.rowCount === 0) return { status: "not_found" } as const;
      return { status: "updated", doc: decodeMap(map.rows[0]!) } as const;
    });
  }

  async setArchived(
    ctx: RepoCtx,
    mapId: string,
    archived: boolean,
  ): Promise<ArchiveOutcome> {
    if (!isUuid(mapId)) return { status: "not_found" };
    return this.withCtx(ctx, async (c) => {
      // No `archived_at is null` filter: unarchiving has to find the row.
      const head = await c.query(`select created_by from maps where id = $1`, [
        mapId,
      ]);
      if (head.rowCount === 0) return { status: "not_found" } as const;

      // Archiving is an update, not a delete, so it follows the edit rule —
      // a contributor may archive what they made and nothing else.
      const decision = authorizeMapEdit(ctx, {
        createdBy: head.rows[0]!.created_by,
      });
      if (!decision.allowed) {
        return { status: "forbidden", reason: decision.reason! } as const;
      }

      await c.query(
        `update maps
            set archived_at = case when $2 then coalesce(archived_at, now()) end,
                updated_at = now()
          where id = $1`,
        [mapId, archived],
      );
      return { status: "ok" } as const;
    });
  }

  async listVersions(ctx: RepoCtx, mapId: string): Promise<VersionRecord[]> {
    if (!isUuid(mapId)) return [];
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(
        `select ${VERSION_COLUMNS}
           from map_versions
          where map_id = $1
          order by version desc`,
        [mapId],
      );
      return rows.map(decodeVersion);
    });
  }

  async getVersion(
    ctx: RepoCtx,
    mapId: string,
    version: number,
  ): Promise<VersionRecord | null> {
    if (!isUuid(mapId)) return null;
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(
        `select ${VERSION_COLUMNS}
           from map_versions
          where map_id = $1 and version = $2`,
        [mapId, version],
      );
      return rows[0] ? decodeVersion(rows[0]) : null;
    });
  }

  async loadForPublish(
    ctx: RepoCtx,
    mapId: string,
  ): Promise<PublishSnapshot | null> {
    if (!isUuid(mapId)) return null;
    // One transaction for all three reads. Separately they could straddle a
    // concurrent edit and publish a document whose features never coexisted
    // with it, or compare an etag against a ledger row written in between.
    return this.withCtx(ctx, async (c) => {
      const map = await c.query(MAP_SELECT, [mapId]);
      if (map.rowCount === 0) return null;

      const feats = await c.query(
        `select id, kind, at, ST_AsGeoJSON(geom) as geom, props
           from features
          where map_id = $1
          order by at`,
        [mapId],
      );

      const latest = await c.query(LATEST_VERSION_SELECT, [mapId]);

      return {
        doc: decodeMap(map.rows[0]!),
        createdBy: map.rows[0]!.created_by,
        features: feats.rows.map(decodeFeature),
        latest: latest.rows[0] ? decodeVersion(latest.rows[0]) : null,
      };
    });
  }

  async recordNextVersion(
    ctx: RepoCtx,
    mapId: string,
    build: (version: number) => VersionDraft,
  ): Promise<VersionRecord | null> {
    if (!isUuid(mapId)) return null;
    return this.withCtx(ctx, async (c) => {
      // Allocation and insert in ONE transaction. They used to be two calls —
      // nextVersion() then recordVersion() — each opening its own transaction,
      // so two publishers could read the same max(version) and the second would
      // collide on the (map_id, version) primary key only after it had already
      // written its artifact.
      //
      // A transaction-scoped advisory lock serialises publishers for this map.
      // `select ... for update` on the maps row would be the obvious lock, but
      // per the Postgres docs it also applies the maps UPDATE policy, which a
      // publishing role need not satisfy — publishing writes the ledger, not
      // the map. The lock is released on commit or rollback, so an interrupted
      // publish cannot leave it held.
      await c.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
        mapId,
      ]);

      const exists = await c.query(
        `select 1 from maps where id = $1 and archived_at is null`,
        [mapId],
      );
      if (exists.rowCount === 0) return null;

      const { rows: n } = await c.query(
        `select coalesce(max(version), 0) + 1 as next
           from map_versions where map_id = $1`,
        [mapId],
      );
      const version = Number(n[0]!.next);

      // Called inside the transaction because the artifact's storage key and
      // byte size both depend on the number just allocated.
      const draft = build(version);

      await c.query(
        `insert into map_versions
           (map_id, version, tenant_id, etag, storage_key, byte_size,
            feature_count, published_at, published_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          mapId,
          version,
          ctx.tenantId,
          draft.etag,
          draft.storageKey,
          draft.byteSize,
          draft.featureCount,
          draft.publishedAt,
          draft.publishedBy,
        ],
      );

      return { ...draft, mapId, version };
    });
  }

  async getLatestVersion(
    ctx: RepoCtx,
    mapId: string,
  ): Promise<VersionRecord | null> {
    if (!isUuid(mapId)) return null;
    return this.withCtx(ctx, async (c) => {
      const { rows } = await c.query(LATEST_VERSION_SELECT, [mapId]);
      return rows[0] ? decodeVersion(rows[0]) : null;
    });
  }

  async setPublishedVersion(
    ctx: RepoCtx,
    mapId: string,
    version: number,
  ): Promise<void> {
    if (!isUuid(mapId)) return;
    await this.withCtx(ctx, async (c) => {
      await c.query(
        `update maps set published_version = $2, updated_at = now()
          where id = $1`,
        [mapId, version],
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
