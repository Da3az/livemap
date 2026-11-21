/**
 * The rules behind the mock server: who may do what, the limits, and the
 * steps a request shares with others (finding a map, minting a version).
 * Each throws `ApiError` the way the real server answers.
 */
import type {
  Capability,
  MapDoc,
  MapFeature,
  MapSummary,
  MapVersion,
  RichText,
  Role,
  Session,
  TemplateSummary,
  TextDir,
  VersionRecord,
} from "@/model/types";
import { apiError } from "./errors";
import {
  measure,
  VERSION_CACHE_CONTROL,
  versionKey,
} from "./publish";
import { PEOPLE, type Person } from "./seed";
import {  templateSettings } from "./templates";
import {
  ARTIFACT_BASE,
  artifactKey,
  getWorld,
  GUEST_LIMITS,
  saveArtifact,
  saveFeatures,
  saveMeta,
  type StoredMap,
  type StoredSession,
  type StoredTenant,
  type StoredVersion,
} from "./world";

export type Dir = Exclude<TextDir, "auto">;

/** One grid for the role model. A contributor's `map:edit` is further limited to maps they created. */
export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  owner: ["map:read", "map:create", "map:edit", "map:publish", "map:archive"],
  admin: ["map:read", "map:create", "map:edit", "map:publish", "map:archive"],
  editor: ["map:read", "map:create", "map:edit", "map:publish"],
  contributor: ["map:read", "map:create", "map:edit"],
  viewer: ["map:read"],
};

const READ_ONLY_REFUSAL = "You have read-only access to this workspace. Ask an owner or admin for an editing role.";

const REFUSALS: Record<Capability, string> = {
  "map:read": "Your role in this workspace cannot open maps.",
  "map:create": "Your role in this workspace cannot create maps.",
  "map:edit": "Your role in this workspace cannot change maps.",
  "map:publish": "Your role can edit maps but not publish them. Ask an editor to publish.",
  "map:archive": "Only an owner or admin can archive or restore a map.",
};

/** Session tokens the mock accepts, and who each signs in as. */
export const MOCK_TOKENS = {
  "mock-owner": "layla",
  "mock-admin": "sarah",
  "mock-editor": "omar",
  "mock-contributor": "youssef",
  "mock-viewer": "hannah",
} as const satisfies Record<string, keyof typeof PEOPLE>;

export const GUEST_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const MAX_BODY_BYTES = 1024 * 1024;
export const HUMAN_CHECK_SITE_KEY = "mock-site-key";

export const nowIso = (): string => new Date().toISOString();

function randomId(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const values = new Uint32Array(length);
  globalThis.crypto.getRandomValues(values);
  let out = "";
  for (const value of values) out += alphabet.charAt(value % alphabet.length);
  return out;
}

/* --------------------------------------------------------------- session */

export function requireSession(): StoredSession {
  const world = getWorld();
  const session = world.session;
  if (!session) throw apiError("unauthorised");
  if (session.expiresAt !== null && Date.parse(session.expiresAt) <= Date.now()) {
    world.session = null;
    saveMeta();
    throw apiError("unauthorised", {
      reason: "This guest workspace has expired and its maps have been removed. Start a new one to continue.",
    });
  }
  return session;
}

export function requireCapability(session: StoredSession, capability: Capability): void {
  if (!ROLE_CAPABILITIES[session.role].includes(capability)) {
    const readOnly = session.role === "viewer" && capability !== "map:read";
    throw apiError("forbidden", { reason: readOnly ? READ_ONLY_REFUSAL : REFUSALS[capability] });
  }
}

export function tenantOf(session: StoredSession): StoredTenant {
  const tenant = getWorld().tenants.find((t) => t.id === session.tenantId);
  if (!tenant) throw apiError("unauthorised", { reason: "The workspace for this session no longer exists." });
  return tenant;
}

export function mapsOf(tenantId: string): StoredMap[] {
  return getWorld().maps.filter((m) => m.doc.tenantId === tenantId);
}

/** Archived maps do not count against the limit; restoring one does. */
export function activeMapCount(tenantId: string): number {
  return mapsOf(tenantId).filter((m) => !m.doc.archived).length;
}

export function toSession(session: StoredSession): Session {
  const tenant = tenantOf(session);
  return {
    userId: session.userId,
    name: session.name,
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    role: session.role,
    capabilities: [...ROLE_CAPABILITIES[session.role]],
    guest: session.guest,
    expiresAt: session.expiresAt,
    usage: { maps: activeMapCount(tenant.id) },
    limits: tenant.limits,
    artifactBase: ARTIFACT_BASE,
  };
}

export function findMap(session: StoredSession, id: string): StoredMap {
  const map = getWorld().maps.find((m) => m.doc.id === id && m.doc.tenantId === session.tenantId);
  if (!map) throw apiError("not_found");
  return map;
}

export function featuresOf(mapId: string): MapFeature[] {
  return getWorld().features.get(mapId) ?? [];
}

