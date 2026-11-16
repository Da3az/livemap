// Read-path comparison. One script, three modes, identical payload:
//
//   MODE=db           read from Postgres on every request
//   MODE=artifact     prebuilt immutable artifact, always a full 200
//   MODE=conditional  artifact + If-None-Match, so a repeat reader gets 304
//
// The claim under test is that the read path must never touch the database.
// Run via loadtest/run.sh, which sweeps VUS and collects the summaries.

import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:8801";
const MAP_ID = __ENV.MAP_ID;
const MODE = __ENV.MODE || "artifact";
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || "30s";

if (!MAP_ID) throw new Error("MAP_ID is required");

const bytesReceived = new Counter("payload_bytes");
const ttfb = new Trend("ttfb_ms", true);

export const options = {
  scenarios: {
    read: {
      executor: "constant-vus",
      vus: VUS,
      duration: DURATION,
      gracefulStop: "5s",
    },
  },
  // Deliberately loose: the point is to record what each design does under
  // load, not to fail a build. run.sh compares the recorded numbers.
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
};

const URLS = {
  db: `${BASE}/bench/db/${MAP_ID}`,
  artifact: `${BASE}/bench/artifact/${MAP_ID}`,
  conditional: `${BASE}/bench/artifact/${MAP_ID}`,
};

// Each VU caches the ETag after its first response, which is what a real
// polling reader does. Without this the conditional mode would never produce a
// 304 and would just be the artifact mode again.
let cachedEtag = null;

export default function () {
  const url = URLS[MODE];
  const params = { tags: { mode: MODE } };

  if (MODE === "conditional" && cachedEtag) {
    params.headers = { "If-None-Match": cachedEtag };
  }

  const res = http.get(url, params);

  if (MODE === "conditional") {
    if (res.status === 200 && res.headers["Etag"]) {
      cachedEtag = res.headers["Etag"];
    }
    check(res, {
      "200 or 304": (r) => r.status === 200 || r.status === 304,
    });
  } else {
    check(res, { "status is 200": (r) => r.status === 200 });
  }

  bytesReceived.add(res.body ? res.body.length : 0);
  ttfb.add(res.timings.waiting);
}

export function handleSummary(data) {
  const out = {
    mode: MODE,
    vus: VUS,
    duration: DURATION,
    requests: data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0,
    rps: data.metrics.http_reqs ? data.metrics.http_reqs.values.rate : 0,
    failedRate: data.metrics.http_req_failed
      ? data.metrics.http_req_failed.values.rate
      : 0,
    latency: data.metrics.http_req_duration
      ? {
          avg: data.metrics.http_req_duration.values.avg,
          med: data.metrics.http_req_duration.values.med,
          p95: data.metrics.http_req_duration.values["p(95)"],
          p99: data.metrics.http_req_duration.values["p(99)"],
          max: data.metrics.http_req_duration.values.max,
        }
      : null,
    payloadBytes: data.metrics.payload_bytes
      ? data.metrics.payload_bytes.values.count
      : 0,
    dataReceived: data.metrics.data_received
      ? data.metrics.data_received.values.count
      : 0,
  };

  const path = __ENV.SUMMARY_OUT || "/results/summary.json";
  return { [path]: JSON.stringify(out, null, 2), stdout: "" };
}
