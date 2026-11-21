// Published maps are immutable objects behind a CDN, not database rows.

export interface PutOptions {
  readonly contentType: string;
  readonly cacheControl: string;
  readonly etag: string;
}

export interface StoredObject {
  readonly body: string;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly etag: string;
}

export interface ArtifactStore {
  put(key: string, body: string, options: PutOptions): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  /** Used by the reconciliation sweep to find orphaned version rows. */
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /**
   * Removes every object under a prefix and returns how many. For reaping a
   * tenant: its artifacts are public, so they have to go when it does.
   */
  deletePrefix(prefix: string): Promise<number>;
}

export class MemoryArtifactStore implements ArtifactStore {
  private readonly objects = new Map<string, StoredObject>();
  /** Every put, in order — write order is part of the publish contract. */
  readonly writeLog: string[] = [];

  async put(key: string, body: string, options: PutOptions): Promise<void> {
    this.objects.set(key, {
      body,
      contentType: options.contentType,
      cacheControl: options.cacheControl,
      etag: options.etag,
    });
    this.writeLog.push(key);
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }

  async has(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
    this.writeLog.push(`DELETE ${key}`);
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix) throw new Error("deletePrefix needs a non-empty prefix");
    let n = 0;
    for (const key of [...this.objects.keys()]) {
      if (!key.startsWith(prefix)) continue;
      await this.delete(key);
      n++;
    }
    return n;
  }

  get size(): number {
    return this.objects.size;
  }
}

/** Fails on command, to exercise partial-failure paths in `publish.ts`. */
export class FailingArtifactStore implements ArtifactStore {
  constructor(
    private readonly inner: ArtifactStore,
    /** Keys matching this fail on `put`. */
    private readonly failOn: (key: string) => boolean,
  ) {}

  async put(key: string, body: string, options: PutOptions): Promise<void> {
    if (this.failOn(key)) {
      throw new Error(`simulated storage failure for ${key}`);
    }
    return this.inner.put(key, body, options);
  }

  get(key: string): Promise<StoredObject | null> {
    return this.inner.get(key);
  }
  has(key: string): Promise<boolean> {
    return this.inner.has(key);
  }
  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }
  deletePrefix(prefix: string): Promise<number> {
    return this.inner.deletePrefix(prefix);
  }
}

/** Object key layout. Kept in one place so the CDN config can mirror it. */
export const keys = {
  version: (tenantSlug: string, mapSlug: string, version: number): string =>
    `t/${tenantSlug}/m/${mapSlug}/v/${version}.json`,
  pointer: (tenantSlug: string, mapSlug: string): string =>
    `t/${tenantSlug}/m/${mapSlug}/latest.json`,
  /** Everything a tenant has ever published. Trailing slash, so `t/ab` never matches `t/abc`. */
  tenant: (tenantSlug: string): string => `t/${tenantSlug}/`,
};
