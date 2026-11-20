import pg from "pg";

/**
 * A pool for cross-tenant platform work, connected as `livemap_admin`.
 *
 * Why this exists at all: provisioning a tenant has no `app.tenant_id` to set
 * until the tenant row exists, so it cannot go through the RLS-scoped request
 * path. Until now the only route for that was the migration role — which also
 * owns the schema, so every support query carried the ability to run DDL, and
 * revoking one meant revoking the other. `livemap_admin` has BYPASSRLS and no
 * ownership, which separates the two.
 *
 * Why it is a bare query surface and not a repo: there is no identity provider
 * yet, so there is no way to authenticate a platform operator and no honest
 * place to put an authorisation check above these queries. Scripts
 * (bench/seed.mjs, the test fixtures) hold their own SQL; this class exists so
 * they stop reaching for DATABASE_URL to do it. When operator identity lands,
 * the methods go on top of this, not beside it.
 *
 * THIS POOL IGNORES EVERY ROW-LEVEL SECURITY POLICY. Never hand it to
 * `buildServer`, and never reach for it from a request handler. `PostgresRepo`
 * has `assertRlsActive()` precisely so that mistake fails at boot.
 */
export interface AdminDbOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly statementTimeoutMs?: number;
}

export class AdminDb {
  private readonly pool: pg.Pool;

  constructor(opts: AdminDbOptions) {
    this.pool = new pg.Pool({
      connectionString: opts.connectionString,
      // Small by default: platform work is occasional and should never be able
      // to starve the request path of connections.
      max: opts.max ?? 2,
      // Longer than the app's 5s. A backfill or a support query over a whole
      // tenant is legitimately slow, and this pool is not serving users.
      statement_timeout: opts.statementTimeoutMs ?? 60_000,
    });
  }

  /** One statement, one connection. No tenant GUC is set; none would apply. */
  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(sql, [...params]);
  }

  /** Several statements, one transaction, on one connection. */
  async transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
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

  /**
   * Proves this really is a bypassrls, non-owning role — the mirror of
   * `PostgresRepo.assertRlsActive()`. A pool wired to the wrong connection
   * string would otherwise fail halfway through a provisioning script, with
   * half a tenant already created.
   */
  async assertBypassesRls(): Promise<void> {
    const { rows } = await this.query<{ role: string; bypass: boolean }>(
      `select current_user as role,
              (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
    );
    if (!rows[0]?.bypass) {
      throw new Error(
        `ADMIN_DATABASE_URL connects as "${rows[0]?.role}", which does not have ` +
          "BYPASSRLS. Cross-tenant work will silently return nothing. Point it at " +
          "livemap_admin.",
      );
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
