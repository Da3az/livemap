import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  deconflict,
  placeWithFallback,
  rectsOverlap,
  type CollisionItem,
  type Rect,
} from "../src/collision.js";
import {
  between,
  compareOrder,
  isValidOrderKey,
  sequenceAfter,
} from "../src/order.js";
import {
  EMPTY_HISTORY,
  apply,
  coalesce,
  invert,
  redo,
  transact,
  undo,
} from "../src/moment.js";
import {
  buildVersion,
  canonicalJson,
  contentHash,
  etagFor,
  pointerCachePolicy,
  pointerFor,
  versionedCachePolicy,
} from "../src/version.js";
import { normaliseHaloWidth, labelExpression, isHexColor } from "../src/types.js";
import type { MapDoc, MapFeature, PointFeature } from "../src/types.js";

function item(
  id: string,
  anchor: [number, number],
  offset: [number, number],
  extra: Partial<CollisionItem> = {},
): CollisionItem {
  return { id, anchor, offset, width: 100, height: 20, ...extra };
}

describe("deconflict", () => {
  test("leaves non-overlapping labels exactly where they were", () => {
    const items = [
      item("a", [0, 0], [0, 0]),
      item("b", [0, 400], [0, 0]),
    ];
    const out = deconflict(items);
    for (const r of out) {
      assert.equal(r.moved, 0);
      assert.equal(r.suppressed, false);
    }
  });

  test("separates two labels stacked on the same point", () => {
    const items = [
      item("a", [200, 200], [0, 0]),
      item("b", [200, 200], [0, 0]),
    ];
    const out = deconflict(items);
    const a = out.find((r) => r.id === "a")!;
    const b = out.find((r) => r.id === "b")!;

    const ra: Rect = {
      x: 200 + a.offset[0] - 50,
      y: 200 + a.offset[1] - 10,
      width: 100,
      height: 20,
    };
    const rb: Rect = {
      x: 200 + b.offset[0] - 50,
      y: 200 + b.offset[1] - 10,
      width: 100,
      height: 20,
    };
    const resolved = !rectsOverlap(ra, rb) || a.suppressed || b.suppressed;
    assert.ok(resolved, "labels remained overlapped and neither was suppressed");
  });

  test("respects the deviation budget", () => {
    const items = [
      item("a", [200, 200], [0, 0]),
      item("b", [200, 200], [0, 0]),
      item("c", [200, 200], [0, 0]),
      item("d", [200, 200], [0, 0]),
    ];
    const out = deconflict(items, { maxDeviation: 12 });
    for (const r of out) {
      assert.ok(
        r.moved <= 12 + 1e-6,
        `${r.id} moved ${r.moved}px, budget was 12`,
      );
    }
  });

  test("suppresses what it cannot place rather than overlapping it", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      item(`x${i}`, [200, 200], [0, 0]),
    );
    const out = deconflict(items, { maxDeviation: 2 });
    assert.ok(
      out.some((r) => r.suppressed),
      "expected at least one suppression",
    );
  });

  test("a pinned label never moves", () => {
    const items = [
      item("pinned", [200, 200], [0, 0], { pinned: true }),
      item("free", [200, 200], [0, 0]),
    ];
    const out = deconflict(items);
    assert.equal(out.find((r) => r.id === "pinned")!.moved, 0);
  });

  test("higher priority moves less than lower priority", () => {
    const items = [
      item("important", [200, 200], [0, 0], { priority: 10 }),
      item("minor", [200, 200], [0, 0], { priority: 0 }),
    ];
    const out = deconflict(items);
    const imp = out.find((r) => r.id === "important")!;
    const min = out.find((r) => r.id === "minor")!;
    assert.ok(
      imp.moved <= min.moved,
      `important moved ${imp.moved}, minor moved ${min.moved}`,
    );
  });

  test("is deterministic — identical input gives identical output", () => {
    const items = [
      item("a", [200, 200], [4, 2]),
      item("b", [210, 205], [0, 0]),
      item("c", [190, 195], [-3, 1]),
    ];
    const first = deconflict(items);
    const second = deconflict(items);
    assert.deepEqual(first, second);
  });

  test("returns results in the caller's input order", () => {
    const items = [
      item("z", [0, 0], [0, 0], { priority: 0 }),
      item("a", [0, 0], [0, 0], { priority: 9 }),
    ];
    const out = deconflict(items);
    assert.deepEqual(out.map((r) => r.id), ["z", "a"]);
  });

  test("keeps labels inside the viewport", () => {
    const vp: Rect = { x: 0, y: 0, width: 800, height: 600 };
    // Anchor near the right edge with an offset that pushes the box off-canvas.
    const items = [item("edge", [780, 300], [60, 0])];
    const out = deconflict(items, { viewport: vp, maxDeviation: 200 });
    const r = out[0]!;
    const right = 780 + r.offset[0] + 50;
    assert.ok(
      right <= 800 + 1 || r.suppressed,
      `label right edge at ${right} escaped the 800px viewport`,
    );
  });

  test("avoids static obstacles such as a legend panel", () => {
    const legend: Rect = { x: 0, y: 500, width: 200, height: 100 };
    const items = [item("l", [100, 550], [0, 0])];
    const out = deconflict(items, { obstacles: [legend] });
    const r = out[0]!;
    const rect: Rect = {
      x: 100 + r.offset[0] - 50,
      y: 550 + r.offset[1] - 10,
      width: 100,
      height: 20,
    };
    assert.ok(!rectsOverlap(rect, legend) || r.suppressed);
  });

  test("handles an empty input", () => {
    assert.deepEqual(deconflict([]), []);
  });
});

