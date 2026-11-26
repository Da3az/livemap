import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { MemoryArtifactStore, keys, type ArtifactStore } from "../src/storage.js";
import { R2ArtifactStore, r2FromEnv } from "../src/r2.js";

const PUT = {
  contentType: "application/json; charset=utf-8",
  cacheControl: "public, max-age=5",
  etag: '"abc123"',
};

/**
 * What publish, rollback and the reaper rely on, stated once and run against
 * every implementation. `root` isolates a run, so the R2 suite can share a
 * bucket with anything else and clean up after itself by prefix.
 */
function contract(name: string, make: () => ArtifactStore | null, skip?: string) {
  describe(`ArtifactStore contract: ${name}`, { skip: skip ?? false }, () => {
    const root = `contract-test/${randomBytes(6).toString("hex")}/`;
    const store = () => make()!;

    test("deletePrefix removes one tenant and leaves its neighbour", async () => {
      // `t/ab/` must not take `t/abc/` with it.
      const s = store();
      const mine = `${root}${keys.tenant("ab")}`;
      const theirs = `${root}${keys.tenant("abc")}`;
      await s.put(`${mine}m/x/v/1.json`, "1", PUT);
      await s.put(`${mine}m/x/latest.json`, "p", PUT);
      await s.put(`${theirs}m/x/v/1.json`, "1", PUT);

      assert.equal(await s.deletePrefix(mine), 2);
      assert.equal(await s.has(`${mine}m/x/v/1.json`), false);
      assert.equal(await s.has(`${theirs}m/x/v/1.json`), true);
      assert.equal(await s.deletePrefix(root), 1);
    });

    test("deletePrefix refuses an empty prefix", async () => {
      await assert.rejects(() => store().deletePrefix(""));
    });
  });
}

const memory = new MemoryArtifactStore();
contract("memory", () => memory);

// Needs a real bucket. Skips without the four R2_* variables.
let r2: R2ArtifactStore | null = null;
let r2Skip: string | undefined;
try {
  r2 = r2FromEnv(process.env);
  if (!r2) r2Skip = "R2_* not set";
} catch (err) {
  r2Skip = (err as Error).message;
}
contract("r2", () => r2, r2Skip);

describe("R2ArtifactStore requests", () => {
  type Seen = { method: string; url: string; headers: Headers; body: string };

  function fake(respond: (seen: Seen) => Response) {
    const seen: Seen[] = [];
    const store = new R2ArtifactStore({
      accountId: "acct",
      bucket: "maps",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret",
      fetchImpl: (async (input: Request) => {
        const s = {
          method: input.method,
          url: input.url,
          headers: input.headers,
          body: input.body ? await input.text() : "",
        };
        seen.push(s);
        return respond(s);
      }) as typeof fetch,
    });
    return { store, seen };
  }

  test("get prefers our stored hash over the backend's own ETag", async () => {
    const { store } = fake(
      () =>
        new Response("body", {
          status: 200,
          headers: {
            etag: '"md5-of-the-bytes"',
            "x-amz-meta-livemap-etag": '"content-hash"',
            "cache-control": "public, max-age=5",
            "content-type": "application/json",
          },
        }),
    );
    assert.equal((await store.get("k"))?.etag, '"content-hash"');
  });

  test("deletePrefix follows continuation tokens and deletes each key", async () => {
    const pages: Record<string, string> = {
      "": `<ListBucketResult><Contents><Key>t/g/m/a/v/1.json</Key></Contents>
           <IsTruncated>true</IsTruncated>
           <NextContinuationToken>tok2</NextContinuationToken></ListBucketResult>`,
      tok2: `<ListBucketResult><Contents><Key>t/g/m/a/latest.json</Key></Contents>
             <IsTruncated>false</IsTruncated></ListBucketResult>`,
    };
    const { store, seen } = fake((req) => {
      if (req.method === "DELETE") return new Response(null, { status: 204 });
      const u = new URL(req.url);
      assert.equal(u.searchParams.get("list-type"), "2");
      assert.equal(u.searchParams.get("prefix"), "t/g/");
      return new Response(pages[u.searchParams.get("continuation-token") ?? ""], {
        status: 200,
      });
    });

    assert.equal(await store.deletePrefix("t/g/"), 2);
    assert.deepEqual(
      seen.filter((s) => s.method === "DELETE").map((s) => new URL(s.url).pathname),
      ["/maps/t/g/m/a/v/1.json", "/maps/t/g/m/a/latest.json"],
    );
  });
});
