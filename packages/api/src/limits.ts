// What bounds a tenant, and how fast a caller may go. One module so that the
// numbers a guest is held to are readable in one place rather than scattered
// across the routes that enforce them.

/**
 * Guest tenants are marked by their slug, not by a column: `tenants.created_at`
 * already gives the reaper its cutoff, so a `kind` column would be a migration
 * that buys only tidiness. Nothing else may mint a slug with this prefix.
 */
export const GUEST_SLUG_PREFIX = "guest-";

export const GUEST_TTL_SECS = 7 * 24 * 60 * 60;

export function isGuestSlug(slug: string): boolean {
  return slug.startsWith(GUEST_SLUG_PREFIX);
}

export interface TenantLimits {
  /** Maps that are not archived. Restoring one is refused while the workspace is at this limit. */
  readonly maxMaps: number;
  readonly maxFeaturesPerMap: number;
  /** Each version is an object in the bucket that is never deleted. Null = unbounded. */
  readonly maxVersionsPerMap: number | null;
  /** Checked against Content-Length, below the server-wide body limit. */
  readonly maxBodyBytes: number;
}

export interface Limits {
  readonly guest: TenantLimits;
  readonly member: TenantLimits;
}

export const DEFAULT_LIMITS: Limits = {
  guest: {
    maxMaps: 5,
    maxFeaturesPerMap: 2_000,
    maxVersionsPerMap: 25,
    maxBodyBytes: 512 * 1024,
  },
  member: {
    maxMaps: 200,
    maxFeaturesPerMap: 20_000,
    maxVersionsPerMap: null,
    maxBodyBytes: 2 * 1024 * 1024,
  },
};

export function limitsFor(limits: Limits, tenantSlug: string): TenantLimits {
  return isGuestSlug(tenantSlug) ? limits.guest : limits.member;
}

export interface RateLimitConfig {
  readonly max: number;
  readonly timeWindow: string | number;
}

/**
 * One entry per kind of cost. The limiter keeps a counter per route, so "60
 * writes a minute" means 60 to each write route, not 60 across them. A tier
 * left out is unlimited, which is what tests and the local demo want.
 */
export interface RateLimits {
  /** Guest signup, keyed by IP: the caller has no identity yet. */
  readonly signup: RateLimitConfig;
  /**
   * Publish and rollback. Each one writes objects that are kept forever.
   * `guestMax` is the same window with a lower ceiling, for tenants nobody
   * vouches for.
   */
  readonly publish: RateLimitConfig & { readonly guestMax?: number };
  /** Every other mutation. */
  readonly write: RateLimitConfig;
  /** Authenticated reads. Published maps are not read through the API at all. */
  readonly read: RateLimitConfig;
  /** Rejected credentials, keyed by IP. */
  readonly unauth: RateLimitConfig;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  signup: { max: 3, timeWindow: "1 hour" },
  publish: { max: 60, timeWindow: "1 hour", guestMax: 10 },
  write: { max: 60, timeWindow: "1 minute" },
  read: { max: 300, timeWindow: "1 minute" },
  unauth: { max: 30, timeWindow: "1 minute" },
};