describe("placeWithFallback", () => {
  test("keeps the authored offset when it is free", () => {
    const r = placeWithFallback(item("a", [100, 100], [20, -20]), []);
    assert.deepEqual(r.offset, [20, -20]);
    assert.equal(r.moved, 0);
  });

  test("falls back when the authored offset is occupied", () => {
    const occupied: Rect[] = [
      { x: 100 + 20 - 50, y: 100 - 20 - 10, width: 100, height: 20 },
    ];
    const r = placeWithFallback(item("a", [100, 100], [20, -20]), occupied);
    assert.ok(r.moved > 0 || r.suppressed);
  });
});

describe("fractional order keys", () => {
  test("between produces a key that sorts strictly in the middle", () => {
    const a = between(null, null);
    const b = between(a, null);
    assert.ok(a < b, `${a} should sort before ${b}`);
    const mid = between(a, b);
    assert.ok(a < mid && mid < b, `${a} < ${mid} < ${b}`);
  });

  test("repeated midpoint insertion always succeeds", () => {
    let lo = between(null, null);
    let hi = between(lo, null);
    for (let i = 0; i < 80; i++) {
      const mid = between(lo, hi);
      assert.ok(lo < mid && mid < hi, `iteration ${i}: ${lo} < ${mid} < ${hi}`);
      hi = mid;
    }
    assert.ok(lo < hi);
  });

  test("prepending before the first key works", () => {
    const first = between(null, null);
    const before = between(null, first);
    assert.ok(before < first, `${before} should sort before ${first}`);
  });

  test("appending many keys yields a strictly ascending sequence", () => {
    const keys = sequenceAfter(null, 60);
    for (let i = 1; i < keys.length; i++) {
      assert.ok(keys[i - 1]! < keys[i]!, `${keys[i - 1]} !< ${keys[i]}`);
    }
  });

  test("every generated key is valid", () => {
    const keys = sequenceAfter(null, 30);
    for (const k of keys) assert.ok(isValidOrderKey(k), `invalid: ${k}`);
    let lo: string | null = null;
    for (const k of keys) {
      const mid = between(lo, k);
      assert.ok(isValidOrderKey(mid), `invalid midpoint: ${mid}`);
      lo = k;
    }
  });

  test("rejects out-of-sequence arguments", () => {
    const a = between(null, null);
    const b = between(a, null);
    assert.throws(() => between(b, a), /out of sequence/);
  });

  test("rejects malformed keys", () => {
    assert.equal(isValidOrderKey(""), false);
    assert.equal(isValidOrderKey("A0"), false, "trailing zero must be invalid");
    assert.equal(isValidOrderKey("!!"), false);
    assert.throws(() => between("!!", null), /invalid lower order key/);
  });

  test("compareOrder breaks ties on id", () => {
    assert.ok(compareOrder({ at: "V", id: "a" }, { at: "V", id: "b" }) < 0);
    assert.equal(compareOrder({ at: "V", id: "a" }, { at: "V", id: "a" }), 0);
    assert.ok(compareOrder({ at: "W", id: "a" }, { at: "V", id: "z" }) > 0);
  });

  test("subdividing at the low end also always succeeds", () => {
    // Halving drives keys toward "0", which is what exposed the trailing-zero hole.
    let lo = between(null, null);
    const hi = between(lo, null);
    for (let i = 0; i < 80; i++) {
      const mid = between(lo, hi);
      assert.ok(isValidOrderKey(mid), `iteration ${i}: invalid key ${mid}`);
      assert.ok(lo < mid && mid < hi, `iteration ${i}: ${lo} < ${mid} < ${hi}`);
      lo = mid;
    }
  });

  test("prepending repeatedly always succeeds", () => {
    let first = between(null, null);
    for (let i = 0; i < 80; i++) {
      const before = between(null, first);
      assert.ok(isValidOrderKey(before), `iteration ${i}: invalid ${before}`);
      assert.ok(before < first, `iteration ${i}: ${before} !< ${first}`);
      first = before;
    }
  });

  // Fixed-seed PRNG so a failure is reproducible.
  test("property: between() is strictly between and always valid", () => {
    let seed = 0x2f6e2b1;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    let keys = [between(null, null)];
    for (let i = 0; i < 600; i++) {
      const pos = Math.floor(rnd() * (keys.length + 1));
      const lo = pos === 0 ? null : keys[pos - 1]!;
      const hi = pos === keys.length ? null : keys[pos]!;
      const k = between(lo, hi);

      assert.ok(isValidOrderKey(k), `invalid key ${k} at insert ${i}`);
      if (lo !== null) assert.ok(lo < k, `${lo} !< ${k} at insert ${i}`);
      if (hi !== null) assert.ok(k < hi, `${k} !< ${hi} at insert ${i}`);

      keys.splice(pos, 0, k);
    }

    for (let i = 1; i < keys.length; i++) {
      assert.ok(keys[i - 1]! < keys[i]!, `pool unsorted at ${i}`);
    }
    assert.equal(new Set(keys).size, keys.length, "duplicate keys generated");
  });

  test("key growth stays modest under random insertion", () => {
    // The 16-char cap guards a regression where every midpoint appends a digit.
    let seed = 99;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let keys = [between(null, null)];
    for (let i = 0; i < 500; i++) {
      const pos = Math.floor(rnd() * (keys.length + 1));
      keys.splice(
        pos,
        0,
        between(pos === 0 ? null : keys[pos - 1]!, pos === keys.length ? null : keys[pos]!),
      );
    }
    const longest = Math.max(...keys.map((k) => k.length));
    assert.ok(longest <= 16, `longest key is ${longest} chars`);
  });
});

