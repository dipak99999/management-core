#!/usr/bin/env bash
# Local load-test runner. Builds a repeatable baseline on real hardware
# (your dev machine or a dedicated perf box), writes results to
# .perf/baseline-<yymmdd>.txt, and compares against the previous
# baseline so a regression surfaces as a diff rather than numbers in
# isolation.
#
# Prefer this over the CI load-test workflow when:
#   • Measuring a known optimisation ("did I just speed up GET /customers?")
#   • Establishing a baseline before a planned refactor
#   • Capturing numbers for a release decision
#
# Noise sources on your laptop:
#   • Thermal throttling after ~2 min of sustained load → run under
#     plugged-in power + stop other heavy processes.
#   • Postgres on tmpfs vs. real disk (we assume local Postgres with
#     fsync=on — matches prod shape).
#   • node:http serial connection reuse — see scripts/load-test.mjs for
#     the implementation; this script just orchestrates runs.
#
# Flags:
#   -w, --workers N         LOAD_WORKERS (default 20)
#   -s, --scenario N        LOAD_SCENARIO (1-4, default all)
#   -b, --budget-ms N       LATENCY_BUDGET_MS for scenario 4 (default 1000)
#   -r, --ramp "a,b,c"      LOAD_RAMP for scenario 4
#   --no-baseline           Don't save as baseline (dry-run)
#   --no-compare            Don't diff against previous baseline

set -eu

WORKERS="${LOAD_WORKERS:-20}"
SCENARIO="${LOAD_SCENARIO:-}"
BUDGET="${LATENCY_BUDGET_MS:-1000}"
RAMP="${LOAD_RAMP:-10,25,50,100,200,500}"
SAVE_BASELINE=1
COMPARE=1

while [ $# -gt 0 ]; do
  case "$1" in
    -w|--workers) WORKERS="$2"; shift 2 ;;
    -s|--scenario) SCENARIO="$2"; shift 2 ;;
    -b|--budget-ms) BUDGET="$2"; shift 2 ;;
    -r|--ramp) RAMP="$2"; shift 2 ;;
    --no-baseline) SAVE_BASELINE=0; shift ;;
    --no-compare) COMPARE=0; shift ;;
    -h|--help)
      echo "Usage: $0 [-w WORKERS] [-s SCENARIO] [-b BUDGET_MS] [-r RAMP] [--no-baseline] [--no-compare]"
      exit 0
      ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

PERF_DIR="$(cd "$(dirname "$0")/.." && pwd)/.perf"
mkdir -p "$PERF_DIR"

# Pre-flight: services must be reachable.
echo "─── Preflight ─────────────────────────────────────────────────"
for ep in \
  "http://localhost:4001/health" \
  "http://localhost:4002/health"; do
  if ! curl -sf -o /dev/null --max-time 3 "$ep"; then
    echo "::error:: service at $ep not reachable. Run 'pnpm dev:wait' first."
    exit 1
  fi
done
echo "  ✓ auth-service + accounting-service responding"
echo

# System snapshot — makes a baseline interpretable later. OS, CPU model,
# available RAM, Postgres version. Keep output stable so diffs are clean.
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_FILE="$PERF_DIR/baseline-$TIMESTAMP.txt"
{
  echo "═══ Load-test baseline $TIMESTAMP ═══"
  echo "host: $(uname -s) $(uname -r)"
  echo "cpu:  $(sysctl -n machdep.cpu.brand_string 2>/dev/null || grep -m1 'model name' /proc/cpuinfo | sed 's/.*: //')"
  echo "mem:  $(sysctl -n hw.memsize 2>/dev/null || grep MemTotal /proc/meminfo | awk '{print $2 * 1024}') bytes"
  echo "node: $(node --version)"
  echo "pnpm: $(pnpm --version)"
  echo "cfg:  workers=$WORKERS scenario=${SCENARIO:-all} budget=${BUDGET}ms ramp=$RAMP"
  echo
} > "$RESULTS_FILE"

echo "─── Load test ─────────────────────────────────────────────────"
LOAD_WORKERS="$WORKERS" \
  LOAD_SCENARIO="$SCENARIO" \
  LATENCY_BUDGET_MS="$BUDGET" \
  LOAD_RAMP="$RAMP" \
  node scripts/load-test.mjs | tee -a "$RESULTS_FILE"

echo
echo "Results saved: $RESULTS_FILE"

if [ "$COMPARE" = "1" ]; then
  # Previous baseline = most recent local run.
  PREV=$(find "$PERF_DIR" -maxdepth 1 -name "baseline-*.txt" -type f \
    -not -name "$(basename "$RESULTS_FILE")" \
    | sort | tail -1)
  if [ -n "$PREV" ]; then
    echo
    echo "─── Diff vs. previous local baseline ($(basename "$PREV")) ──────────"
    diff -u "$PREV" "$RESULTS_FILE" || true
  else
    echo "(no previous local baseline to diff against — this is the first run)"
  fi

  # Shared repo-level reference (dedicated perf box). If present, extract
  # the fenced results block from .perf/BASELINE.md and diff. Lets a dev
  # answer "is my patch slower than the number we shipped on?" without
  # needing their own historical baselines.
  SHARED=".perf/BASELINE.md"
  if [ -f "$SHARED" ]; then
    SHARED_RESULTS=$(mktemp)
    # Extract the LAST fenced block in the "Current reference" section
    # (the one with actual results, after hardware + config fences).
    awk '
      /^## Previous references/ { exit }
      /^## Current reference/   { in_cur = 1; next }
      !in_cur { next }
      /^```/                    { fence = !fence; next }
      fence                     { blocks[++idx] = (blocks[idx] ? blocks[idx] "\n" : "") $0; capture = idx; next }
      END { print blocks[capture] }
    ' "$SHARED" > "$SHARED_RESULTS"
    if [ -s "$SHARED_RESULTS" ] && ! grep -q "paste scripts/load-test-local.sh output" "$SHARED_RESULTS"; then
      echo
      echo "─── Diff vs. shared BASELINE.md ──────────────────────────────"
      diff -u "$SHARED_RESULTS" "$RESULTS_FILE" || true
    fi
    rm -f "$SHARED_RESULTS"
  fi
fi

if [ "$SAVE_BASELINE" = "0" ]; then
  rm "$RESULTS_FILE"
  echo "(--no-baseline: result file deleted)"
fi
