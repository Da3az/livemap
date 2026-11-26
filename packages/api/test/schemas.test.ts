import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildServer, StaticAuth } from "../src/server.js";
import { MemoryMapRepo } from "../src/repo.js";
import { MemoryArtifactStore } from "../src/storage.js";
import { templateSettings, type ErrorBody, type PointFeature } from "@livemap/core";

const TENANT = "t-1";
const USER = "u-1";

const point = (): PointFeature => ({
  id: "p1",
  kind: "point",
  order: "V",
  name: { value: "Aid", dir: "ltr" },
  groupId: null,
  hidden: false,
  locked: false,
  presetId: null,
  validFrom: null,
  validTo: null,
  lineageId: null,
  updatedAt: "2026-11-07T00:00:00.000Z",
  updatedBy: "",
  at: [10, 20],
  symbol: { icon: "aid" },
  color: { slot: 2 },
  size: 24,
});

/** Sends one edit to a fresh map at revision 0, as an editor who made it. */
async function save(put: unknown[], rev: unknown = 0) {
  const repo = new MemoryMapRepo();
  repo.grant(TENANT, USER, "editor");
  const created = await repo.createMap(
    { tenantId: TENANT, userId: USER, role: "editor" },
    { title: { value: "M", dir: "ltr" }, uiDir: "ltr", settings: templateSettings("blank", "ltr") },
    { maxMaps: 100 },
  );
  if (created.status !== "created") throw new Error("fixture map was not created");
  const app = buildServer({
    repo,
    store: new MemoryArtifactStore(),
    auth: new StaticAuth({ userId: USER, tenantId: TENANT, tenantSlug: "acme", role: "editor" }),
  });
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/maps/${created.map.id}/edit`,
    payload: { rev, put, delete: [] },
  });
  const features = (await repo.getMap({ tenantId: TENANT, userId: USER, role: "editor" }, created.map.id))!.features;
  await app.close();
  return { res, features };
}

// Both guard Fastify defaults that buildServer turns off: `removeAdditional`
// and `coerceTypes`. Each first shows the well-formed request is accepted, so
// the refusal cannot be for some other reason.
describe("the edit body is refused, never repaired", () => {
  test("an unknown property on a feature is refused, not stripped", async () => {
    // Stripping would store the feature without the property and answer 200,
    // and the client would never learn it had been dropped.
    assert.equal((await save([point()])).res.statusCode, 200);

    const { res, features } = await save([{ ...point(), colour: "#ff0000" }]);
    assert.equal(res.statusCode, 400, res.body);
    assert.equal((res.json() as ErrorBody).error, "invalid_request");
    assert.deepEqual(features, [], "the refused feature was stored anyway");
  });

  test("a revision sent as a string is not coerced into a number", async () => {
    assert.equal((await save([point()], 0)).res.statusCode, 200);

    const { res, features } = await save([point()], "0");
    assert.equal(res.statusCode, 400, res.body);
    assert.equal((res.json() as ErrorBody).error, "invalid_request");
    assert.deepEqual(features, [], "the refused edit was applied anyway");
  });
});
