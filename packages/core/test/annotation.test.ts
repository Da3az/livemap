import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  arrowHeadMetres,
  arrowHeadPx,
  bearingForIconRotate,
  buildArrow,
  buildArrowForView,
  iconRotateForBearing,
  splineThrough,
  trimPath,
} from "../src/arrow.js";
import { buildFrontline, buildFrontlineForView } from "../src/frontline.js";
import {
  buildLeaderForView,
  estimateTextBox,
  resolveDir,
} from "../src/leader.js";
import {
  bearing,
  bearingDelta,
  distance,
  lngLatToPx,
  pathLength,
} from "../src/geo.js";
import type {
  AnnotationFeature,
  ArrowFeature,
  FrontlineFeature,
  LngLat,
} from "../src/types.js";

const CONTROL: LngLat[] = [
  [35.2, 31.8],
  [35.5, 32.1],
  [35.9, 32.0],
  [36.3, 32.3],
];

function arrowFeature(over: Partial<ArrowFeature> = {}): ArrowFeature {
  return {
    id: "a1",
    kind: "arrow",
    at: "V",
    control: CONTROL,
    curvature: 1,
    head: "single",
    chevrons: false,
    stroke: { color: "#E03C31", width: 4, opacity: 1 },
    ...over,
  } as ArrowFeature;
}

describe("splineThrough", () => {
  test("curvature 0 traces the straight polyline through the controls", () => {
    const curve = splineThrough(CONTROL, 0, 16);
    for (const c of CONTROL) {
      const nearest = Math.min(...curve.map((p) => distance(p, c)));
      assert.ok(nearest < 1, `control ${c} is ${nearest}m off the curve`);
    }
    const straight = pathLength(CONTROL);
    const got = pathLength(curve);
    assert.ok(
      Math.abs(got - straight) / straight < 0.001,
      `length ${got} vs straight ${straight}`,
    );
  });

  test("curvature 1 is longer than the straight polyline", () => {
    const straight = pathLength(CONTROL);
    const curved = pathLength(splineThrough(CONTROL, 1, 24));
    assert.ok(curved > straight, `${curved} should exceed ${straight}`);
  });

  test("passes through the first and last control point exactly", () => {
    const curve = splineThrough(CONTROL, 1, 24);
    assert.ok(distance(curve[0]!, CONTROL[0]!) < 0.01);
    assert.ok(
      distance(curve[curve.length - 1]!, CONTROL[CONTROL.length - 1]!) < 0.01,
    );
  });

  test("emits no duplicate consecutive vertices at segment joins", () => {
    const curve = splineThrough(CONTROL, 1, 8);
    for (let i = 1; i < curve.length; i++) {
      assert.ok(
        distance(curve[i - 1]!, curve[i]!) > 1e-9,
        `duplicate vertex at ${i}`,
      );
    }
  });

  test("degenerate inputs are returned unchanged", () => {
    assert.deepEqual(splineThrough([], 1), []);
    assert.deepEqual(splineThrough([[1, 2]], 1), [[1, 2]]);
  });

  test("clamps out-of-range curvature instead of exploding", () => {
    const a = pathLength(splineThrough(CONTROL, -5, 12));
    const b = pathLength(splineThrough(CONTROL, 0, 12));
    assert.ok(Math.abs(a - b) < 1e-6);
    assert.ok(Number.isFinite(pathLength(splineThrough(CONTROL, 99, 12))));
  });
});

describe("trimPath", () => {
  const path: LngLat[] = [
    [0, 0],
    [1, 0],
    [2, 0],
  ];

  test("trimming nothing preserves the endpoints", () => {
    const t = trimPath(path, 0, pathLength(path));
    assert.ok(distance(t[0]!, path[0]!) < 0.01);
    assert.ok(distance(t[t.length - 1]!, path[path.length - 1]!) < 0.01);
  });

  test("trimmed length matches the requested window", () => {
    const total = pathLength(path);
    const t = trimPath(path, total * 0.25, total * 0.75);
    assert.ok(Math.abs(pathLength(t) - total * 0.5) / total < 0.01);
  });

  test("an inverted window yields nothing rather than throwing", () => {
    assert.deepEqual(trimPath(path, 500, 100), []);
  });
});