function point(id: string, lng: number, color = "#E03C31"): PointFeature {
  return {
    id,
    kind: "point",
    at: "V",
    at_: [lng, 32],
    icon: "ocha:Attack",
    iconColor: color,
    iconSize: 1,
  };
}

describe("moments", () => {
  test("invert turns a create into a delete", () => {
    const before = new Map<string, MapFeature>();
    const rev = invert({ put: [point("p1", 35)] }, before);
    assert.deepEqual(rev.delete, ["p1"]);
    assert.equal(rev.put, undefined);
  });

  test("invert turns an update into a restore of the old value", () => {
    const old = point("p1", 35, "#111111");
    const before = new Map<string, MapFeature>([["p1", old]]);
    const rev = invert({ put: [point("p1", 35, "#ffffff")] }, before);
    assert.equal(rev.put?.length, 1);
    assert.equal((rev.put![0] as PointFeature).iconColor, "#111111");
  });

  test("deleting a non-existent feature inverts to nothing", () => {
    const rev = invert({ delete: ["ghost"] }, new Map());
    assert.equal(rev.put, undefined);
    assert.equal(rev.delete, undefined);
  });

  test("undo then redo restores the original state", () => {
    let state = new Map<string, MapFeature>();
    let history = EMPTY_HISTORY;

    ({ state, history } = transact(state, history, { put: [point("p1", 35)] }));
    ({ state, history } = transact(state, history, { put: [point("p2", 36)] }));
    const twoFeatures = canonicalJson([...state.keys()].sort());

    ({ state, history } = undo(state, history));
    assert.equal(state.size, 1);

    ({ state, history } = redo(state, history));
    assert.equal(canonicalJson([...state.keys()].sort()), twoFeatures);
  });

  test("a new edit clears the redo branch", () => {
    let state = new Map<string, MapFeature>();
    let history = EMPTY_HISTORY;
    ({ state, history } = transact(state, history, { put: [point("p1", 35)] }));
    ({ state, history } = undo(state, history));
    assert.equal(history.redo.length, 1);
    ({ state, history } = transact(state, history, { put: [point("p9", 39)] }));
    assert.equal(history.redo.length, 0);
  });

  test("quiet transactions do not enter history", () => {
    let state = new Map<string, MapFeature>();
    let history = EMPTY_HISTORY;
    for (let i = 0; i < 10; i++) {
      ({ state, history } = transact(
        state,
        history,
        { put: [point("drag", 35 + i / 100)] },
        { quiet: true },
      ));
    }
    assert.equal(history.undo.length, 0);
    assert.equal(state.size, 1);
  });

  test("undo on an empty history is a no-op", () => {
    const state = new Map<string, MapFeature>([["p1", point("p1", 35)]]);
    const r = undo(state, EMPTY_HISTORY);
    assert.equal(r.state.size, 1);
    assert.equal(r.history.undo.length, 0);
  });

  test("history is capped at the limit", () => {
    let state = new Map<string, MapFeature>();
    let history = EMPTY_HISTORY;
    for (let i = 0; i < 25; i++) {
      ({ state, history } = transact(
        state,
        history,
        { put: [point(`p${i}`, 35 + i / 10)] },
        { limit: 10 },
      ));
    }
    assert.equal(history.undo.length, 10);
  });

  test("an empty moment does not pollute history", () => {
    const { history } = transact(new Map(), EMPTY_HISTORY, {});
    assert.equal(history.undo.length, 0);
  });

  test("apply does not mutate its input", () => {
    const state = new Map<string, MapFeature>([["p1", point("p1", 35)]]);
    const next = apply(state, { delete: ["p1"] });
    assert.equal(state.size, 1, "input map was mutated");
    assert.equal(next.size, 0);
  });

  test("coalesce collapses a drag gesture into one reversible step", () => {
    const before = new Map<string, MapFeature>();
    const moments = Array.from({ length: 8 }, (_, i) => ({
      put: [point("drag", 35 + i / 100)],
    }));
    const r = coalesce(moments, before);
    assert.equal(r.forward.put?.length, 1);
    // 35 + 7/100 is the last of the 8 drag positions: final position wins.
    assert.equal((r.forward.put![0] as PointFeature).at_[0], 35 + 7 / 100);
    // Inverts against the original pre-state, so undo removes the feature.
    assert.deepEqual(r.reverse.delete, ["drag"]);
  });

  test("coalesce handles a create-then-delete as a net no-op put", () => {
    const r = coalesce(
      [{ put: [point("tmp", 35)] }, { delete: ["tmp"] }],
      new Map(),
    );
    assert.equal(r.forward.put, undefined);
    assert.deepEqual(r.forward.delete, ["tmp"]);
  });
});

