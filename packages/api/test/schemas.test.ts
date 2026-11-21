import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildServer, StaticAuth } from "../src/server.js";
import { MemoryMapRepo } from "../src/repo.js";
import { MemoryArtifactStore } from "../src/storage.js";
import { TEMPLATES } from "../src/templates.js";
import type { MapDoc, MapFeature } from "@livemap/core";

const TENANT = "t-1";
const MAP_ID = "m-1";
const EDIT = `/api/v1/maps/${MAP_ID}/edit`;

const DOC: MapDoc = {
  id: MAP_ID,
  tenantId: TENANT,
  slug: "m",
  title: { value: "M", dir: "ltr" },
  viewport: { center: [0, 0], zoom: 3, bearing: 0, pitch: 0 },
  basemap: { styleId: "light", labelLangs: ["en"] },
  uiDir: "ltr",
  updatedAt: "2026-11-07T00:00:00.000Z",
  rev: 0,
};

function setup(docs = false) {
  const repo = new MemoryMapRepo();
  repo.seed(DOC, [], { createdBy: "u-1" });
  const app = buildServer({
    repo,
    store: new MemoryArtifactStore(),
    auth: new StaticAuth({
      userId: "u-1",
      tenantId: TENANT,
      tenantSlug: "acme",
      role: "editor",
    }),
    docs,
  });
  return { app, repo };
}

const point = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  kind: "point",
  at: "V",
  at_: [10, 20],
  icon: "evt:aid",
  iconColor: "#1F7A4C",
  iconSize: 1,
  ...over,
});

async function put(features: unknown[], rev: unknown = 0) {
  const { app } = setup();
  const res = await app.inject({
    method: "POST",
    url: EDIT,
    payload: { rev, put: features },
  });
  await app.close();
  return res;
}

describe("the feature schema agrees with the types it restates", () => {
  // The schema is a hand-written second copy of core's types. If a kind gains
  // a field and the schema is not told, every template that uses it fails
  // here — rather than an editor's save failing in production.
  for (const template of TEMPLATES) {
    test(`every feature of "${template.id}" is accepted`, async () => {
      const res = await put([...template.features]);
      assert.equal(res.statusCode, 200, res.body);
    });
  }

  test("templates between them exercise every feature kind", () => {
    const kinds = new Set(
      TEMPLATES.flatMap((t) => t.features.map((f: MapFeature) => f.kind)),
    );
    assert.deepEqual(
      [...kinds].sort(),
      ["annotation", "area", "arrow", "frontline", "line", "point"],
    );
  });
});

describe("edit body validation", () => {
  const refused = async (features: unknown[], rev: unknown = 0) => {
    const res = await put(features, rev);
    assert.equal(res.statusCode, 400, res.body);
    assert.equal((res.json() as { error: string }).error, "invalid_request");
    return res.json() as { message: string };
  };

  test("a well-formed feature is accepted", async () => {
    assert.equal((await put([point()])).statusCode, 200);
  });

  test("an unknown property on a feature is refused, not stripped", async () => {
    // Stripping would store the feature without the property and answer 200,
    // and the client would never learn it had been dropped.
    await refused([point({ colour: "#ff0000" })]);
  });

  test("the refusal names the branch for the feature's own kind", async () => {
    const body = await refused([point({ iconSize: "big" })]);
    assert.match(body.message, /iconSize/);
  });

  test("an unknown kind is refused", async () => {
    await refused([point({ kind: "polygon" })]);
  });

  test("a colour that is not hex is refused", async () => {
    await refused([point({ iconColor: "red" })]);
  });

  test("a coordinate out of range is refused before it reaches PostGIS", async () => {
    await refused([point({ at_: [200, 20] })]);
    await refused([point({ at_: [10] })]);
  });

  test("an order key ending in the lowest digit is refused", async () => {
    // `between("V", "V0")` has no answer; core forbids the key outright.
    await refused([point({ at: "V0" })]);
  });

  test("a revision sent as a string is not coerced into a number", async () => {
    await refused([], "0");
  });

  test("a missing revision still gets its own named error", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: EDIT, payload: { put: [] } });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: string }).error, "rev_required");
    await app.close();
  });

  test("an annotation may carry a null leader or none at all", async () => {
    const note = {
      id: "n1",
      kind: "annotation",
      at: "V",
      anchor: [10, 20],
      offset: [40, -20],
      text: { value: "", dir: "auto" },
      labelStyle: { color: "#000000", haloColor: "#ffffff", haloWidth: 1.6, size: 12 },
    };
    assert.equal((await put([{ ...note, leader: null }])).statusCode, 200);
    assert.equal((await put([note])).statusCode, 200);
  });
});

describe("GET /docs", () => {
  test("is absent unless asked for", async () => {
    const { app } = setup(false);
    const res = await app.inject({ method: "GET", url: "/docs/openapi.json" });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  test("serves a document generated from the routes, without a token", async () => {
    const { app } = setup(true);
    const res = await app.inject({ method: "GET", url: "/docs/openapi.json" });
    assert.equal(res.statusCode, 200, res.body.slice(0, 200));

    const doc = res.json() as {
      openapi: string;
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    assert.match(doc.openapi, /^3\.1/);

    for (const path of [
      "/health",
      "/api/v1/me",
      "/api/v1/maps",
      "/api/v1/maps/{mapId}",
      "/api/v1/maps/{mapId}/edit",
      "/api/v1/maps/{mapId}/publish",
      "/api/v1/maps/{mapId}/rollback",
      "/api/v1/maps/{mapId}/versions",
      "/api/v1/maps/{mapId}/archive",
    ]) {
      assert.ok(doc.paths[path], `missing ${path}`);
    }

    // The dev-only artifact route is not part of the API.
    assert.ok(!Object.keys(doc.paths).some((p) => p.startsWith("/public")));

    // Authenticated routes say so; probes do not.
    assert.ok(doc.paths["/api/v1/maps"]!.get!.security);
    assert.equal(doc.paths["/health"]!.get!.security, undefined);
    await app.close();
  });

  test("the reference page loads nothing from another host by default", async () => {
    const { app } = setup(true);
    const res = await app.inject({ method: "GET", url: "/docs" });
    // The plugin may redirect to a trailing slash first.
    const page =
      res.statusCode >= 300 && res.statusCode < 400
        ? await app.inject({ method: "GET", url: String(res.headers.location) })
        : res;
    assert.equal(page.statusCode, 200);
    assert.match(page.headers["content-type"] as string, /text\/html/);
    assert.ok(!/fonts\.scalar\.com/.test(page.body), "default fonts were requested");
    assert.ok(!/cdn\.jsdelivr\.net/.test(page.body), "script loaded from a CDN");
    await app.close();
  });
});
