/**
 * Everything the mock server holds, and how it survives a reload.
 *
 * The seed is rebuilt on every page load from the moment it was first built
 * (`seededAt`), which makes it deterministic. Only what differs from the seed
 * is written to `sessionStorage`: the small index of tenants, maps, version
 * records and the session; the feature list of any map that was edited; and
 * the artifact of any version published in this tab. That keeps a tab's
 * storage small even though one seeded map has several thousand features.
 */
import type { MapDoc, MapFeature, MapVersion, Role, Session, VersionRecord } from "@/model/types";
import { buildArtifact, contentHash, measure, VERSION_CACHE_CONTROL, versionKey } from "./publish";
import { buildSeedMaps, MEMBER_TENANT, PEOPLE, type SeedMap } from "./seed";

export const ARTIFACT_BASE = "https://cdn.livemap.example";

export const MEMBER_LIMITS: Session["limits"] = { maxMaps: 200, maxFeaturesPerMap: 5000, maxVersionsPerMap: null };
export const GUEST_LIMITS: Session["limits"] = { maxMaps: 5, maxFeaturesPerMap: 2000, maxVersionsPerMap: 25 };

export type PersonaId =
  | "signed-out"
  | "owner"
  | "admin"
  | "editor"
  | "contributor"
  | "viewer"
  | "guest"
  | "guest-full"
  | "guest-expired"
  | "guest-disabled"
  | "guest-capacity"
  | "rate-limited";

export interface StoredVersion {
  record: VersionRecord;
  /** Hash of the publishable content, for the "unchanged" check. */
  hash: string;
  /** The draft revision this content came from; a rollback inherits its source's. */
  builtFromRev: number;
}

export interface StoredMap {
  doc: MapDoc;
  /** User id; a contributor may edit only what they created. */
  createdBy: string;
  /** Oldest first. */
  versions: StoredVersion[];
}

export interface StoredTenant {
  id: string;
  slug: string;
  name: string;
  guest: boolean;
  limits: Session["limits"];
}

export interface StoredSession {
  userId: string;
  name: string;
  tenantId: string;
  role: Role;
  guest: boolean;
  expiresAt: string | null;
}

export interface Switches {
  guestSignup: boolean;
  /** Starting a guest workspace answers 503 guest_capacity. */
  guestCapacityFull: boolean;
  /** Every data call answers 429 rate_limited. */
  rateLimited: boolean;
  /** Guest signup requires a human-check token. */
  humanCheck: boolean;
}

export const DEFAULT_SWITCHES: Switches = { guestSignup: true, guestCapacityFull: false, rateLimited: false, humanCheck: false };

export interface World {
  seededAt: number;
  tenants: StoredTenant[];
  maps: StoredMap[];
  session: StoredSession | null;
  persona: PersonaId | null;
  switches: Switches;
  features: Map<string, MapFeature[]>;
  /** Keyed by `artifactKey`. */
  artifacts: Map<string, MapVersion>;
  /** Maps whose features differ from the seed and are therefore stored. */
  dirtyFeatures: Set<string>;
  /** Artifacts minted in this tab and therefore stored. */
  storedArtifacts: Set<string>;
}

export const artifactKey = (mapId: string, version: number): string => `${mapId}/${version}`;

/* ------------------------------------------------------------------ seed */

function seedMap(seed: SeedMap, world: World): void {
  const versions: StoredVersion[] = [];
  seed.versions.forEach((spec, index) => {
    const version = index + 1;
    const publisher = PEOPLE[spec.by];
    const storageKey = versionKey(MEMBER_TENANT.slug, seed.slug, version);
    let artifact: MapVersion;
    let hash: string;
    let builtFromRev: number;
    let origin: VersionRecord["origin"];
    if (spec.kind === "publish") {
      artifact = buildArtifact(
        { mapId: seed.id, title: seed.title, uiDir: seed.uiDir, settings: seed.settings, features: seed.snapshot(spec.step) },
        version,
        spec.at,
      );
      hash = contentHash(artifact);
      builtFromRev = spec.rev;
      origin = { type: "publish", rev: spec.rev };
    } else {
      const source = versions[spec.toVersion - 1];
      const sourceArtifact = world.artifacts.get(artifactKey(seed.id, spec.toVersion));
      if (!source || !sourceArtifact) throw new Error(`seed: ${seed.id} rolls back to a missing version ${spec.toVersion}`);
      artifact = { ...sourceArtifact, version, publishedAt: spec.at };
      hash = source.hash;
      builtFromRev = source.builtFromRev;
      origin = { type: "rollback", fromVersion: spec.toVersion };
    }
    const { etag, byteSize } = measure(artifact);
    world.artifacts.set(artifactKey(seed.id, version), artifact);
    versions.push({
      hash,
      builtFromRev,
      record: {
        mapId: seed.id,
        version,
        etag,
        storageKey,
        url: `${ARTIFACT_BASE}/${storageKey}`,
        byteSize,
        featureCount: artifact.features.length,
        publishedAt: spec.at,
        publishedBy: { userId: publisher.userId, name: publisher.name },
        cacheControl: VERSION_CACHE_CONTROL,
        origin,
      },
    });
  });

  const live = versions[versions.length - 1];
  world.features.set(seed.id, seed.draft);
  world.maps.push({
    createdBy: PEOPLE[seed.createdBy].userId,
    versions,
    doc: {
      id: seed.id,
      tenantId: MEMBER_TENANT.id,
      slug: seed.slug,
      title: seed.title,
      uiDir: seed.uiDir,
      settings: seed.settings,
      rev: seed.rev,
      publishedVersion: live ? live.record.version : null,
      publishedRev: live ? live.builtFromRev : null,
      archived: seed.archived ?? false,
      updatedAt: seed.updated.at,
      updatedBy: PEOPLE[seed.updated.by].name,
      createdBy: { userId: PEOPLE[seed.createdBy].userId, name: PEOPLE[seed.createdBy].name },
    },
  });
}

