/**
 * The rules a real server enforces, applied to the in-memory world. Every
 * function here is synchronous and throws `ApiError`; latency, forced
 * failures and cloning of results are added around it in `index.ts`.
 */
import type { ApiClient, EditRequest, PublishedPointerResult, PublishResult } from "@/api/client";
import { applySettingsPatch } from "@livemap/core";
import { compareOrder } from "@/model/order";
import type {
  AppConfig,
  MapDoc,
  MapFeature,
  MapSummary,
  MapVersion,
  PlaceResult,
  Session,
  TemplateSummary,
  VersionPointer,
  VersionRecord,
} from "@/model/types";
import { apiError } from "./errors";
import { searchGazetteer } from "@livemap/core";
import {
  buildArtifact,
  contentHash,
  POINTER_CACHE_CONTROL,
  pointerKey,
} from "./publish";
import { PEOPLE } from "./seed";
import { TEMPLATES } from "./templates";
import {
  ARTIFACT_BASE,
  artifactKey,
  getWorld,
  GUEST_LIMITS,
  saveFeatures,
  saveMeta,
} from "./world";

import {
  MOCK_TOKENS,
  GUEST_LIFETIME_MS,
  MAX_BODY_BYTES,
  HUMAN_CHECK_SITE_KEY,
  nowIso,
  requireSession,
  requireCapability,
  tenantOf,
  mapsOf,
  activeMapCount,
  toSession,
  findMap,
  featuresOf,
  liveVersion,
  memberSession,
  startGuest,
  summarise,
  insertMap,
  requireWritable,
  mintVersion,
} from "./server-rules";

export { MOCK_TOKENS, ROLE_CAPABILITIES } from "./server-rules";

/* ------------------------------------------------------------ the server */

