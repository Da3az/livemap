import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

import { UpdatePoller, LANE_ACTIVE_MS, LANE_NORMAL_MS } from "../src/poll.js";
import {
  startEmbedParent,
  embedSnippet,
  EMBED_PROTOCOL,
} from "../src/embed.js";

interface FakeResponse {
  status: number;
  etag?: string;
  body?: unknown;
}

function fakeFetch(responses: FakeResponse[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  let i = 0;

  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k: string) => (k === "etag" ? (r.etag ?? null) : null) },
      json: async () => r.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const pointer = (version: number) => ({
  mapId: "m1",
  version,
  etag: `hash-${version}`,
  publishedAt: "2026-11-07T10:00:00.000Z",
  href: `v/${version}.json`,
});

describe("UpdatePoller", () => {
  test("reports the first version it sees", async () => {
    const { impl } = fakeFetch([{ status: 200, etag: '"h1"', body: pointer(1) }]);
    const seen: number[] = [];
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: (ptr) => void seen.push(ptr.version),
    });
    await p.check();
    p.destroy();
    assert.deepEqual(seen, [1]);
    assert.equal(p.version, 1);
  });

  test("sends If-None-Match once it has an ETag", async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, etag: '"h1"', body: pointer(1) },
      { status: 304 },
    ]);
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: () => {},
    });
    await p.check();
    await p.check();
    p.destroy();

    assert.equal(calls[0]!.headers["if-none-match"], undefined);
    assert.equal(calls[1]!.headers["if-none-match"], '"h1"');
  });

  test("forces CDN revalidation", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: pointer(1) }]);
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: () => {},
    });
    await p.check();
    p.destroy();
    assert.equal(calls[0]!.headers["cache-control"], "no-cache");
  });

  test("a 304 does not fire onUpdate", async () => {
    const { impl } = fakeFetch([
      { status: 200, etag: '"h1"', body: pointer(1) },
      { status: 304 },
      { status: 304 },
    ]);
    let updates = 0;
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: () => void updates++,
    });
    await p.check();
    await p.check();
    await p.check();
    p.destroy();
    assert.equal(updates, 1);
  });

  // An identical republish keeps its ETag, so version is the only safe trigger.
  test("does not re-render when the version has not advanced", async () => {
    const { impl } = fakeFetch([
      { status: 200, etag: '"h1"', body: pointer(3) },
      { status: 200, etag: '"h1"', body: pointer(3) },
    ]);
    let updates = 0;
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: () => void updates++,
    });
    await p.check();
    await p.check();
    p.destroy();
    assert.equal(updates, 1);
  });

  test("fires again when the version advances", async () => {
    const { impl } = fakeFetch([
      { status: 200, etag: '"h1"', body: pointer(1) },
      { status: 200, etag: '"h2"', body: pointer(2) },
    ]);
    const seen: number[] = [];
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: (ptr) => void seen.push(ptr.version),
    });
    await p.check();
    await p.check();
    p.destroy();
    assert.deepEqual(seen, [1, 2]);
  });

  test("ignores a version that goes backwards", async () => {
    const { impl } = fakeFetch([
      { status: 200, etag: '"h5"', body: pointer(5) },
      { status: 200, etag: '"h2"', body: pointer(2) },
    ]);
    const seen: number[] = [];
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: (ptr) => void seen.push(ptr.version),
    });
    await p.check();
    await p.check();
    p.destroy();
    assert.deepEqual(seen, [5], "a stale pointer rolled the reader backwards");
  });

  test("errors are reported and do not stop the poller", async () => {
    const impl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const errors: unknown[] = [];
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: () => {},
      onError: (e) => void errors.push(e),
    });
    await p.check();
    p.destroy();
    assert.equal(errors.length, 1);
    assert.equal(p.version, -1);
  });

  test("a non-200, non-304 status is an error", async () => {
    const { impl } = fakeFetch([{ status: 500 }]);
    const errors: unknown[] = [];
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: () => {},
      onError: (e) => void errors.push(e),
    });
    await p.check();
    p.destroy();
    assert.equal(errors.length, 1);
  });

  test("overlapping checks are collapsed", async () => {
    let resolveFirst: () => void = () => {};
    let calls = 0;
    const impl = (async () => {
      calls++;
      await new Promise<void>((r) => (resolveFirst = r));
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => pointer(1),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: () => {},
    });
    const a = p.check();
    const b = p.check();
    resolveFirst();
    await Promise.all([a, b]);
    p.destroy();
    assert.equal(calls, 1, "a second request started while one was in flight");
  });

  test("destroy stops further checks", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: pointer(1) }]);
    const p = new UpdatePoller({
      pointerUrl: "/latest.json",
      fetchImpl: impl,
      onUpdate: () => {},
    });
    p.destroy();
    await p.check();
    assert.equal(calls.length, 0);
  });

  test("the two lanes match what AP actually ships", () => {
    assert.equal(LANE_NORMAL_MS, 120_000);
    assert.equal(LANE_ACTIVE_MS, 10_000);
  });
});

