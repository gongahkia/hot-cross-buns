#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/apps/apple/HotCrossBuns.xcodeproj"
DERIVED="${HCB_TRANSITION_PROFILE_DERIVED_DATA:-$ROOT/build/apple/DerivedData}"
APP="$DERIVED/Build/Products/Release/Hot Cross Buns.app"
EXECUTABLE="$APP/Contents/MacOS/Hot Cross Buns"
OUT_DIR="$ROOT/.build-evidence/transition-performance/$(date +%Y%m%d-%H%M%S)"
PROFILE_APP_NAME="HCBProfileTarget"
RUNS="${HCB_TRANSITION_PROFILE_RUNS:-10}"
TIME_LIMIT="${HCB_TRANSITION_PROFILE_TIME_LIMIT:-18s}"
STEP_MS="${HCB_TRANSITION_PROFILE_STEP_MS:-420}"
ITERATIONS="${HCB_TRANSITION_PROFILE_ITERATIONS:-10}"
START_DELAY_MS="${HCB_TRANSITION_PROFILE_START_DELAY_MS:-1800}"
SCENARIOS="${HCB_TRANSITION_PROFILE_SCENARIOS:-sidebar calendarModes sheets commandPalette settingsDiagnostics}"

usage() {
  cat <<USAGE
Usage: scripts/profile-transitions.sh [options]

Options:
  --runs N              xctrace launches per scenario. Default: $RUNS
  --time-limit VALUE    xctrace recording length, for example 18s or 1m. Default: $TIME_LIMIT
  --iterations N        in-app transition iterations per launch. Default: $ITERATIONS
  --step-ms N           in-app delay between transition steps. Default: $STEP_MS
  --start-delay-ms N    delay before the in-app scenario starts. Default: $START_DELAY_MS
  --scenarios "LIST"    space-separated scenarios. Default: $SCENARIOS
  --out DIR             evidence output directory. Default: timestamped under .build-evidence

Scenarios: sidebar calendarModes sheets commandPalette settingsDiagnostics all
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runs) RUNS="$2"; shift 2 ;;
    --time-limit) TIME_LIMIT="$2"; shift 2 ;;
    --iterations) ITERATIONS="$2"; shift 2 ;;
    --step-ms) STEP_MS="$2"; shift 2 ;;
    --start-delay-ms) START_DELAY_MS="$2"; shift 2 ;;
    --scenarios) SCENARIOS="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

mkdir -p "$OUT_DIR/traces" "$OUT_DIR/logs" "$OUT_DIR/summaries"

cat > "$OUT_DIR/README.md" <<README
# Transition Performance Evidence

- Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Runs per scenario: $RUNS
- In-app iterations per run: $ITERATIONS
- Step delay: ${STEP_MS}ms
- Scenario start delay: ${START_DELAY_MS}ms
- xctrace time limit: $TIME_LIMIT
- Scenarios: $SCENARIOS