export function liveVersion(map: StoredMap): StoredVersion | undefined {
  return map.versions.find((v) => v.record.version === map.doc.publishedVersion);
}

export function memberSession(person: Person): StoredSession {
  const tenant = getWorld().tenants.find((t) => !t.guest);
  if (!tenant) throw apiError("internal_error");
  return { userId: person.userId, name: person.name, tenantId: tenant.id, role: person.role, guest: false, expiresAt: null };
}

export function startGuest(expiresInMs: number): StoredSession {
  const world = getWorld();
  const suffix = randomId(8);
  const tenant: StoredTenant = {
    id: `t_guest_${suffix}`,
    slug: `guest-${suffix}`,
    name: "Guest workspace",
    guest: true,
    limits: GUEST_LIMITS,
  };
  world.tenants.push(tenant);
  const session: StoredSession = {
    userId: `u_guest_${suffix}`,
    name: "Guest",
    tenantId: tenant.id,
    role: "owner",
    guest: true,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  };
  world.session = session;
  return session;
}

/* ------------------------------------------------------------------ maps */

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function uniqueSlug(tenantId: string, title: string): string {
  const taken = new Set(mapsOf(tenantId).map((m) => m.doc.slug));
  /* An Arabic title leaves nothing, or only a stray number, to build a slug from. */
  const fromTitle = slugify(title);
  const base = /[a-z]{3}/.test(fromTitle) ? fromTitle : `map-${randomId(6)}`;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export function summarise(map: StoredMap): MapSummary {
  const { doc } = map;
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
    featureCount: featuresOf(doc.id).length,
    archived: doc.archived,
    thumbnail: {
      center: doc.settings.openingView.center,
      zoom: doc.settings.openingView.zoom,
      basemap: doc.settings.basemap.styleId,
    },
  };
}

export function insertMap(session: StoredSession, input: { title: RichText; uiDir: Dir; template: TemplateSummary["id"] }): MapDoc {
  const world = getWorld();
  const tenant = tenantOf(session);
  const value = input.title.value.trim();
  const title: RichText = value.length > 0 ? { ...input.title, value } : { value: input.uiDir === "rtl" ? "خريطة بلا عنوان" : "Untitled map", dir: input.uiDir };
  const doc: MapDoc = {
    id: `m_${randomId()}`,
    tenantId: tenant.id,
    slug: uniqueSlug(tenant.id, title.value),
    title,
    uiDir: input.uiDir,
    settings: templateSettings(input.template, input.uiDir),
    rev: 1,
    publishedVersion: null,
    publishedRev: null,
    archived: false,
    updatedAt: nowIso(),
    updatedBy: session.name,
    createdBy: { userId: session.userId, name: session.name },
  };
  world.maps.push({ doc, createdBy: session.userId, versions: [] });
  world.features.set(doc.id, []);
  saveFeatures(doc.id);
  return doc;
}

export function requireWritable(session: StoredSession, map: StoredMap): void {
  if (session.role === "contributor" && map.createdBy !== session.userId) {
    throw apiError("forbidden", { reason: "Contributors can change only the maps they created. This one belongs to someone else." });
  }
  if (map.doc.archived) {
    throw apiError("forbidden", { reason: "This map is archived. Restore it to make changes." });
  }
}

export function mintVersion(
  session: StoredSession,
  map: StoredMap,
  build: (version: number, publishedAt: string) => { artifact: MapVersion; hash: string; builtFromRev: number; origin: VersionRecord["origin"] },
): StoredVersion {
  const world = getWorld();
  const tenant = tenantOf(session);
  const limit = tenant.limits.maxVersionsPerMap;
  if (limit !== null && map.versions.length >= limit) {
    throw apiError("quota_exceeded", {
      reason: `This workspace keeps ${limit} versions of a map, and this map has ${map.versions.length}.`,
    });
  }
  const version = map.versions.reduce((highest, v) => Math.max(highest, v.record.version), 0) + 1;
  const publishedAt = nowIso();
  const { artifact, hash, builtFromRev, origin } = build(version, publishedAt);
  const { etag, byteSize } = measure(artifact);
  const storageKey = versionKey(tenant.slug, map.doc.slug, version);
  const stored: StoredVersion = {
    hash,
    builtFromRev,
    record: {
      mapId: map.doc.id,
      version,
      etag,
      storageKey,
      url: `${ARTIFACT_BASE}/${storageKey}`,
      byteSize,
      featureCount: artifact.features.length,
      publishedAt,
      publishedBy: { userId: session.userId, name: session.name },
      cacheControl: VERSION_CACHE_CONTROL,
      origin,
    },
  };
  world.artifacts.set(artifactKey(map.doc.id, version), artifact);
  map.versions.push(stored);
  map.doc.publishedVersion = version;
  map.doc.publishedRev = builtFromRev;
  saveArtifact(map.doc.id, version);
  saveMeta();
  return stored;
}