const DOC: MapDoc = {
  id: "m1",
  tenantId: "t1",
  slug: "gaza-tracker",
  title: { value: "Gaza tracker", dir: "ltr" },
  viewport: { center: [34.4, 31.4], zoom: 10, bearing: 0, pitch: 0 },
  basemap: { styleId: "light", labelLangs: ["ar", "en"] },
  uiDir: "rtl",
  updatedAt: "2026-11-06T12:00:00.000Z",
  rev: 7,
};

describe("canonicalJson", () => {
  test("is insensitive to key insertion order", () => {
    assert.equal(
      canonicalJson({ b: 1, a: 2 }),
      canonicalJson({ a: 2, b: 1 }),
    );
  });

  test("drops undefined so absent and explicit-undefined match", () => {
    assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
  });

  test("preserves array order", () => {
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });

  test("handles nesting and null", () => {
    assert.equal(
      canonicalJson({ z: { y: null, x: [1, { b: 2, a: 1 }] } }),
      '{"z":{"x":[1,{"a":1,"b":2}],"y":null}}',
    );
  });
});

describe("contentHash", () => {
  test("is stable and 32 hex chars", () => {
    const h = contentHash("hello");
    assert.match(h, /^[0-9a-f]{32}$/);
    assert.equal(h, contentHash("hello"));
  });

  test("differs for inputs one character apart", () => {
    assert.notEqual(contentHash("map-1"), contentHash("map-2"));
    assert.notEqual(contentHash("a"), contentHash("b"));
  });

  test("has no trivial collisions across a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(contentHash(`feature-${i}`));
    assert.equal(seen.size, 20_000, "hash collision in 20k samples");
  });
});