function seedWorld(seededAt: number): World {
  const world: World = {
    seededAt,
    tenants: [{ ...MEMBER_TENANT, guest: false, limits: MEMBER_LIMITS }],
    maps: [],
    session: null,
    persona: null,
    switches: { ...DEFAULT_SWITCHES },
    features: new Map(),
    artifacts: new Map(),
    dirtyFeatures: new Set(),
    storedArtifacts: new Set(),
  };
  for (const seed of buildSeedMaps(seededAt)) seedMap(seed, world);
  return world;
}

/* ----------------------------------------------------------- persistence */

/* v2: map documents gained `createdBy`; an index stored by v1 lacks it. */
const PREFIX = "livemap.mock.v2";
const META_KEY = `${PREFIX}/meta`;
const featuresKey = (mapId: string): string => `${PREFIX}/features/${mapId}`;
const storedArtifactKey = (key: string): string => `${PREFIX}/artifact/${key}`;

interface Meta {
  schema: 1;
  seededAt: number;
  tenants: StoredTenant[];
  maps: StoredMap[];
  session: StoredSession | null;
  persona: PersonaId | null;
  switches: Switches;
  dirtyFeatures: string[];
  storedArtifacts: string[];
}

/**
 * The index is this module's own output under a versioned key, so the check
 * is on its outline: a different or damaged shape is discarded for the seed.
 */
function isMeta(value: unknown): value is Meta {
  if (typeof value !== "object" || value === null) return false;
  return (
    "schema" in value &&
    value.schema === 1 &&
    "seededAt" in value &&
    typeof value.seededAt === "number" &&
    "tenants" in value &&
    Array.isArray(value.tenants) &&
    "maps" in value &&
    Array.isArray(value.maps) &&
    "session" in value &&
    "switches" in value &&
    typeof value.switches === "object" &&
    "dirtyFeatures" in value &&
    Array.isArray(value.dirtyFeatures) &&
    "storedArtifacts" in value &&
    Array.isArray(value.storedArtifacts)
  );
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function read(key: string): unknown {
  try {
    const text = storage()?.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage is full or blocked: the tab keeps working from memory, and a reload returns to the last state that fitted. */
  }
}

function isFeatureList(value: unknown): value is MapFeature[] {
  return Array.isArray(value) && value.every((f) => typeof f === "object" && f !== null && "id" in f && "kind" in f);
}

function isArtifact(value: unknown): value is MapVersion {
  return typeof value === "object" && value !== null && "mapId" in value && "version" in value && "features" in value;
}

function loadWorld(): World {
  const stored = read(META_KEY);
  if (!isMeta(stored)) return seedWorld(Date.now());

  const world = seedWorld(stored.seededAt);
  world.tenants = stored.tenants;
  world.maps = stored.maps;
  world.session = stored.session;
  world.persona = stored.persona;
  world.switches = { ...DEFAULT_SWITCHES, ...stored.switches };

  for (const mapId of stored.dirtyFeatures) {
    const features = read(featuresKey(mapId));
    if (isFeatureList(features)) {
      world.features.set(mapId, features);
      world.dirtyFeatures.add(mapId);
    }
  }
  for (const key of stored.storedArtifacts) {
    const artifact = read(storedArtifactKey(key));
    if (isArtifact(artifact)) {
      world.artifacts.set(key, artifact);
      world.storedArtifacts.add(key);
    }
  }
  /* A map whose features could not be read back would otherwise be missing its list. */
  for (const map of world.maps) {
    if (!world.features.has(map.doc.id)) world.features.set(map.doc.id, []);
  }
  return world;
}

let current: World | null = null;

export function getWorld(): World {
  current ??= loadWorld();
  return current;
}

/** Write the index: tenants, map documents, version records, session, switches. */
export function saveMeta(): void {
  const world = getWorld();
  const meta: Meta = {
    schema: 1,
    seededAt: world.seededAt,
    tenants: world.tenants,
    maps: world.maps,
    session: world.session,
    persona: world.persona,
    switches: world.switches,
    dirtyFeatures: [...world.dirtyFeatures],
    storedArtifacts: [...world.storedArtifacts],
  };
  write(META_KEY, meta);
}

export function saveFeatures(mapId: string): void {
  const world = getWorld();
  world.dirtyFeatures.add(mapId);
  write(featuresKey(mapId), world.features.get(mapId) ?? []);
}

export function saveArtifact(mapId: string, version: number): void {
  const world = getWorld();
  const key = artifactKey(mapId, version);
  const artifact = world.artifacts.get(key);
  if (!artifact) return;
  world.storedArtifacts.add(key);
  write(storedArtifactKey(key), artifact);
}

/** Forget everything this tab stored and start again from a fresh seed. */
export function resetWorld(): World {
  try {
    const store = storage();
    if (store) {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key?.startsWith(PREFIX)) keys.push(key);
      }
      for (const key of keys) store.removeItem(key);
    }
  } catch {
    /* Nothing was stored, so there is nothing to clear. */
  }
  current = seedWorld(Date.now());
  return current;
}
