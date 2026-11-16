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
import type { MapRepo, VersionRecord } from "./repo.js";

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
   * Every query runs inside a transaction with app.tenant_id set LOCAL to it.
   *
   * `local = true` is the load-bearing part. A plain `SET` persists on the
   * pooled connection after release, so the next request to borrow it would
   * inherit the previous tenant's scope — the exact cross-tenant leak the RLS
   * policies exist to prevent.
   */
  private async inTenant<T>(
    tenantId: string,
    fn: (c: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [
        tenantId,
      ]);
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

  async getMap(tenantId: string, mapId: string): Promise<MapDoc | null> {
    return this.inTenant(tenantId, async (c) => {
      const { rows } = await c.query(
        `select id, tenant_id, slug, title, title_dir, ui_dir,
                ST_X(center::geometry) as lng, ST_Y(center::geometry) as lat,
                zoom, bearing, pitch, basemap_style_id, label_langs,
                rev, published_version, updated_at
           from maps
          where id = $1 and archived_at is null`,
        [mapId],
      );
      const r = rows[0];
      if (!r) return null;

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
    });
  }

  async listFeatures(tenantId: string, mapId: string): Promise<MapFeature[]> {
    return this.inTenant(tenantId, async (c) => {
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
    tenantId: string,
    mapId: string,
    expectedRev: number,
    put: readonly MapFeature[],
    remove: readonly string[],
  ): Promise<number | null> {
    return this.inTenant(tenantId, async (c) => {
      // The guard and the bump are one statement. Zero rows means either the
      // map is gone or the caller read a stale rev; both are a lost write, and
      // the row lock this takes serialises concurrent writers behind it.
      const guard = await c.query(
        `update maps
            set rev = rev + 1, updated_at = now()
          where id = $1 and rev = $2 and archived_at is null
        returning rev`,
        [mapId, expectedRev],
      );
      if (guard.rowCount === 0) return null;

      if (remove.length > 0) {
        await c.query(
          `delete from features where map_id = $1 and id = any($2::text[])`,
          [mapId, [...remove]],
        );
      }

      for (const f of put) {
        const e = encodeFeature(f);
        await c.query(
          `insert into features (id, map_id, tenant_id, kind, at, geom, props, updated_at)
           values ($1, $2, $3, $4, $5,
                   case when $6::text is null then null
                        else ST_GeomFromGeoJSON($6)::geography end,
                   $7::jsonb, now())
           on conflict (map_id, id) do update
              set kind = excluded.kind,
                  at = excluded.at,
                  geom = excluded.geom,
                  props = excluded.props,
                  updated_at = now()`,
          [
            f.id,
            mapId,
            tenantId,
            e.kind,
            e.at,
            e.geom ? JSON.stringify(e.geom) : null,
            JSON.stringify(e.props),
          ],
        );
      }

      return Number(guard.rows[0]!.rev);
    });
  }

  async nextVersion(tenantId: string, mapId: string): Promise<number> {
    return this.inTenant(tenantId, async (c) => {
      const { rows } = await c.query(
        `select coalesce(max(version), 0) + 1 as next
           from map_versions where map_id = $1`,
        [mapId],
      );
      return Number(rows[0]!.next);
    });
  }

  async getLatestVersion(
    tenantId: string,
    mapId: string,
  ): Promise<VersionRecord | null> {
    return this.inTenant(tenantId, async (c) => {
      const { rows } = await c.query(
        `select map_id, version, etag, storage_key, byte_size, feature_count,
                published_at, published_by
           from map_versions
          where map_id = $1
          order by version desc
          limit 1`,
        [mapId],
      );
      const r = rows[0];
      if (!r) return null;
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
    });
  }

  async recordVersion(tenantId: string, record: VersionRecord): Promise<void> {
    await this.inTenant(tenantId, async (c) => {
      await c.query(
        `insert into map_versions
           (map_id, version, tenant_id, etag, storage_key, byte_size,
            feature_count, published_at, published_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.mapId,
          record.version,
          tenantId,
          record.etag,
          record.storageKey,
          record.byteSize,
          record.featureCount,
          record.publishedAt,
          record.publishedBy,
        ],
      );
    });
  }

  async setPublishedVersion(
    tenantId: string,
    mapId: string,
    version: number,
  ): Promise<void> {
    await this.inTenant(tenantId, async (c) => {
      await c.query(
        `update maps set published_version = $2, updated_at = now()
          where id = $1`,
        [mapId, version],
      );
    });
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