describe("buildArrow", () => {
  test("head bearing is tangent to the smoothed curve, not the controls", () => {
    const built = buildArrow(arrowFeature(), { headLengthM: 500 });
    assert.ok(built.headEnd);

    const curve = built.curve;
    const tangent = bearing(curve[curve.length - 2]!, curve[curve.length - 1]!);
    assert.ok(
      Math.abs(bearingDelta(tangent, built.headEnd!.bearing)) < 1,
      `head ${built.headEnd!.bearing} vs tangent ${tangent}`,
    );

    // Must differ from the control-point bearing, or the test passes with the bug present.
    const naive = bearing(CONTROL[CONTROL.length - 2]!, CONTROL[CONTROL.length - 1]!);
    assert.ok(
      Math.abs(bearingDelta(naive, built.headEnd!.bearing)) > 1,
      "curve tangent coincidentally equals the control bearing; pick a sharper test curve",
    );
  });

  test("the shaft is trimmed back by the head length", () => {
    const head = 2_000;
    const built = buildArrow(arrowFeature(), { headLengthM: head });
    const shaftLen = pathLength(built.shaft);
    assert.ok(
      Math.abs(built.lengthM - shaftLen - head) < 50,
      `shaft ${shaftLen}, curve ${built.lengthM}, head ${head}`,
    );
  });

  test("a double head trims both ends", () => {
    const head = 1_500;
    const built = buildArrow(arrowFeature({ head: "double" }), {
      headLengthM: head,
    });
    assert.ok(built.headStart);
    assert.ok(built.headEnd);
    const shaftLen = pathLength(built.shaft);
    assert.ok(Math.abs(built.lengthM - shaftLen - head * 2) < 100);
  });

  test("the start head points back along the path", () => {
    const built = buildArrow(arrowFeature({ head: "double" }), {
      headLengthM: 800,
    });
    const forward = bearing(built.curve[0]!, built.curve[1]!);
    const delta = Math.abs(bearingDelta(forward, built.headStart!.bearing));
    assert.ok(Math.abs(delta - 180) < 1, `expected ~180, got ${delta}`);
  });

  test("head='none' leaves the shaft untrimmed", () => {
    const built = buildArrow(arrowFeature({ head: "none" }), {
      headLengthM: 5_000,
    });
    assert.equal(built.headEnd, null);
    assert.equal(built.headStart, null);
    assert.ok(Math.abs(pathLength(built.shaft) - built.lengthM) < 1);
  });

  test("an absurd head length cannot consume the whole arrow", () => {
    // At low zoom a px-denominated head converts to more metres than the arrow is long.
    const built = buildArrow(arrowFeature(), { headLengthM: 1e9 });
    assert.ok(built.shaft.length >= 2, "shaft was annihilated");
    const shaftLen = pathLength(built.shaft);
    assert.ok(
      shaftLen >= built.lengthM * 0.55,
      `shaft ${shaftLen} of ${built.lengthM} — trim cap did not hold`,
    );
  });

  test("chevrons are evenly spaced and clear of both tips", () => {
    const built = buildArrow(arrowFeature({ chevrons: true }), {
      headLengthM: 1_000,
      chevronSpacingM: 5_000,
    });
    assert.ok(built.chevrons.length > 0, "no chevrons generated");
    for (const c of built.chevrons) {
      const dStart = distance(c.position, built.curve[0]!);
      const dEnd = distance(
        c.position,
        built.curve[built.curve.length - 1]!,
      );
      assert.ok(dStart > 500, `chevron too close to start: ${dStart}`);
      assert.ok(dEnd > 500, `chevron too close to end: ${dEnd}`);
    }
  });

  test("chevrons are suppressed when not requested", () => {
    const built = buildArrow(arrowFeature({ chevrons: false }), {
      chevronSpacingM: 5_000,
    });
    assert.equal(built.chevrons.length, 0);
  });

  test("a zero-length arrow degrades without throwing", () => {
    const f = arrowFeature({ control: [[10, 10], [10, 10]] });
    const built = buildArrow(f, { headLengthM: 100 });
    assert.equal(built.lengthM, 0);
    assert.equal(built.headEnd, null);
  });
});

describe("arrowhead zoom stability", () => {
  // Regression guard: at zoom 6.2 the arrowhead was nearly the radius of the whole curve.
  test("head stays a constant fraction of a pixel size across zooms", () => {
    const lat = 32;
    const w = 4;
    for (const z of [6, 9, 12, 15]) {
      const metres = arrowHeadMetres(w, lat, z);
      // metresPerPixel inlined, to recover the px size independently of geo.ts.
      const px = metres / ((Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * 6378137) / (512 * 2 ** z));
      assert.ok(
        Math.abs(px - arrowHeadPx(w)) < 1e-6,
        `zoom ${z}: ${px}px vs ${arrowHeadPx(w)}px`,
      );
    }
  });

  test("head px size is clamped for hairline and heavy strokes", () => {
    assert.equal(arrowHeadPx(0.1), 8);
    assert.equal(arrowHeadPx(1000), 42);
  });

  test("buildArrowForView keeps a usable shaft even at low zoom", () => {
    for (const z of [4, 8, 14]) {
      const built = buildArrowForView(arrowFeature(), z);
      assert.ok(
        built.shaft.length >= 2,
        `zoom ${z} produced no shaft`,
      );
    }
  });
});