describe("buildVersion", () => {
  const features: MapFeature[] = [point("p2", 36), point("p1", 35)];

  test("sorts features so the artifact is byte-stable", () => {
    const a = buildVersion({
      doc: DOC,
      features,
      version: 1,
      publishedBy: "u1",
    });
    const b = buildVersion({
      doc: DOC,
      features: [...features].reverse(),
      version: 1,
      publishedBy: "u1",
    });
    assert.equal(a.etag, b.etag, "row order changed the ETag");
  });

  test("ETag ignores publishedAt and publishedBy", () => {
    const a = buildVersion({
      doc: DOC,
      features,
      version: 1,
      publishedBy: "alice",
      publishedAt: "2026-01-01T00:00:00.000Z",
    });
    const b = buildVersion({
      doc: DOC,
      features,
      version: 2,
      publishedBy: "bob",
      publishedAt: "2026-06-06T06:06:06.000Z",
    });
    assert.equal(a.etag, b.etag);
  });

  test("ETag changes when a feature changes", () => {
    const a = buildVersion({ doc: DOC, features, version: 1, publishedBy: "u" });
    const b = buildVersion({
      doc: DOC,
      features: [point("p1", 35), point("p2", 36, "#00ff00")],
      version: 1,
      publishedBy: "u",
    });
    assert.notEqual(a.etag, b.etag);
  });

  test("ETag changes when the viewport changes", () => {
    const a = buildVersion({ doc: DOC, features, version: 1, publishedBy: "u" });
    const b = buildVersion({
      doc: { ...DOC, viewport: { ...DOC.viewport, zoom: 11 } },
      features,
      version: 1,
      publishedBy: "u",
    });
    assert.notEqual(a.etag, b.etag);
  });
});

describe("cache policies", () => {
  test("versioned artifacts are immutable and long-lived", () => {
    const p = versionedCachePolicy("abc");
    assert.match(p.cacheControl, /immutable/);
    assert.match(p.cacheControl, /max-age=31536000/);
    assert.equal(p.etag, '"abc"');
  });

  test("the pointer is short-lived with stale-while-revalidate", () => {
    const p = pointerCachePolicy("abc", 5);
    assert.match(p.cacheControl, /max-age=5/);
    assert.match(p.cacheControl, /stale-while-revalidate=30/);
    assert.match(p.cacheControl, /stale-if-error=90/);
  });

  test("pointer references the immutable artifact path", () => {
    const v = buildVersion({
      doc: DOC,
      features: [point("p1", 35)],
      version: 12,
      publishedBy: "u",
    });
    assert.equal(pointerFor(v).href, "v/12.json");
    assert.equal(etagFor(pointerFor(v).etag), `"${v.etag}"`);
  });
});

describe("halo width", () => {
  // Guards MapLibre #8949, which cuts Arabic glyph joins at width <= 1.
  test("lifts unsafe widths clear of the broken band", () => {
    assert.equal(normaliseHaloWidth(1), 1.01);
    assert.equal(normaliseHaloWidth(0.5), 1.01);
  });

  test("leaves safe widths alone", () => {
    assert.equal(normaliseHaloWidth(1.5), 1.5);
    assert.equal(normaliseHaloWidth(2), 2);
  });

  test("zero means no halo and stays zero", () => {
    assert.equal(normaliseHaloWidth(0), 0);
    assert.equal(normaliseHaloWidth(-3), 0);
  });
});

describe("labelExpression", () => {
  test("prefers the requested language, then nonlatin, then plain name", () => {
    const e = labelExpression(["ar", "en"]) as unknown[];
    assert.equal(e[0], "coalesce");
    assert.deepEqual(e[1], ["get", "name:ar"]);
    assert.deepEqual(e[2], ["get", "name:en"]);
    // name:nonlatin rescues Riyadh, where name:ar covers only ~12% of features.
    assert.ok(
      e.some((x) => Array.isArray(x) && x[1] === "name:nonlatin"),
      "missing name:nonlatin fallback",
    );
    assert.deepEqual(e[e.length - 2], ["get", "name"]);
    assert.equal(e[e.length - 1], "");
  });

  test("omits the nonlatin fallback for latin-only requests", () => {
    const e = labelExpression(["en", "de"]) as unknown[];
    assert.ok(!e.some((x) => Array.isArray(x) && x[1] === "name:nonlatin"));
  });
});

describe("isHexColor", () => {
  test("accepts 3, 6 and 8 digit forms", () => {
    for (const c of ["#fff", "#E03C31", "#E03C31FF"]) {
      assert.ok(isHexColor(c), c);
    }
  });

  test("rejects malformed values", () => {
    for (const c of ["E03C31", "#ggg", "#12", "", "#1234567"]) {
      assert.equal(isHexColor(c), false, c);
    }
  });
});
