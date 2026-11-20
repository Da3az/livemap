/**
 * The one place the role model lives in application code.
 *
 * Before this module, `EDITING_ROLES` sat in server.ts and `PUBLISHING_ROLES`
 * in publish.ts, and the two were only consistent by coincidence. Everything
 * that asks "may this actor do that" now asks here.
 *
 * This table is a MIRROR, not the authority. The authority is
 * migrations/0002_role_aware_rls.sql, whose policies encode the same grid in
 * `livemap_granted_role()` terms. The duplication is deliberate: the database
 * is the backstop that holds when a route forgets to call `can()`, and this
 * copy exists so a refusal can be a clean 403 with a reason instead of a
 * constraint error or an empty result set.
 *
 * If you change one, change the other. `test/authz.test.ts` pins the grid, and
 * `test/postgres.test.ts` proves the policies agree with it against a real
 * database.
 */

export const ROLES = ["owner", "admin", "editor", "contributor", "viewer"] as const;

export type Role = (typeof ROLES)[number];

/**
 * Verbs, not routes. A capability outlives the endpoint that first needed it,
 * and naming them after routes is how the two lists drifted apart before.
 */
export type Capability =
  | "map:read"
  | "map:create"
  | "map:edit"
  | "map:delete"
  | "map:publish"
  | "publish:request"
  | "publish:decide"
  | "member:manage"
  | "theme:manage"
  | "asset:manage"
  | "feed:manage";

const GRID: Record<Role, readonly Capability[]> = {
  owner: [
    "map:read",
    "map:create",
    "map:edit",
    "map:delete",
    "map:publish",
    "publish:request",
    "publish:decide",
    "member:manage",
    "theme:manage",
    "asset:manage",
    "feed:manage",
  ],
  admin: [
    "map:read",
    "map:create",
    "map:edit",
    "map:delete",
    "map:publish",
    "publish:request",
    "publish:decide",
    "member:manage",
    "theme:manage",
    "asset:manage",
    "feed:manage",
  ],
  // An editor runs the desk: full editorial control, no account control.
  editor: [
    "map:read",
    "map:create",
    "map:edit",
    "map:publish",
    "publish:request",
    "publish:decide",
    "theme:manage",
    "asset:manage",
  ],
  // A contributor authors and submits; someone else publishes. `map:edit` is
  // granted but narrowed by `OWNS_ROWS` below.
  contributor: ["map:read", "map:create", "map:edit", "publish:request"],
  viewer: ["map:read"],
};

const CAPABILITIES = new Map<Role, ReadonlySet<Capability>>(
  ROLES.map((r) => [r, new Set(GRID[r])]),
);

/**
 * Roles whose `map:edit` reaches only maps they created. Everyone else with
 * `map:edit` may edit any map in their tenant.
 *
 * The database half of this is the `contributor` branch of
 * `livemap_can_edit_map()` and the `maps_update` policy.
 */
const OWNS_ROWS: ReadonlySet<Role> = new Set<Role>(["contributor"]);

/**
 * Narrows arbitrary text — a token claim, a database column — to a known role.
 * An unrecognised value is not an error here; it simply has no capabilities,
 * which is the same answer the database gives it.
 */
export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: string, capability: Capability): boolean {
  return isRole(role) ? CAPABILITIES.get(role)!.has(capability) : false;
}

/** Every capability a role holds. For tests and for an eventual /me endpoint. */
export function capabilitiesOf(role: string): readonly Capability[] {
  return isRole(role) ? GRID[role] : [];
}

export interface Decision {
  readonly allowed: boolean;
  /** Present only when denied. Safe to return to the client. */
  readonly reason?: string;
}

const ALLOW: Decision = { allowed: true };

const deny = (reason: string): Decision => ({ allowed: false, reason });

/** Facts about a map that bear on authorisation but are not part of its public document. */
export interface MapOwnership {
  readonly createdBy: string;
}

/**
 * The full edit decision, ownership included.
 *
 * Kept separate from `can()` because the ownership half needs a row, and the
 * route has to know the difference: a contributor editing someone else's map is
 * a 403, not the 409 it would become if we let the row simply not match.
 */
export function authorizeMapEdit(
  actor: { readonly role: string; readonly userId: string },
  map: MapOwnership,
): Decision {
  if (!can(actor.role, "map:edit")) {
    return deny(`role "${actor.role}" cannot edit maps`);
  }
  if (isRole(actor.role) && OWNS_ROWS.has(actor.role) && map.createdBy !== actor.userId) {
    return deny(`role "${actor.role}" may edit only maps it created`);
  }
  return ALLOW;
}

export function authorizePublish(actor: { readonly role: string }): Decision {
  if (!can(actor.role, "map:publish")) {
    // Phrased as a next step: a contributor is not blocked, only routed.
    return deny(
      can(actor.role, "publish:request")
        ? `role "${actor.role}" cannot publish; submit for review instead`
        : `role "${actor.role}" cannot publish`,
    );
  }
  return ALLOW;
}
