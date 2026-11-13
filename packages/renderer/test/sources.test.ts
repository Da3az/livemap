import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildSources, SOURCE_IDS } from "../src/sources.js";
import { buildLayers, LAYER_IDS, LAYER_ORDER } from "../src/layers.js";
import { recolourSvg, spriteId } from "../src/sprites.js";
import type { MapFeature } from "@livemap/core";

const ctx = {
  zoom: 9,
  resolveArrowhead: (c: string) => `head:${c}`,
  resolveChevron: (c: string) => `chev:${c}`,
  resolveAnchorDot: (f: string) => `dot:${f}`,
  resolveIcon: (id: string, c: string) => `icon:${id}:${c}`,
};

const area = (id: string, label?: string): MapFeature => ({
  id,
  kind: "area",
  at: "A",
  rings: [
    [
      [35, 32],
      [36, 32],
      [36, 33],
      [35, 33],
    ],
  ],
  fill: { color: "#E03C31", opacity: 0.3 },
  stroke: { color: "#E03C31", width: 2, opacity: 1 },
  ...(label ? { label: { value: label, dir: "auto" as const } } : {}),
});

const arrow = (id: string): MapFeature => ({
  id,
  kind: "arrow",
  at: "B",
  control: [
    [35, 31.8],
    [35.4, 32.1],
    [35.9, 32.0],
  ],
  curvature: 1,
  head: "single",
  chevrons: true,
  stroke: { color: "#2B5FD9", width: 4, opacity: 1 },
});

const annotation = (id: string, text: string): MapFeature => ({
  id,
  kind: "annotation",
  at: "C",
  anchor: [35.5, 32],
  offset: [60, -40],
  text: { value: text, dir: "auto" },
  labelStyle: {
    color: "#111",
    haloColor: "#fff",
    // Deliberately in the broken band, to prove normalisation happens.
    haloWidth: 1,
    size: 13,
  },
  leader: { color: "#111", width: 1, shape: "straight", anchorDot: true },
});