Each run launches the Release app with \`HCB_PERF_TELEMETRY=1\` and
\`HCB_TRANSITION_PROFILE_SCENARIO\` set. The app emits transition logs and
OS signposts for start, first content, and settled phases.
README

echo "scenario,run,trace,log,summary" > "$OUT_DIR/matrix.csv"

echo "Building Release app..."
xcodebuild \
  -project "$PROJECT" \
  -scheme HotCrossBunsMac \
  -configuration Release \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=YES \
  build

if [[ ! -x "$EXECUTABLE" ]]; then
  echo "Built app executable not found: $EXECUTABLE" >&2
  exit 1
fi

PROFILE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hcb-transition-profile.XXXXXX")"
PROFILE_APP="$PROFILE_ROOT/${PROFILE_APP_NAME}.app"
cleanup() {
  pkill -x "Hot Cross Buns" 2>/dev/null || true
  pkill -x "$PROFILE_APP_NAME" 2>/dev/null || true
  rm -rf "$PROFILE_ROOT"
}
trap cleanup EXIT
ditto "$APP" "$PROFILE_APP"
plutil -replace CFBundleIdentifier -string "com.gongahkia.hotcrossbuns.mac.profile" "$PROFILE_APP/Contents/Info.plist"
plutil -replace CFBundleName -string "$PROFILE_APP_NAME" "$PROFILE_APP/Contents/Info.plist"
plutil -replace CFBundleDisplayName -string "$PROFILE_APP_NAME" "$PROFILE_APP/Contents/Info.plist"

summarize_log() {
  local log_file="$1"
  local summary_file="$2"
  awk '
    /transition.firstContent/ {
      name = ""
      elapsed = ""
      for (i = 1; i <= NF; i++) {
        if ($i == "transition.firstContent" && i + 1 <= NF) name = $(i + 1)
        if ($i ~ /^elapsed_ms=/) {
          split($i, parts, "=")
          elapsed = parts[2]
        }
      }
      if (name != "" && elapsed != "") {
        key = name
        count[key] += 1
        values[key, count[key]] = elapsed + 0
      }
    }
    END {
      print "transition,count,p95_first_content_ms,max_first_content_ms"
      for (key in count) {
        n = count[key]
        for (i = 1; i <= n; i++) sorted[i] = values[key, i]
        for (i = 1; i <= n; i++) {
          for (j = i + 1; j <= n; j++) {
            if (sorted[j] < sorted[i]) {
              tmp = sorted[i]; sorted[i] = sorted[j]; sorted[j] = tmp
            }
          }
        }
        idx = int(n * 0.95)
        if (idx < 1) idx = 1
        if (idx > n) idx = n
        printf "%s,%d,%.2f,%.2f\n", key, n, sorted[idx], sorted[n]
        delete sorted
      }
    }
  ' "$log_file" > "$summary_file"
}

for scenario in $SCENARIOS; do
  for run in $(seq 1 "$RUNS"); do
    safe_scenario="${scenario//[^A-Za-z0-9_-]/_}"
    trace="$OUT_DIR/traces/${safe_scenario}-run-${run}.trace"
    log_file="$OUT_DIR/logs/${safe_scenario}-run-${run}.log"
    xctrace_log="$OUT_DIR/logs/${safe_scenario}-run-${run}.xctrace.log"
    summary_file="$OUT_DIR/summaries/${safe_scenario}-run-${run}.csv"

    echo "Profiling scenario=$scenario run=$run/$RUNS..."
    pkill -x "Hot Cross Buns" 2>/dev/null || true
    pkill -x "$PROFILE_APP_NAME" 2>/dev/null || true

    set +e
    xcrun xctrace record \
      --template SwiftUI \
      --time-limit "$TIME_LIMIT" \
      --output "$trace" \
      --no-prompt \
      --target-stdout /dev/null \
      --env HCB_PERF_TELEMETRY=1 \
      --env HCB_TRANSITION_PROFILE_SCENARIO="$scenario" \
      --env HCB_TRANSITION_PROFILE_ITERATIONS="$ITERATIONS" \
      --env HCB_TRANSITION_PROFILE_STEP_MS="$STEP_MS" \
      --env HCB_TRANSITION_PROFILE_START_DELAY_MS="$START_DELAY_MS" \
      --launch -- "$PROFILE_APP" > "$xctrace_log" 2>&1
    trace_status=$?
    set -e

    pkill -x "Hot Cross Buns" 2>/dev/null || true
    pkill -x "$PROFILE_APP_NAME" 2>/dev/null || true
    if [[ "$trace_status" -ne 0 ]] && { [[ ! -e "$trace" ]] || grep -q "no SwiftUI data" "$xctrace_log"; }; then
      cat "$xctrace_log" >&2
      exit "$trace_status"
    fi

    /usr/bin/log show \
      --style compact \
      --info \
      --debug \
      --last 3m \
      --predicate 'subsystem == "com.gongahkia.hotcrossbuns.mac" && (composedMessage CONTAINS "transition." || composedMessage CONTAINS "snapshot" || composedMessage CONTAINS "cache")' \
      > "$log_file" || true

    summarize_log "$log_file" "$summary_file"
    echo "$scenario,$run,$trace,$log_file,$summary_file" >> "$OUT_DIR/matrix.csv"
  done
done

pkill -x "Hot Cross Buns" 2>/dev/null || true

{
  echo "transition,count,p95_first_content_ms,max_first_content_ms"
  tail -n +2 "$OUT_DIR"/summaries/*.csv 2>/dev/null | awk -F, 'NF == 4 { print $0 }'
} > "$OUT_DIR/combined-first-content.csv"

echo "Evidence written to $OUT_DIR"
