// PostgresRepo will live in postgres.ts.

import type { MapDoc, MapFeature } from "@livemap/core";

export interface VersionRecord {
  readonly mapId: string;
  readonly version: number;
  readonly etag: string;
  readonly storageKey: string;
  readonly byteSize: number;
  readonly featureCount: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export interface MapRepo {
  getMap(tenantId: string, mapId: string): Promise<MapDoc | null>;
  listFeatures(tenantId: string, mapId: string): Promise<MapFeature[]>;
  /** Atomic, guarded by the revision the caller read. Null = guard failed. */
  applyEdit(
    tenantId: string,
    mapId: string,
    expectedRev: number,
    put: readonly MapFeature[],
    remove: readonly string[],
  ): Promise<number | null>;
  nextVersion(tenantId: string, mapId: string): Promise<number>;
  getLatestVersion(tenantId: string, mapId: string): Promise<VersionRecord | null>;
  recordVersion(tenantId: string, record: VersionRecord): Promise<void>;
  setPublishedVersion(
    tenantId: string,
    mapId: string,
    version: number,
  ): Promise<void>;
}

/** In-memory implementation. Used by tests and the local dev server. */
export class MemoryMapRepo implements MapRepo {
  private readonly maps = new Map<string, MapDoc>();
  private readonly features = new Map<string, Map<string, MapFeature>>();
  private readonly versions = new Map<string, VersionRecord[]>();

  private key(tenantId: string, mapId: string): string {
    return `${tenantId}/${mapId}`;
  }

  seed(doc: MapDoc, features: readonly MapFeature[]): void {
    this.maps.set(this.key(doc.tenantId, doc.id), doc);
    this.features.set(
      this.key(doc.tenantId, doc.id),
      new Map(features.map((f) => [f.id, f])),
    );
  }

  async getMap(tenantId: string, mapId: string): Promise<MapDoc | null> {
    return this.maps.get(this.key(tenantId, mapId)) ?? null;
  }

  async listFeatures(tenantId: string, mapId: string): Promise<MapFeature[]> {
    const m = this.features.get(this.key(tenantId, mapId));
    return m ? [...m.values()] : [];
  }

  async applyEdit(
    tenantId: string,
    mapId: string,
    expectedRev: number,
    put: readonly MapFeature[],
    remove: readonly string[],
  ): Promise<number | null> {
    const k = this.key(tenantId, mapId);
    const doc = this.maps.get(k);
    if (!doc) return null;

    // A stale writer loses rather than clobbering an edit it never saw.
    if (doc.rev !== expectedRev) return null;

    const feats = this.features.get(k) ?? new Map<string, MapFeature>();
    for (const id of remove) feats.delete(id);
    for (const f of put) feats.set(f.id, f);
    this.features.set(k, feats);

    const nextRev = doc.rev + 1;
    this.maps.set(k, { ...doc, rev: nextRev, updatedAt: new Date().toISOString() });
    return nextRev;
  }

  async nextVersion(tenantId: string, mapId: string): Promise<number> {
    const list = this.versions.get(this.key(tenantId, mapId)) ?? [];
    return list.length === 0 ? 1 : Math.max(...list.map((v) => v.version)) + 1;
  }

  async getLatestVersion(
    tenantId: string,
    mapId: string,
  ): Promise<VersionRecord | null> {
    const list = this.versions.get(this.key(tenantId, mapId)) ?? [];
    if (list.length === 0) return null;
    return list.reduce((a, b) => (a.version > b.version ? a : b));
  }

  async recordVersion(tenantId: string, record: VersionRecord): Promise<void> {
    const k = this.key(tenantId, record.mapId);
    const list = this.versions.get(k) ?? [];
    list.push(record);
    this.versions.set(k, list);
  }

  async setPublishedVersion(
    tenantId: string,
    mapId: string,
    version: number,
  ): Promise<void> {
    const k = this.key(tenantId, mapId);
    const doc = this.maps.get(k);
    if (doc) this.maps.set(k, { ...doc, publishedVersion: version });
  }

  /** Test helper: all recorded versions for a map, ascending. */
  allVersions(tenantId: string, mapId: string): VersionRecord[] {
    return [...(this.versions.get(this.key(tenantId, mapId)) ?? [])].sort(
      (a, b) => a.version - b.version,
    );
  }
}
