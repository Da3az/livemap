import { randomBytes, randomUUID } from "node:crypto";
import type { AdminDb } from "./admin.js";
import { GUEST_SLUG_PREFIX } from "./limits.js";
import type { MemoryMapRepo } from "./repo.js";

/** The identity a guest signup produces. Becomes the claims of a session token. */
export interface GuestIdentity {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly role: "owner";
}

/**
 * The one thing a request handler may ask of the bypassrls role.
 *
 * `AdminDb` ignores every policy, so the server is never handed the pool. It is
 * handed this instead: two operations, no SQL surface, and no argument a caller
 * controls. Creating a tenant has to cross the tenant boundary — there is no
 * `app.tenant_id` to set until the row exists — but nothing else about a guest
 * does, so the map a guest then creates goes through `PostgresRepo` and the
 * insert policy like anyone else's.
 */
export interface GuestProvisioner {
  provision(): Promise<GuestIdentity>;
  /** Every guest tenant that exists, expired or not — what the cap is measured against. */
  count(): Promise<number>;
}

function newGuest(): GuestIdentity & { readonly email: string } {
  const userId = randomUUID();
  return {
    userId,
    tenantId: randomUUID(),
    // 48 bits: not a secret, only has to be unique and unguessable enough that
    // a published guest map is not enumerable by its URL.
    tenantSlug: `${GUEST_SLUG_PREFIX}${randomBytes(6).toString("hex")}`,
    role: "owner",
    // .invalid is reserved by RFC 2606 and can never be delivered to.
    email: `${userId}@guest.invalid`,
  };
}

export class PostgresGuestProvisioner implements GuestProvisioner {
  constructor(private readonly admin: AdminDb) {}

  async provision(): Promise<GuestIdentity> {
    const g = newGuest();
    await this.admin.transaction(async (c) => {
      await c.query(
        `insert into tenants (id, slug, name) values ($1, $2, 'Guest workspace')`,
        [g.tenantId, g.tenantSlug],
      );
      await c.query(
        `insert into users (id, email, name) values ($1, $2, 'Guest')`,
        [g.userId, g.email],
      );
      await c.query(
        `insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)`,
        [g.tenantId, g.userId, g.role],
      );
    });
    return {
      userId: g.userId,
      tenantId: g.tenantId,
      tenantSlug: g.tenantSlug,
      role: g.role,
    };
  }

  async count(): Promise<number> {
    // left() rather than LIKE: no pattern, so nothing in the prefix can ever
    // be read as a wildcard.
    const { rows } = await this.admin.query<{ n: number }>(
      `select count(*)::int as n from tenants where left(slug, $1) = $2`,
      [GUEST_SLUG_PREFIX.length, GUEST_SLUG_PREFIX],
    );
    return Number(rows[0]?.n ?? 0);
  }
}

/** For the local demo and tests, where there is no database to provision into. */
export class MemoryGuestProvisioner implements GuestProvisioner {
  private n = 0;

  constructor(private readonly repo: MemoryMapRepo) {}

  async provision(): Promise<GuestIdentity> {
    const g = newGuest();
    this.repo.grant(g.tenantId, g.userId, g.role, { user: "Guest", tenant: "Guest workspace" });
    this.n++;
    return {
      userId: g.userId,
      tenantId: g.tenantId,
      tenantSlug: g.tenantSlug,
      role: g.role,
    };
  }

  async count(): Promise<number> {
    return this.n;
  }
}