describe("buildSources", () => {
  test("emits a collection per geometry class", () => {
    const s = buildSources([area("a1")], ctx);
    for (const id of Object.values(SOURCE_IDS)) {
      assert.equal(s[id].type, "FeatureCollection", id);
    }
  });

  test("closes polygon rings", () => {
    const s = buildSources([area("a1")], ctx);
    const ring = s[SOURCE_IDS.areas].features[0]!.geometry
      .coordinates as number[][][];
    const outer = ring[0]!;
    assert.deepEqual(outer[0], outer[outer.length - 1], "ring is not closed");
  });

  test("carries per-feature style into properties", () => {
    const s = buildSources([area("a1")], ctx);
    const p = s[SOURCE_IDS.areas].features[0]!.properties;
    assert.equal(p["fillColor"], "#E03C31");
    assert.equal(p["fillOpacity"], 0.3);
    assert.equal(p["strokeWidth"], 2);
  });

  test("flags dashed strokes so the dashed layer can filter them", () => {
    const solid = buildSources([area("a1")], ctx);
    assert.equal(solid[SOURCE_IDS.areas].features[0]!.properties["hasDash"], 0);

    const dashed = buildSources(
      [
        {
          ...(area("a2") as Extract<MapFeature, { kind: "area" }>),
          stroke: { color: "#000", width: 2, opacity: 1, dash: [2, 1] },
        },
      ],
      ctx,
    );
    assert.equal(dashed[SOURCE_IDS.areas].features[0]!.properties["hasDash"], 1);
  });

  test("emits an area's label at the ring centroid", () => {
    const s = buildSources([area("a1", "Contested")], ctx);
    assert.equal(s[SOURCE_IDS.labels].features.length, 1);
    const f = s[SOURCE_IDS.labels].features[0]!;
    assert.equal(f.properties["text"], "Contested");
    const [lng, lat] = f.geometry.coordinates as number[];
    // Centroid of the 35..36 / 32..33 box.
    assert.ok(Math.abs(lng! - 35.5) < 0.01, `lng ${lng}`);
    assert.ok(Math.abs(lat! - 32.5) < 0.01, `lat ${lat}`);
  });

  test("an area with no label emits none", () => {
    const s = buildSources([area("a1")], ctx);
    assert.equal(s[SOURCE_IDS.labels].features.length, 0);
  });

  test("arrows emit a shaft, a head and chevrons", () => {
    const s = buildSources([arrow("ar1")], ctx);
    const lines = s[SOURCE_IDS.lines].features;
    const markers = s[SOURCE_IDS.markers].features;

    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.properties["role"], "arrow");

    const heads = markers.filter((m) => m.properties["role"] === "arrowhead");
    const chevs = markers.filter((m) => m.properties["role"] === "chevron");
    assert.equal(heads.length, 1);
    assert.ok(chevs.length > 0, "no chevrons emitted");
  });

  test("arrowhead rotation is precomputed, not left to the style spec", () => {
    const s = buildSources([arrow("ar1")], ctx);
    const head = s[SOURCE_IDS.markers].features.find(
      (m) => m.properties["role"] === "arrowhead",
    )!;
    assert.equal(typeof head.properties["iconRotate"], "number");
    assert.ok(Number.isFinite(head.properties["iconRotate"] as number));
  });

  test("a double head emits two markers", () => {
    const s = buildSources(
      [
        {
          ...(arrow("ar1") as Extract<MapFeature, { kind: "arrow" }>),
          head: "double",
        },
      ],
      ctx,
    );
    const heads = s[SOURCE_IDS.markers].features.filter(
      (m) => m.properties["role"] === "arrowhead",
    );
    assert.equal(heads.length, 2);
  });

  test("markers are skipped when their icon is not yet loaded", () => {
    const s = buildSources(
      [
        {
          id: "p1",
          kind: "point",
          at: "A",
          at_: [35, 32],
          icon: "evt:strike",
          iconColor: "#E03C31",
          iconSize: 1,
        },
      ],
      { ...ctx, resolveIcon: () => null },
    );
    assert.equal(s[SOURCE_IDS.markers].features.length, 0);
  });

  test("front lines emit a base line plus tooth polygons", () => {
    const s = buildSources(
      [
        {
          id: "f1",
          kind: "frontline",
          at: "A",
          path: [
            [35, 32],
            [35.5, 32],
            [36, 32],
          ],
          facing: "left",
          toothSpacing: 4000,
          toothSize: 2000,
          stroke: { color: "#111", width: 3, opacity: 1 },
        },
      ],
      ctx,
    );
    assert.equal(s[SOURCE_IDS.lines].features.length, 1);
    assert.ok(s[SOURCE_IDS.teeth].features.length > 3);
    for (const t of s[SOURCE_IDS.teeth].features) {
      assert.equal(t.geometry.type, "Polygon");
    }
  });

  test("annotations emit a leader, an anchor dot and a label", () => {
    const s = buildSources([annotation("n1", "Brigade HQ")], ctx);
    const leader = s[SOURCE_IDS.lines].features.find(
      (f) => f.properties["role"] === "leader",
    );
    const dot = s[SOURCE_IDS.markers].features.find(
      (f) => f.properties["role"] === "anchordot",
    );
    assert.ok(leader, "no leader line");
    assert.ok(dot, "no anchor dot");
    assert.equal(s[SOURCE_IDS.labels].features.length, 1);
  });

  // MapLibre #8949: a halo <= 1px cuts Arabic glyph joins.
  test("halo width is lifted clear of the broken band", () => {
    const s = buildSources([annotation("n1", "القاهرة")], ctx);
    assert.equal(s[SOURCE_IDS.labels].features[0]!.properties["haloWidth"], 1.01);
  });

  test("text direction is resolved once, at build time", () => {
    const ar = buildSources([annotation("n1", "القاهرة")], ctx);
    const en = buildSources([annotation("n2", "Cairo")], ctx);
    assert.equal(ar[SOURCE_IDS.labels].features[0]!.properties["dir"], "rtl");
    assert.equal(en[SOURCE_IDS.labels].features[0]!.properties["dir"], "ltr");
  });

  test("sortKey follows the fractional order key, not input order", () => {
    const a = { ...(area("z") as Extract<MapFeature, { kind: "area" }>), at: "Z" };
    const b = { ...(area("a") as Extract<MapFeature, { kind: "area" }>), at: "A" };
    const s = buildSources([a, b], ctx);
    const byId = Object.fromEntries(
      s[SOURCE_IDS.areas].features.map((f) => [
        f.properties["id"],
        f.properties["sortKey"],
      ]),
    );
    assert.ok(
      (byId["a"] as number) < (byId["z"] as number),
      "z-order ignored the order key",
    );
  });

  test("an empty feature set produces empty collections, not errors", () => {
    const s = buildSources([], ctx);
    for (const id of Object.values(SOURCE_IDS)) {
      assert.equal(s[id].features.length, 0);
    }
  });

  test("geometry is copied, not aliased to the input", () => {
    const f = area("a1") as Extract<MapFeature, { kind: "area" }>;
    const s = buildSources([f], ctx);
    const coords = s[SOURCE_IDS.areas].features[0]!.geometry
      .coordinates as number[][][];
    coords[0]![0]![0] = 999;
    assert.equal(f.rings[0]![0]![0], 35, "mutating the source mutated the model");
  });
});

