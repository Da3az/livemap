#!/usr/bin/env bash
# Full reproduction of the published numbers: three axes, one command.
#
#   1. reader count   50 / 200 / 500 concurrent readers
#   2. map size       250 vs 1000 features
#   3. pool size      10 vs 50 Postgres connections (the "just raise the pool"
#                     objection, tested rather than assumed)
#
# Brings the database and the bench server up and down itself.
#
#   ./loadtest/sweep-all.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RESULTS="$ROOT/loadtest/results"
DURATION="${DURATION:-20s}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:2.4.0}"
BASE_URL="http://127.0.0.1:8801"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

mkdir -p "$RESULTS"
rm -f "$RESULTS"/*.json "$RESULTS/REPORT.md"

BENCH_PID=""
stop_bench() {
  if [ -n "$BENCH_PID" ] && kill -0 "$BENCH_PID" 2>/dev/null; then
    kill "$BENCH_PID" 2>/dev/null || true
    wait "$BENCH_PID" 2>/dev/null || true
  fi
  BENCH_PID=""
}
trap stop_bench EXIT

start_bench() {
  BENCH_POOL_MAX="$1" node --import tsx bench/server.mjs > /tmp/livemap-bench.log 2>&1 &
  BENCH_PID=$!
  for _ in $(seq 1 40); do
    if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "bench server did not come up; see /tmp/livemap-bench.log" >&2
  cat /tmp/livemap-bench.log >&2
  exit 1
}

map_id() {
  curl -fsS "$BASE_URL/bench/stats" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).mapId))'
}

k6() {
  local script="$1" mode="$2" vus="$3" out="$4" mapid="$5"
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" \
    -v "$ROOT/loadtest:/scripts:ro" \
    -v "$RESULTS:/results" \
    -e BASE_URL="$BASE_URL" -e MAP_ID="$mapid" -e MODE="$mode" \
    -e VUS="$vus" -e DURATION="$DURATION" -e SUMMARY_OUT="/results/$out" \
    "$K6_IMAGE" run --quiet "/scripts/$script" >/dev/null 2>&1 || true
}

echo "==> database"
docker compose up -d >/dev/null
for _ in $(seq 1 40); do
  [ "$(docker inspect --format '{{.State.Health.Status}}' livemap-db-1 2>/dev/null)" = "healthy" ] && break
  sleep 2
done
node scripts/migrate.mjs up

# ---------------------------------------------------------------------------
# Axis 1 + 2: reader count, at 250 features
# ---------------------------------------------------------------------------
echo "==> seeding 250 features"
node --import tsx bench/seed.mjs 250 >/dev/null
start_bench 10
MAP=$(map_id)

for vus in 50 200 500; do
  for mode in db artifact conditional; do
    echo "    250 features  mode=$mode vus=$vus"
    curl -fsS -X POST "$BASE_URL/bench/reset-counters" >/dev/null
    k6 read-path.js "$mode" "$vus" "read-${mode}-${vus}.json" "$MAP"
    curl -fsS "$BASE_URL/bench/stats" > "$RESULTS/server-read-${mode}-${vus}.json"
  done
  echo "    250 features  mode=websocket vus=$vus"
  k6 websocket.js websocket "$vus" "ws-${vus}.json" "$MAP"
  curl -fsS "$BASE_URL/bench/stats" > "$RESULTS/server-ws-${vus}.json"
done
stop_bench

# ---------------------------------------------------------------------------
# Axis 2: map size, at a fixed 200 readers
# ---------------------------------------------------------------------------
echo "==> seeding 1000 features"
node --import tsx bench/seed.mjs 1000 >/dev/null
start_bench 10
MAP=$(map_id)

for mode in db artifact conditional; do
  echo "    1000 features  mode=$mode vus=200"
  curl -fsS -X POST "$BASE_URL/bench/reset-counters" >/dev/null
  k6 read-path.js "$mode" 200 "size1000-${mode}-200.json" "$MAP"
  curl -fsS "$BASE_URL/bench/stats" > "$RESULTS/server-size1000-${mode}-200.json"
done
stop_bench

# ---------------------------------------------------------------------------
# Axis 3: the "just raise the connection pool" objection
# ---------------------------------------------------------------------------
echo "==> pool=50, 1000 features, db mode"
start_bench 50
MAP=$(map_id)
curl -fsS -X POST "$BASE_URL/bench/reset-counters" >/dev/null
k6 read-path.js db 200 "pool50-db-200.json" "$MAP"
curl -fsS "$BASE_URL/bench/stats" > "$RESULTS/server-pool50-db-200.json"
stop_bench

echo
node "$ROOT/loadtest/report.mjs" "$RESULTS"
