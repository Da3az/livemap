import { AwsClient } from "aws4fetch";
import type { ArtifactStore, PutOptions, StoredObject } from "./storage.js";

export interface R2Options {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Override for an S3-compatible endpoint other than R2's. */
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Our ETag is a hash of the map's content, chosen so that a republish of the
 * same content keeps it. R2 computes its own ETag from the stored bytes and
 * that is the one it serves, so ours rides along as object metadata instead.
 *
 * Nothing on the read path depends on the two being equal: the viewer echoes
 * back whatever validator it was given and decides whether to re-render from
 * the pointer's version number. The one visible difference from the in-memory
 * store is after a rollback, when the pointer's bytes change (new version
 * number) but our hash does not — R2 answers 200 where the dev route would
 * have answered 304, and the viewer fetches an artifact it already has.
 */
const META_ETAG = "x-amz-meta-livemap-etag";

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/** Keys out of a ListObjectsV2 response. The format is fixed; a parser would be a dependency for one tag. */
function listedKeys(xml: string): string[] {
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) =>
    m[1]!.replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e]!),
  );
}

function nextToken(xml: string): string | null {
  if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) return null;
  return /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
}

export class R2ArtifactStore implements ArtifactStore {
  private readonly client: AwsClient;
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(opts: R2Options) {
    this.client = new AwsClient({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      service: "s3",
      // R2's credential scope is the literal string "auto".
      region: "auto",
    });
    const endpoint =
      opts.endpoint ?? `https://${opts.accountId}.r2.cloudflarestorage.com`;
    this.base = `${endpoint.replace(/\/$/, "")}/${opts.bucket}`;
    // Wrapped for the same reason as in the editor: a bare `fetch` called as a
    // property loses its receiver and throws "Illegal invocation".
    this.doFetch = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  private url(key: string): string {
    // Segment by segment, so the slashes that structure a key stay slashes.
    return `${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  /**
   * Signed here and sent through our own fetch, rather than `client.fetch`:
   * that retries ten times with backoff, which on the publish path would turn
   * an outage into a request that hangs for most of a minute.
   */
  private async send(url: string, init: RequestInit): Promise<Response> {
    return this.doFetch(await this.client.sign(url, init));
  }

  private async fail(op: string, key: string, res: Response): Promise<never> {
    // Status only. The body can name the bucket and the account, and this
    // message may end up in a log line that leaves the process.
    await res.body?.cancel();
    throw new Error(`R2 ${op} failed for ${key}: ${res.status}`);
  }

  async put(key: string, body: string, options: PutOptions): Promise<void> {
    const res = await this.send(this.url(key), {
      method: "PUT",
      body,
      headers: {
        "content-type": options.contentType,
        // Stored with the object and replayed on every read, so the CDN
        // serves `immutable` or `max-age=5` with no edge rule to keep in step.
        "cache-control": options.cacheControl,
        [META_ETAG]: options.etag,
      },
    });
    if (!res.ok) await this.fail("put", key, res);
    await res.body?.cancel();
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await this.send(this.url(key), { method: "GET" });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) await this.fail("get", key, res);
    return {
      body: await res.text(),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      cacheControl: res.headers.get("cache-control") ?? "",
      etag: res.headers.get(META_ETAG) ?? res.headers.get("etag") ?? "",
    };
  }

  async has(key: string): Promise<boolean> {
    const res = await this.send(this.url(key), { method: "HEAD" });
    if (res.status === 404) return false;
    if (!res.ok) await this.fail("head", key, res);
    return true;
  }

  async delete(key: string): Promise<void> {
    const res = await this.send(this.url(key), { method: "DELETE" });
    // Deleting what is already gone is the outcome that was asked for.
    if (!res.ok && res.status !== 404) await this.fail("delete", key, res);
    await res.body?.cancel();
  }

  async deletePrefix(prefix: string): Promise<number> {
    // An empty prefix lists the whole bucket. No caller means that.
    if (!prefix) throw new Error("deletePrefix needs a non-empty prefix");

    let deleted = 0;
    let token: string | null = null;
    do {
      const q = new URLSearchParams({ "list-type": "2", prefix });
      if (token) q.set("continuation-token", token);
      const res: Response = await this.send(`${this.base}?${q}`, {
        method: "GET",
      });
      if (!res.ok) await this.fail("list", prefix, res);
      const xml: string = await res.text();

      // One request per key rather than a batch delete: the batch form needs a
      // body checksum, and that is exactly where S3 clients and R2 have
      // disagreed. A reaped guest holds a few dozen objects at most.
      for (const key of listedKeys(xml)) {
        await this.delete(key);
        deleted++;
      }
      token = nextToken(xml);
    } while (token);
    return deleted;
  }
}

/** Builds the store from the environment, or returns null when R2 is not configured. */
export function r2FromEnv(
  env: Record<string, string | undefined>,
): R2ArtifactStore | null {
  const names = [
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ] as const;
  const set = names.filter((n) => env[n]);
  if (set.length === 0) return null;
  if (set.length < names.length) {
    // Half a configuration is a mistake, and falling back to memory would
    // hide it until the first restart lost every published map.
    const missing = names.filter((n) => !env[n]);
    throw new Error(`R2 is partly configured; missing ${missing.join(", ")}`);
  }
  return new R2ArtifactStore({
    accountId: env.R2_ACCOUNT_ID!,
    bucket: env.R2_BUCKET!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    ...(env.R2_ENDPOINT ? { endpoint: env.R2_ENDPOINT } : {}),
  });
}