describe("icon rotation", () => {
  test("round-trips through bearing", () => {
    for (const b of [0, 45, 150.99, 270, 348.1]) {
      assert.ok(
        Math.abs(bearingDelta(b, bearingForIconRotate(iconRotateForBearing(b)))) <
          1e-9,
      );
    }
  });

  test("an east-pointing sprite needs -90 for a northward bearing", () => {
    assert.equal(iconRotateForBearing(0), -90);
    assert.equal(iconRotateForBearing(90), 0);
  });
});

describe("buildFrontline", () => {
  function frontline(over: Partial<FrontlineFeature> = {}): FrontlineFeature {
    return {
      id: "f1",
      kind: "frontline",
      at: "V",
      path: [
        [35.0, 32.0],
        [35.5, 32.0],
        [36.0, 32.0],
      ],
      facing: "left",
      toothSpacing: 5_000,
      toothSize: 2_500,
      stroke: { color: "#111111", width: 3, opacity: 1 },
      ...over,
    } as FrontlineFeature;
  }

  test("generates teeth along the line", () => {
    const built = buildFrontline(frontline());
    assert.ok(built.toothCount > 5, `only ${built.toothCount} teeth`);
    assert.equal(built.teeth.length, built.toothCount);
  });

  test("facing left puts the apex north of a due-east line", () => {
    const built = buildFrontline(frontline({ facing: "left" }));
    const tooth = built.teeth[2]!;
    // Triangle ring is [back, apex, forward, back].
    const apex = tooth[1]!;
    assert.ok(apex[1] > 32.0, `apex latitude ${apex[1]} should exceed 32`);
  });

  test("facing right puts the apex south", () => {
    const built = buildFrontline(frontline({ facing: "right" }));
    const apex = built.teeth[2]![1]!;
    assert.ok(apex[1] < 32.0, `apex latitude ${apex[1]} should be below 32`);
  });

  test("triangle teeth are closed rings", () => {
    const built = buildFrontline(frontline(), { shape: "triangle" });
    for (const t of built.teeth) {
      assert.equal(t.length, 4, "triangle should have 4 points (closed)");
      assert.deepEqual(t[0], t[3], "ring is not closed");
    }
  });

  test("tick teeth are two-point segments", () => {
    const built = buildFrontline(frontline(), { shape: "tick" });
    for (const t of built.teeth) assert.equal(t.length, 2);
  });

  test("semicircle teeth bulge toward the facing side", () => {
    const built = buildFrontline(frontline({ facing: "left" }), {
      shape: "semicircle",
      arcSegments: 8,
    });
    const t = built.teeth[2]!;
    assert.ok(t.length > 4, "semicircle should have arc vertices");
    const maxLat = Math.max(...t.map((p) => p[1]));
    assert.ok(maxLat > 32.0, "semicircle did not bulge north");
  });

  test("teeth never hang off either end", () => {
    const built = buildFrontline(frontline());
    const start = built.base[0]!;
    const end = built.base[built.base.length - 1]!;
    for (const t of built.teeth) {
      for (const p of t) {
        assert.ok(p[0] >= start[0] - 0.001 && p[0] <= end[0] + 0.001);
      }
    }
  });

  test("degenerate parameters produce no teeth rather than throwing", () => {
    assert.equal(buildFrontline(frontline({ toothSpacing: 0 })).toothCount, 0);
    assert.equal(buildFrontline(frontline({ toothSize: 0 })).toothCount, 0);
    assert.equal(
      buildFrontline(frontline({ path: [[1, 1]] })).toothCount,
      0,
    );
  });

  test("tooth count grows as you zoom in", () => {
    const low = buildFrontlineForView(frontline(), 5).toothCount;
    const high = buildFrontlineForView(frontline(), 9).toothCount;
    assert.ok(high > low, `zoom 9 gave ${high}, zoom 5 gave ${low}`);
  });
});