type Sync<T> = { [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => R : never };

/** `ApiClient`, minus the waiting. */
export const server: Sync<ApiClient> = {
  getConfig(): AppConfig {
    const { switches } = getWorld();
    return {
      artifactBase: ARTIFACT_BASE,
      guestSignup: switches.guestSignup,
      humanCheckSiteKey: switches.humanCheck ? HUMAN_CHECK_SITE_KEY : null,
      guest: switches.guestSignup
        ? {
            lifetimeHours: GUEST_LIFETIME_MS / 3_600_000,
            maxMaps: GUEST_LIMITS.maxMaps,
            maxFeaturesPerMap: GUEST_LIMITS.maxFeaturesPerMap,
            maxVersionsPerMap: GUEST_LIMITS.maxVersionsPerMap ?? 0,
          }
        : null,
    };
  },

  signInAsGuest(input): Session {
    const world = getWorld();
    if (!world.switches.guestSignup) throw apiError("guest_signup_disabled");
    if (world.switches.guestCapacityFull) throw apiError("guest_capacity");
    if (world.switches.humanCheck && (!input.humanCheckToken || input.humanCheckToken === "fail")) {
      throw apiError("human_check_failed");
    }
    const session = startGuest(GUEST_LIFETIME_MS);
    world.persona = null;
    saveMeta();
    return toSession(session);
  },

  signInWithToken(token): Session {
    const world = getWorld();
    const entry = Object.entries(MOCK_TOKENS).find(([known]) => known === token.trim());
    if (!entry) {
      throw apiError("unauthorised", { reason: "That token was not recognised. Check that all of it was pasted." });
    }
    const session = memberSession(PEOPLE[entry[1]]);
    world.session = session;
    world.persona = null;
    saveMeta();
    return toSession(session);
  },

  signOut(): void {
    const world = getWorld();
    world.session = null;
    world.persona = null;
    saveMeta();
  },

  getSession(): Session {
    return toSession(requireSession());
  },

  listTemplates(): TemplateSummary[] {
    requireSession();
    return [...TEMPLATES];
  },

  listMaps(input): MapSummary[] {
    const session = requireSession();
    requireCapability(session, "map:read");
    return mapsOf(session.tenantId)
      .filter((m) => m.doc.archived === input.archived)
      .map(summarise)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  },

  createMap(input): MapDoc {
    const session = requireSession();
    requireCapability(session, "map:create");
    const tenant = tenantOf(session);
    const count = activeMapCount(tenant.id);
    if (count >= tenant.limits.maxMaps) {
      throw apiError("quota_exceeded", {
        reason: session.guest
          ? `A guest workspace holds ${tenant.limits.maxMaps} maps and this one is full. Archive a map to make room.`
          : `This workspace holds ${tenant.limits.maxMaps} maps and is full. Archive a map to make room.`,
      });
    }
    const doc = insertMap(session, input);
    saveMeta();
    return doc;
  },

  getMap(id): { map: MapDoc; features: MapFeature[] } {
    const session = requireSession();
    requireCapability(session, "map:read");
    const map = findMap(session, id);
    return { map: map.doc, features: [...featuresOf(id)].sort(compareOrder) };
  },

  archiveMap(id): void {
    const session = requireSession();
    requireCapability(session, "map:archive");
    const map = findMap(session, id);
    map.doc.archived = true;
    saveMeta();
  },

  unarchiveMap(id): void {
    const session = requireSession();
    requireCapability(session, "map:archive");
    const map = findMap(session, id);
    if (!map.doc.archived) return;
    const tenant = tenantOf(session);
    if (activeMapCount(tenant.id) >= tenant.limits.maxMaps) {
      throw apiError("quota_exceeded", {
        reason: `This workspace holds ${tenant.limits.maxMaps} maps and is full. Archive another map before restoring this one.`,
      });
    }
    map.doc.archived = false;
    saveMeta();
  },

  editMap(id, edit: EditRequest): { rev: number; updatedAt: string } {
    const world = getWorld();
    const session = requireSession();
    requireCapability(session, "map:edit");
    const map = findMap(session, id);
    requireWritable(session, map);

    if (new TextEncoder().encode(JSON.stringify(edit)).length > MAX_BODY_BYTES) {
      throw apiError("body_too_large", {
        reason: "This save is larger than 1 MB. Save more often, or import large files in parts.",
      });
    }
    if (edit.rev !== map.doc.rev && !edit.force) {
      throw apiError("stale_revision", {
        reason: `${map.doc.updatedBy} saved this map after you opened it.`,
        current: { rev: map.doc.rev, updatedBy: map.doc.updatedBy, updatedAt: map.doc.updatedAt },
      });
    }

    const updatedAt = nowIso();
    const next = new Map(featuresOf(id).map((f) => [f.id, f]));
    for (const featureId of edit.delete) next.delete(featureId);
    for (const feature of edit.put) next.set(feature.id, { ...feature, updatedAt, updatedBy: session.name });

    const limit = tenantOf(session).limits.maxFeaturesPerMap;
    if (next.size > limit) {
      throw apiError("quota_exceeded", {
        reason: `A map in this workspace can hold ${limit.toLocaleString("en")} features; this save would make ${next.size.toLocaleString("en")}.`,
      });
    }

    world.features.set(id, [...next.values()]);
    if (edit.settings) map.doc.settings = applySettingsPatch(map.doc.settings, edit.settings);
    if (edit.title) map.doc.title = edit.title;
    if (edit.uiDir) map.doc.uiDir = edit.uiDir;
    map.doc.rev += 1;
    map.doc.updatedAt = updatedAt;
    map.doc.updatedBy = session.name;
    saveFeatures(id);
    saveMeta();
    return { rev: map.doc.rev, updatedAt };
  },

  publishMap(id): PublishResult {
    const session = requireSession();
    requireCapability(session, "map:publish");
    const map = findMap(session, id);
    if (map.doc.archived) throw apiError("forbidden", { reason: "This map is archived. Restore it to publish." });

    const draft = { mapId: id, title: map.doc.title, uiDir: map.doc.uiDir, settings: map.doc.settings, features: featuresOf(id) };
    const live = liveVersion(map);
    const hash = contentHash(buildArtifact(draft, 0, ""));
    if (live && live.hash === hash) {
      /* Nothing a reader would see has changed, so the live version now stands for this revision too. */
      map.doc.publishedRev = map.doc.rev;
      saveMeta();
      return { status: "unchanged", version: live.record.version, etag: live.record.etag };
    }
    const rev = map.doc.rev;
    const minted = mintVersion(session, map, (version, publishedAt) => ({
      artifact: buildArtifact(draft, version, publishedAt),
      hash,
      builtFromRev: rev,
      origin: { type: "publish", rev },
    }));
    return { status: "published", version: minted.record.version, etag: minted.record.etag };
  },

  listVersions(id): { pointer: VersionPointer; versions: VersionRecord[] } {
    const session = requireSession();
    requireCapability(session, "map:read");
    const map = findMap(session, id);
    const live = liveVersion(map);
    return {
      pointer: {
        version: map.doc.publishedVersion,
        url: `${ARTIFACT_BASE}/${pointerKey(tenantOf(session).slug, map.doc.slug)}`,
        etag: live ? live.record.etag : null,
        cacheControl: POINTER_CACHE_CONTROL,
        updatedAt: live ? live.record.publishedAt : null,
      },
      versions: map.versions.map((v) => v.record).sort((a, b) => b.version - a.version),
    };
  },

  getVersion(id, version): MapVersion {
    const session = requireSession();
    requireCapability(session, "map:read");
    findMap(session, id);
    const artifact = getWorld().artifacts.get(artifactKey(id, version));
    if (!artifact) throw apiError("not_found", { reason: `This map has no version ${version}.` });
    return artifact;
  },

  rollbackMap(id, input): { status: "rolled_back"; version: number } {
    const session = requireSession();
    requireCapability(session, "map:publish");
    const map = findMap(session, id);
    if (map.doc.archived) throw apiError("forbidden", { reason: "This map is archived. Restore it to roll back." });
    const source = map.versions.find((v) => v.record.version === input.toVersion);
    const sourceArtifact = getWorld().artifacts.get(artifactKey(id, input.toVersion));
    if (!source || !sourceArtifact) throw apiError("not_found", { reason: `This map has no version ${input.toVersion}.` });
    const minted = mintVersion(session, map, (version, publishedAt) => ({
      artifact: { ...sourceArtifact, version, publishedAt },
      hash: source.hash,
      builtFromRev: source.builtFromRev,
      origin: { type: "rollback", fromVersion: input.toVersion },
    }));
    return { status: "rolled_back", version: minted.record.version };
  },

  getPublished(tenantSlug, mapSlug): MapVersion | null {
    const world = getWorld();
    const tenant = world.tenants.find((t) => t.slug === tenantSlug);
    const map = tenant ? world.maps.find((m) => m.doc.tenantId === tenant.id && m.doc.slug === mapSlug) : undefined;
    if (!map) throw apiError("not_found", { reason: "There is no map at this address." });
    if (map.doc.publishedVersion === null) return null;
    return world.artifacts.get(artifactKey(map.doc.id, map.doc.publishedVersion)) ?? null;
  },

  getPublishedPointer(tenantSlug, mapSlug, input): PublishedPointerResult {
    const world = getWorld();
    const tenant = world.tenants.find((t) => t.slug === tenantSlug);
    const map = tenant ? world.maps.find((m) => m.doc.tenantId === tenant.id && m.doc.slug === mapSlug) : undefined;
    if (!tenant || !map) throw apiError("not_found", { reason: "There is no map at this address." });
    const live = liveVersion(map);
    const etag = live ? live.record.etag : null;
    if (etag !== null && input?.ifNoneMatch === etag) return { notModified: true };
    return {
      notModified: false,
      pointer: {
        version: map.doc.publishedVersion,
        url: `${ARTIFACT_BASE}/${pointerKey(tenant.slug, map.doc.slug)}`,
        etag,
        cacheControl: POINTER_CACHE_CONTROL,
        updatedAt: live ? live.record.publishedAt : null,
      },
    };
  },

  getPublishedVersion(tenantSlug, mapSlug, version): MapVersion {
    const world = getWorld();
    const tenant = world.tenants.find((t) => t.slug === tenantSlug);
    const map = tenant ? world.maps.find((m) => m.doc.tenantId === tenant.id && m.doc.slug === mapSlug) : undefined;
    const artifact = map ? world.artifacts.get(artifactKey(map.doc.id, version)) : undefined;
    if (!artifact) throw apiError("not_found", { reason: "There is no such version at this address." });
    return artifact;
  },

  searchPlaces(query, input): PlaceResult[] {
    requireSession();
    return searchGazetteer(query, input.language);
  },
};
