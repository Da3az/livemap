#!/usr/bin/env node
// Renders the sweep's JSON summaries as a markdown comparison table.
//
//   node loadtest/report.mjs [resultsDir]

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? join(import.meta.dirname, "results");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

const read = (f) => {
  try {
    return JSON.parse(readFileSync(join(dir, f), "utf8"));
  } catch {
    return null;
  }
};

const reads = [];
const sockets = [];
const bigMap = [];
const poolRaised = [];
const servers = new Map();

for (const f of files) {
  const d = read(f);
  if (!d) continue;
  if (f.startsWith("read-")) reads.push(d);
  else if (f.startsWith("ws-")) sockets.push(d);
  else if (f.startsWith("size1000-")) bigMap.push(d);
  else if (f.startsWith("pool50-")) poolRaised.push(d);
  else if (f.startsWith("server-")) servers.set(f.replace(/^server-|\.json$/g, ""), d);
}

const n = (v, digits = 1) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
const mb = (bytes) =>
  typeof bytes === "number" ? (bytes / 1048576).toFixed(1) : "—";

const MODE_LABEL = {
  db: "A. Postgres per request",
  artifact: "B. Artifact, full 200",
  conditional: "C. Artifact + If-None-Match",
};

let out = "# Read-path load test results\n\n";

if (reads.length > 0) {
  reads.sort((a, b) => a.vus - b.vus || a.mode.localeCompare(b.mode));

  out += "## HTTP read paths\n\n";
  out += "| Readers | Scenario | Requests | req/s | p95 ms | p99 ms | Max ms | Failed | Transferred |\n";
  out += "|--:|---|--:|--:|--:|--:|--:|--:|--:|\n";

  for (const r of reads) {
    out += `| ${r.vus} | ${MODE_LABEL[r.mode] ?? r.mode} | ${r.requests} | ${n(r.rps, 0)} | ${n(r.latency?.p95, 1)} | ${n(r.latency?.p99, 1)} | ${n(r.latency?.max, 1)} | ${n((r.failedRate ?? 0) * 100, 2)}% | ${mb(r.dataReceived)} MB |\n`;
  }
  out += "\n";

  // Pool pressure is the mechanism, so report it next to the latency it causes.
  out += "### Server-side during each run\n\n";
  out += "| Run | Pool total | Pool waiting | RSS MB | 304s served |\n";
  out += "|---|--:|--:|--:|--:|\n";
  for (const [k, s] of [...servers.entries()].sort()) {
    if (!k.startsWith("read-")) continue;
    out += `| ${k.replace("read-", "")} | ${s.pool?.total ?? "—"} | ${s.pool?.waiting ?? "—"} | ${s.memory?.rssMb ?? "—"} | ${s.counters?.notModified ?? 0} |\n`;
  }
  out += "\n";
}

if (sockets.length > 0) {
  sockets.sort((a, b) => a.vus - b.vus);
  out += "## WebSocket fan-out\n\n";
  out += "| Readers | Connected | Failed | Frames received | Notify p95 ms | Server RSS MB | Transferred |\n";
  out += "|--:|--:|--:|--:|--:|--:|--:|\n";
  for (const w of sockets) {
    const s = servers.get(`ws-${w.vus}`);
    out += `| ${w.vus} | ${w.connected} | ${w.connectFailed} | ${w.messagesReceived} | ${n(w.notifyLatency?.p95, 1)} | ${s?.memory?.rssMb ?? "—"} | ${mb(w.dataReceived)} MB |\n`;
  }
  out += "\n";
}

if (bigMap.length > 0) {
  bigMap.sort((a, b) => a.mode.localeCompare(b.mode));
  out += "## Map size: 1000 features, 200 readers\n\n";
  out += "| Scenario | req/s | p95 ms | p99 ms | Transferred |\n";
  out += "|---|--:|--:|--:|--:|\n";
  for (const r of bigMap) {
    out += `| ${MODE_LABEL[r.mode] ?? r.mode} | ${n(r.rps, 0)} | ${n(r.latency?.p95, 1)} | ${n(r.latency?.p99, 1)} | ${mb(r.dataReceived)} MB |\n`;
  }
  out += "\n";
}

if (poolRaised.length > 0) {
  out += "## Raising the connection pool 10 to 50\n\n";
  out += "| Scenario | Pool | req/s | p95 ms | p99 ms |\n";
  out += "|---|--:|--:|--:|--:|\n";
  const baseline = bigMap.find((r) => r.mode === "db");
  if (baseline) {
    out += `| Postgres per request | 10 | ${n(baseline.rps, 0)} | ${n(baseline.latency?.p95, 1)} | ${n(baseline.latency?.p99, 1)} |\n`;
  }
  for (const r of poolRaised) {
    out += `| Postgres per request | 50 | ${n(r.rps, 0)} | ${n(r.latency?.p95, 1)} | ${n(r.latency?.p99, 1)} |\n`;
  }
  out += "\n";
}

const path = join(dir, "REPORT.md");
writeFileSync(path, out);
console.log(out);
console.log(`written: ${path}`);