describe("embed parent", () => {
  function fakeWindow() {
    const listeners: ((e: MessageEvent) => void)[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    g["window"] = {
      addEventListener: (_t: string, h: (e: MessageEvent) => void) =>
        listeners.push(h),
      removeEventListener: (_t: string, h: (e: MessageEvent) => void) => {
        const i = listeners.indexOf(h);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
    return {
      emit: (e: unknown) => listeners.forEach((h) => h(e as MessageEvent)),
      count: () => listeners.length,
    };
  }

  function fakeIframe() {
    const contentWindow = { marker: "the-frame" };
    return {
      contentWindow,
      style: { height: "" },
    } as unknown as HTMLIFrameElement & { style: { height: string } };
  }

  const msg = (height: number, id = "e1") => ({
    protocol: EMBED_PROTOCOL,
    type: "height",
    id,
    height,
  });

  test("resizes on a valid message from its own frame", () => {
    const w = fakeWindow();
    const iframe = fakeIframe();
    const stop = startEmbedParent({ id: "e1", iframe });

    w.emit({ source: iframe.contentWindow, data: msg(640) });
    assert.equal(iframe.style.height, "640px");
    stop();
  });

  // Security property: `event.origin` alone would let any same-origin frame resize.
  test("ignores a message from a different frame", () => {
    const w = fakeWindow();
    const iframe = fakeIframe();
    const stop = startEmbedParent({ id: "e1", iframe });

    w.emit({ source: { marker: "someone-else" }, data: msg(640) });
    assert.equal(iframe.style.height, "");
    stop();
  });

  test("ignores a message for a different embed id", () => {
    const w = fakeWindow();
    const iframe = fakeIframe();
    const stop = startEmbedParent({ id: "e1", iframe });

    w.emit({ source: iframe.contentWindow, data: msg(640, "other") });
    assert.equal(iframe.style.height, "");
    stop();
  });

  test("rejects malformed and hostile payloads", () => {
    const w = fakeWindow();
    const iframe = fakeIframe();
    const stop = startEmbedParent({ id: "e1", iframe });

    const bad: unknown[] = [
      null,
      "height:9999",
      { type: "height", id: "e1", height: 500 }, // no protocol
      { protocol: EMBED_PROTOCOL, type: "evil", id: "e1", height: 500 },
      { protocol: EMBED_PROTOCOL, type: "height", id: "e1", height: -1 },
      { protocol: EMBED_PROTOCOL, type: "height", id: "e1", height: 0 },
      { protocol: EMBED_PROTOCOL, type: "height", id: "e1", height: NaN },
      { protocol: EMBED_PROTOCOL, type: "height", id: "e1", height: 1e9 },
      { protocol: EMBED_PROTOCOL, type: "height", id: "e1", height: "500" },
    ];

    for (const data of bad) {
      w.emit({ source: iframe.contentWindow, data });
      assert.equal(iframe.style.height, "", `accepted: ${JSON.stringify(data)}`);
    }
    stop();
  });

  test("stop removes the listener", () => {
    const w = fakeWindow();
    const iframe = fakeIframe();
    const stop = startEmbedParent({ id: "e1", iframe });
    assert.equal(w.count(), 1);
    stop();
    assert.equal(w.count(), 0);
  });
});

describe("embedSnippet", () => {
  test("carries the embed id and a lazy, sandboxed iframe", () => {
    const s = embedSnippet({
      src: "https://cdn.example.com/embed/abc",
      id: "e1",
      title: "Levant tracker",
    });
    assert.match(s, /embedId=e1/);
    assert.match(s, /loading="lazy"/);
    assert.match(s, /sandbox="allow-scripts allow-popups"/);
    // allow-same-origin would let the embed read the host page.
    assert.ok(!s.includes("allow-same-origin"));
  });

  test("escapes attribute injection in the title", () => {
    const s = embedSnippet({
      src: "https://cdn.example.com/embed/abc",
      id: "e1",
      title: '"><script>alert(1)</script>',
    });
    assert.ok(!s.includes("<script>"), "title was not escaped");
    assert.match(s, /&quot;/);
  });

  test("respects a custom initial height", () => {
    const s = embedSnippet({
      src: "https://cdn.example.com/embed/abc",
      id: "e1",
      title: "t",
      initialHeight: 720,
    });
    assert.match(s, /height:720px/);
  });
});
