import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  bearing,
  bearingDelta,
  cumulativeDistances,
  destination,
  distance,
  lngLatToPx,
  metresPerPixel,
  normaliseBearing,
  offsetPath,
  pathLength,
  pointAlong,
  pxToLngLat,
  resampleEvenly,
  zoomForScale,
} from "../src/geo.js";
import type { LngLat } from "../src/types.js";

const RIYADH: LngLat = [46.6753, 24.7136];
const CAIRO: LngLat = [31.2357, 30.0444];

describe("distance", () => {
  // Expected km are published great-circle distances, not remembered figures.
  const REFERENCES: [string, LngLat, LngLat, number][] = [
    ["London to Paris", [-0.1276, 51.5072], [2.3522, 48.8566], 344],
    ["New York to Los Angeles", [-74.006, 40.7128], [-118.2437, 34.0522], 3936],
    ["Riyadh to Cairo", RIYADH, CAIRO, 1636],
  ];

  for (const [name, a, b, expectedKm] of REFERENCES) {
    test(`${name} is about ${expectedKm} km`, () => {
      const km = distance(a, b) / 1000;
      // 0.5% covers our spherical earth vs the ellipsoidal published figures.
      assert.ok(
        Math.abs(km - expectedKm) / expectedKm < 0.005,
        `got ${km.toFixed(1)} km, expected ~${expectedKm} km`,
      );
    });
  }

  test("one degree of longitude at the equator is 111.32 km", () => {
    const km = distance([0, 0], [1, 0]) / 1000;
    assert.ok(Math.abs(km - 111.32) < 0.01, `got ${km}`);
  });

  test("is symmetric", () => {
    assert.ok(
      Math.abs(distance(RIYADH, CAIRO) - distance(CAIRO, RIYADH)) < 1e-6,
    );
  });

  test("is zero for identical points", () => {
    assert.equal(distance(RIYADH, RIYADH), 0);
  });
});

describe("bearing and destination round-trip", () => {
  test("destination then bearing recovers the input bearing", () => {
    for (const b of [0, 37, 90, 180, 271, 359]) {
      const p = destination(RIYADH, 50_000, b);
      const back = bearing(RIYADH, p);
      assert.ok(
        Math.abs(bearingDelta(b, back)) < 0.5,
        `bearing ${b} -> ${back}`,
      );
    }
  });

  test("destination then distance recovers the input distance", () => {
    const p = destination(CAIRO, 12_345, 123);
    assert.ok(Math.abs(distance(CAIRO, p) - 12_345) < 1);
  });

  test("longitude stays in range when crossing the antimeridian", () => {
    const nearDateLine: LngLat = [179.9, 0];
    const p = destination(nearDateLine, 50_000, 90);
    assert.ok(p[0] >= -180 && p[0] <= 180, `longitude escaped: ${p[0]}`);
  });
});

describe("normaliseBearing / bearingDelta", () => {
  test("wraps negatives into [0,360)", () => {
    assert.equal(normaliseBearing(-90), 270);
    assert.equal(normaliseBearing(370), 10);
    assert.equal(normaliseBearing(0), 0);
  });

  test("delta takes the short way round", () => {
    assert.equal(bearingDelta(350, 10), 20);
    assert.equal(bearingDelta(10, 350), -20);
    assert.equal(bearingDelta(0, 180), 180);
  });
});

describe("mercator projection", () => {
  test("px round-trips back to the original coordinate", () => {
    for (const p of [RIYADH, CAIRO, [0, 0], [-120, -40]] as LngLat[]) {
      const back = pxToLngLat(lngLatToPx(p, 12), 12);
      assert.ok(Math.abs(back[0] - p[0]) < 1e-6, `lng ${back[0]} vs ${p[0]}`);
      assert.ok(Math.abs(back[1] - p[1]) < 1e-6, `lat ${back[1]} vs ${p[1]}`);
    }
  });

  test("metresPerPixel halves for each zoom level", () => {
    const a = metresPerPixel(0, 10);
    const b = metresPerPixel(0, 11);
    assert.ok(Math.abs(a / b - 2) < 1e-9, `${a} / ${b}`);
  });

  test("metresPerPixel shrinks toward the poles", () => {
    assert.ok(metresPerPixel(60, 10) < metresPerPixel(0, 10));
  });

  test("zoomForScale inverts metresPerPixel", () => {
    const lat = 24.7;
    const z = 11.5;
    const mpp = metresPerPixel(lat, z);
    assert.ok(Math.abs(zoomForScale(lat, mpp, 1) - z) < 1e-9);
  });
});

describe("polyline helpers", () => {
  const path: LngLat[] = [
    [46.0, 24.0],
    [46.5, 24.0],
    [47.0, 24.0],
  ];

  test("cumulativeDistances is monotonic and starts at zero", () => {
    const c = cumulativeDistances(path);
    assert.equal(c.length, path.length);
    assert.equal(c[0], 0);
    for (let i = 1; i < c.length; i++) assert.ok(c[i]! > c[i - 1]!);
  });

  test("pointAlong at zero returns the first vertex", () => {
    const p = pointAlong(path, 0)!;
    assert.deepEqual(p.position, path[0]);
    assert.equal(p.along, 0);
  });

  test("pointAlong clamps beyond the end", () => {
    const total = pathLength(path);
    const p = pointAlong(path, total * 10)!;
    assert.ok(Math.abs(p.along - total) < 1e-6);
  });

  test("pointAlong at the midpoint is halfway along", () => {
    const total = pathLength(path);
    const p = pointAlong(path, total / 2)!;
    // Due east path: midpoint near the middle vertex, bearing near 90.
    assert.ok(Math.abs(p.position[0] - 46.5) < 0.01, `${p.position[0]}`);
    assert.ok(Math.abs(bearingDelta(90, p.bearing)) < 1, `${p.bearing}`);
  });

  test("pointAlong on a single-point path does not throw", () => {
    const p = pointAlong([[1, 2]], 500)!;
    assert.deepEqual(p.position, [1, 2]);
  });

  test("pointAlong on an empty path returns null", () => {
    assert.equal(pointAlong([], 0), null);
  });

  test("resampleEvenly spaces points at the requested interval", () => {
    const total = pathLength(path);
    const pts = resampleEvenly(path, total / 4);
    // 0, 1/4, 1/2, 3/4, 1 -> five points.
    assert.equal(pts.length, 5);
    for (let i = 1; i < pts.length; i++) {
      const gap = pts[i]!.along - pts[i - 1]!.along;
      assert.ok(Math.abs(gap - total / 4) < 1, `gap ${gap}`);
    }
  });

  test("offsetPath moves left of travel for a positive offset", () => {
    // Travelling east, so left is north.
    const off = offsetPath(path, 1000);
    for (let i = 0; i < path.length; i++) {
      assert.ok(off[i]![1] > path[i]![1], `point ${i} did not move north`);
    }
  });

  test("offsetPath moves right of travel for a negative offset", () => {
    const off = offsetPath(path, -1000);
    for (let i = 0; i < path.length; i++) {
      assert.ok(off[i]![1] < path[i]![1], `point ${i} did not move south`);
    }
  });

  test("offsetPath with zero offset is identity", () => {
    assert.deepEqual(offsetPath(path, 0), path);
  });
});
