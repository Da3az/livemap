// WebSocket fan-out under the same reader count as the polling test.
//
// Two scenarios run together: `readers` holds VUS persistent connections for
// the whole run, and `publisher` triggers a publish every PUBLISH_EVERY so
// there is something to fan out. Measures connection setup, publish-to-receipt
// latency, and how many connections the origin actually sustains.
//
// Import path note: `k6/websockets` is the stable module. The older
// `k6/experimental/websockets` path was removed in k6 v2.

import { WebSocket } from "k6/websockets";
import http from "k6/http";
import { sleep } from "k6";
import { Counter, Trend, Gauge } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:8801";
const WS_BASE = BASE.replace(/^http/, "ws");
const MAP_ID = __ENV.MAP_ID;
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || "30s";
const PUBLISH_EVERY = Number(__ENV.PUBLISH_EVERY || 5);

if (!MAP_ID) throw new Error("MAP_ID is required");

const connected = new Counter("ws_connected");
const connectFailed = new Counter("ws_connect_failed");
const messages = new Counter("ws_messages");
const notifyLatency = new Trend("ws_notify_latency_ms", true);
const openSockets = new Gauge("ws_open_sockets");

export const options = {
  scenarios: {
    readers: {
      executor: "per-vu-iterations",
      vus: VUS,
      iterations: 1,
      maxDuration: DURATION,
      exec: "reader",
    },
    publisher: {
      executor: "constant-vus",
      vus: 1,
      duration: DURATION,
      exec: "publisher",
      startTime: "3s",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
};

const HOLD_MS = (() => {
  const m = /^(\d+)([sm])$/.exec(DURATION);
  if (!m) return 30_000;
  return Number(m[1]) * (m[2] === "m" ? 60_000 : 1_000);
})();

export function reader() {
  const ws = new WebSocket(`${WS_BASE}/live?map=${MAP_ID}`);
  let open = false;

  ws.addEventListener("open", () => {
    open = true;
    connected.add(1);
    openSockets.add(1);
  });

  ws.addEventListener("message", (e) => {
    messages.add(1);
    try {
      const msg = JSON.parse(e.data);
      if (msg.ts) notifyLatency.add(Date.now() - msg.ts);
    } catch {
      // A frame we cannot parse still counts as delivered.
    }
  });

  ws.addEventListener("error", () => {
    if (!open) connectFailed.add(1);
  });

  // Hold the connection for the run. This is the structural cost being
  // measured: the origin carries every reader for the whole session.
  setTimeout(() => ws.close(), HOLD_MS - 2000);
}

export function publisher() {
  http.post(`${BASE}/bench/publish`);
  // Runs in its own VU, so blocking here does not stall any reader's socket
  // handlers.
  sleep(PUBLISH_EVERY);
}

export function handleSummary(data) {
  const m = data.metrics;
  const out = {
    mode: "websocket",
    vus: VUS,
    duration: DURATION,
    connected: m.ws_connected ? m.ws_connected.values.count : 0,
    connectFailed: m.ws_connect_failed ? m.ws_connect_failed.values.count : 0,
    messagesReceived: m.ws_messages ? m.ws_messages.values.count : 0,
    notifyLatency: m.ws_notify_latency_ms
      ? {
          avg: m.ws_notify_latency_ms.values.avg,
          med: m.ws_notify_latency_ms.values.med,
          p95: m.ws_notify_latency_ms.values["p(95)"],
          max: m.ws_notify_latency_ms.values.max,
        }
      : null,
    dataReceived: m.data_received ? m.data_received.values.count : 0,
  };
  const path = __ENV.SUMMARY_OUT || "/results/summary.json";
  return { [path]: JSON.stringify(out, null, 2), stdout: "" };
}