describe("leader lines", () => {
  function annotation(over: Partial<AnnotationFeature> = {}): AnnotationFeature {
    return {
      id: "n1",
      kind: "annotation",
      at: "V",
      anchor: [35.5, 32.0],
      offset: [60, -40],
      text: { value: "Armoured column advancing", dir: "auto" },
      labelStyle: {
        color: "#111111",
        haloColor: "#ffffff",
        haloWidth: 1.01,
        size: 13,
      },
      leader: {
        color: "#111111",
        width: 1,
        shape: "straight",
        anchorDot: true,
      },
      ...over,
    } as AnnotationFeature;
  }

  test("leader pixel length is identical at every zoom", () => {
    const lengths: number[] = [];
    for (const z of [4, 7, 10, 13, 16]) {
      const built = buildLeaderForView(annotation(), z);
      const a = lngLatToPx(built.anchorAt, z);
      const t = lngLatToPx(built.textAt, z);
      lengths.push(Math.hypot(t.x - a.x, t.y - a.y));
    }
    const expected = Math.hypot(60, -40);
    for (const l of lengths) {
      assert.ok(
        Math.abs(l - expected) < 0.01,
        `leader length ${l} != ${expected}`,
      );
    }
  });

  test("elbow leaders have exactly one bend", () => {
    const built = buildLeaderForView(
      annotation({
        leader: {
          color: "#111",
          width: 1,
          shape: "elbow",
          anchorDot: false,
        },
      }),
      11,
    );
    assert.equal(built.path.length, 3);
  });

  test("straight leaders are two points", () => {
    assert.equal(buildLeaderForView(annotation(), 11).path.length, 2);
  });

  test("no leader is emitted when the feature has none", () => {
    const built = buildLeaderForView(annotation({ leader: null }), 11);
    assert.deepEqual(built.path, []);
  });

  test("a degenerate offset emits no leader instead of a zero-length stub", () => {
    const built = buildLeaderForView(annotation({ offset: [1, 1] }), 11);
    assert.deepEqual(built.path, []);
  });

  test("attachment side follows the dominant axis", () => {
    assert.equal(buildLeaderForView(annotation({ offset: [80, 5] }), 11).attach, "left");
    assert.equal(buildLeaderForView(annotation({ offset: [-80, 5] }), 11).attach, "right");
    assert.equal(buildLeaderForView(annotation({ offset: [5, 80] }), 11).attach, "top");
    assert.equal(buildLeaderForView(annotation({ offset: [5, -80] }), 11).attach, "bottom");
  });
});

describe("resolveDir", () => {
  test("detects Arabic as rtl", () => {
    assert.equal(resolveDir("القاهرة", "auto"), "rtl");
    assert.equal(resolveDir("رتل مدرع يتقدم", "auto"), "rtl");
  });

  test("detects Latin as ltr", () => {
    assert.equal(resolveDir("Armoured column", "auto"), "ltr");
  });

  test("uses the FIRST strong character, per Unicode bidi", () => {
    assert.equal(resolveDir("2026 — القاهرة", "auto"), "rtl");
    assert.equal(resolveDir("(2026) Cairo", "auto"), "ltr");
  });

  test("an explicit direction always overrides detection", () => {
    assert.equal(resolveDir("القاهرة", "ltr"), "ltr");
    assert.equal(resolveDir("Cairo", "rtl"), "rtl");
  });

  test("neutral-only text falls back to ltr", () => {
    assert.equal(resolveDir("123 456", "auto"), "ltr");
    assert.equal(resolveDir("", "auto"), "ltr");
  });
});

describe("estimateTextBox", () => {
  test("wraps at the maximum width", () => {
    const short = estimateTextBox("Cairo", 13, 220);
    const long = estimateTextBox(
      "Armoured column advancing north-east toward the river crossing",
      13,
      220,
    );
    assert.equal(short.lines, 1);
    assert.ok(long.lines > 1, `expected wrapping, got ${long.lines} line(s)`);
    assert.ok(long.widthPx <= 220);
  });

  test("Arabic is allowed more width per character than Latin", () => {
    const ar = estimateTextBox("القاهرة", 13, 999);
    const la = estimateTextBox("Alqahira", 13, 999);
    // 7 and 8 are the character counts, so this compares width per character.
    assert.ok(ar.widthPx / 7 > la.widthPx / 8);
  });

  test("empty text measures zero", () => {
    const b = estimateTextBox("   ", 13);
    assert.equal(b.widthPx, 0);
    assert.equal(b.lines, 0);
  });
});
