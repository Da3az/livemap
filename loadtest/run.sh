#!/usr/bin/env bash
# Sweeps the read-path modes across reader counts and writes a comparison table.
#
#   ./loadtest/run.sh                      full sweep
#   VUS_LIST="50 200" ./loadtest/run.sh    custom reader counts
#   MODES="db conditional" ./loadtest/run.sh
#
# Requires: docker, the bench stack running (see loadtest/README.md).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS="$ROOT/loadtest/results"
BASE_URL="${BASE_URL:-http://127.0.0.1:8801}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:2.4.0}"
DURATION="${DURATION:-20s}"
VUS_LIST="${VUS_LIST:-50 200 500}"
MODES="${MODES:-db artifact conditional}"
RUN_WS="${RUN_WS:-1}"

mkdir -p "$RESULTS"

# The bench server reports which map it seeded, so the sweep needs no arguments.
MAP_ID="${MAP_ID:-$(curl -fsS "$BASE_URL/bench/stats" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).mapId))')}"

if [ -z "$MAP_ID" ]; then
  echo "could not reach $BASE_URL/bench/stats — is the bench server running?" >&2
  exit 1
fi

echo "bench:    $BASE_URL"
echo "map:      $MAP_ID"
echo "duration: $DURATION per run"
echo "readers:  $VUS_LIST"
echo

run_k6() {
  local script="$1" mode="$2" vus="$3" out="$4"
  # --network host so the container reaches the bench server on 127.0.0.1.
  # --user so the summary file lands owned by the caller; the k6 image runs as
  # a non-root uid that cannot write to a host-mounted directory otherwise.
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" \
    -v "$ROOT/loadtest:/scripts:ro" \
    -v "$RESULTS:/results" \
    -e BASE_URL="$BASE_URL" \
    -e MAP_ID="$MAP_ID" \
    -e MODE="$mode" \
    -e VUS="$vus" \
    -e DURATION="$DURATION" \
    -e SUMMARY_OUT="/results/$out" \
    "$K6_IMAGE" run --quiet "/scripts/$script" >/dev/null 2>&1 || true
}

for vus in $VUS_LIST; do
  for mode in $MODES; do
    echo "running  mode=$mode vus=$vus ..."
    curl -fsS -X POST "$BASE_URL/bench/reset-counters" >/dev/null
    run_k6 read-path.js "$mode" "$vus" "read-${mode}-${vus}.json"
    curl -fsS "$BASE_URL/bench/stats" > "$RESULTS/server-read-${mode}-${vus}.json"
  done

  if [ "$RUN_WS" = "1" ]; then
    echo "running  mode=websocket vus=$vus ..."
    curl -fsS -X POST "$BASE_URL/bench/reset-counters" >/dev/null
    run_k6 websocket.js websocket "$vus" "ws-${vus}.json"
    curl -fsS "$BASE_URL/bench/stats" > "$RESULTS/server-ws-${vus}.json"
  fi
done

echo
node "$ROOT/loadtest/report.mjs" "$RESULTS"