describe("buildLayers", () => {
  test("produces one layer per id in LAYER_ORDER", () => {
    const layers = buildLayers() as { id: string }[];
    assert.equal(layers.length, LAYER_ORDER.length);
    assert.deepEqual(
      layers.map((l) => l.id),
      [...LAYER_ORDER],
    );
  });

  // *-sort-key is a LAYOUT property; in paint MapLibre rejects the whole layer.
  test("sort keys are in layout, never in paint", () => {
    const layers = buildLayers() as {
      id: string;
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    }[];
    for (const l of layers) {
      for (const k of Object.keys(l.paint ?? {})) {
        assert.ok(!k.endsWith("sort-key"), `${l.id} has ${k} in paint`);
      }
    }
    // Every layer must be z-ordered by the feature's order key.
    for (const l of layers) {
      const hasSort = Object.keys(l.layout ?? {}).some((k) =>
        k.endsWith("sort-key"),
      );
      assert.ok(hasSort, `${l.id} has no sort key in layout`);
    }
  });

  // Without icon-ignore-placement the collision engine drops arrowheads.
  test("markers opt out of collision entirely", () => {
    const markers = (buildLayers() as { id: string; layout: Record<string, unknown> }[]).find(
      (l) => l.id === LAYER_IDS.markers,
    )!;
    assert.equal(markers.layout["icon-allow-overlap"], true);
    assert.equal(markers.layout["icon-ignore-placement"], true);
    assert.equal(markers.layout["icon-rotation-alignment"], "map");
  });

  test("labels opt out too, because we de-conflict them ourselves", () => {
    const labels = (buildLayers() as { id: string; layout: Record<string, unknown> }[]).find(
      (l) => l.id === LAYER_IDS.labels,
    )!;
    assert.equal(labels.layout["text-allow-overlap"], true);
    assert.equal(labels.layout["text-ignore-placement"], true);
    // Offsets are baked into the label geometry; a style offset would double.
    assert.equal(labels.layout["text-offset"], undefined);
  });

  test("the font stack is configurable", () => {
    const layers = buildLayers({ fonts: ["Cairo Regular"] }) as {
      id: string;
      layout: Record<string, unknown>;
    }[];
    const labels = layers.find((l) => l.id === LAYER_IDS.labels)!;
    assert.deepEqual(labels.layout["text-font"], ["Cairo Regular"]);
  });
});

describe("recolourSvg", () => {
  test("rewrites explicit black fills", () => {
    for (const input of [
      '<svg><path fill="#000000" d="M0 0"/></svg>',
      '<svg><path fill="#000" d="M0 0"/></svg>',
      '<svg><path fill="black" d="M0 0"/></svg>',
      '<svg><path fill="rgb(0, 0, 0)" d="M0 0"/></svg>',
      '<svg><path fill="currentColor" d="M0 0"/></svg>',
    ]) {
      assert.match(recolourSvg(input, "#E03C31"), /#E03C31/, input);
    }
  });

  test("injects a root fill when the svg declares none", () => {
    // A path with no fill defaults to black in SVG, so it must be caught too.
    const out = recolourSvg('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>', "#1F7A4C");
    assert.match(out, /<svg[^>]*fill="#1F7A4C"/);
  });

  test("leaves an existing non-black root fill alone", () => {
    const out = recolourSvg('<svg fill="#ABCDEF"><path d="M0 0"/></svg>', "#111111");
    assert.match(out, /fill="#ABCDEF"/);
  });
});

describe("spriteId", () => {
  test("is stable and distinguishes shape, colour and size", () => {
    assert.equal(spriteId("arrowhead", "#E03C31", 24), spriteId("arrowhead", "#E03C31", 24));
    assert.notEqual(spriteId("arrowhead", "#E03C31", 24), spriteId("arrowhead", "#2B5FD9", 24));
    assert.notEqual(spriteId("arrowhead", "#E03C31", 24), spriteId("chevron", "#E03C31", 24));
    assert.notEqual(spriteId("arrowhead", "#E03C31", 24), spriteId("arrowhead", "#E03C31", 32));
  });
});
