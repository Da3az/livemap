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

    test("get returns what put stored, metadata included", async () => {
      const s = store();
      await s.put(`${root}a.json`, '{"v":1}', PUT);
      const got = await s.get(`${root}a.json`);
      assert.ok(got);
      assert.equal(got.body, '{"v":1}');
      assert.equal(got.contentType, PUT.contentType);
      assert.equal(got.cacheControl, PUT.cacheControl);
      // Our content hash, not whatever the backend computed for itself.
      assert.equal(got.etag, PUT.etag);
      await s.deletePrefix(root);
    });

    test("a missing key is null, not an error", async () => {
      const s = store();
      assert.equal(await s.get(`${root}nope.json`), null);
      assert.equal(await s.has(`${root}nope.json`), false);
    });

    test("put overwrites", async () => {
      const s = store();
      await s.put(`${root}p.json`, "one", PUT);
      await s.put(`${root}p.json`, "two", PUT);
      assert.equal((await s.get(`${root}p.json`))?.body, "two");
      await s.deletePrefix(root);
    });

    test("delete removes, and deleting again is not an error", async () => {
      const s = store();
      await s.put(`${root}d.json`, "x", PUT);
      assert.equal(await s.has(`${root}d.json`), true);
      await s.delete(`${root}d.json`);
      assert.equal(await s.has(`${root}d.json`), false);
      await s.delete(`${root}d.json`);
    });

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

  test("put signs the request and sends cache headers with the object", async () => {
    const { store, seen } = fake(() => new Response(null, { status: 200 }));
    await store.put("t/acme/m/x/latest.json", "{}", PUT);

    const req = seen[0]!;
    assert.equal(req.method, "PUT");
    assert.equal(
      req.url,
      "https://acct.r2.cloudflarestorage.com/maps/t/acme/m/x/latest.json",
    );
    assert.equal(req.body, "{}");
    assert.equal(req.headers.get("cache-control"), PUT.cacheControl);
    assert.equal(req.headers.get("content-type"), PUT.contentType);
    assert.equal(req.headers.get("x-amz-meta-livemap-etag"), PUT.etag);
    assert.match(
      req.headers.get("authorization") ?? "",
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/,
    );
  });

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

  test("a 404 is absence; any other failure throws without the response body", async () => {
    const missing = fake(() => new Response("<Error/>", { status: 404 }));
    assert.equal(await missing.store.get("k"), null);
    assert.equal(await missing.store.has("k"), false);
    await missing.store.delete("k");

    const denied = fake(
      () => new Response("<Error><BucketName>maps</BucketName></Error>", { status: 403 }),
    );
    await assert.rejects(
      () => denied.store.get("k"),
      (err: Error) => /403/.test(err.message) && !/BucketName/.test(err.message),
    );
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

describe("r2FromEnv", () => {
  test("is null when nothing is set", () => {
    assert.equal(r2FromEnv({}), null);
  });

  test("refuses half a configuration and names what is missing", () => {
    assert.throws(
      () => r2FromEnv({ R2_ACCOUNT_ID: "a", R2_BUCKET: "b" }),
      /R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
    );
  });
});
