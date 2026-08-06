#!/usr/bin/env bash
set -euo pipefail

readonly repetitions=15

usage() {
  printf 'usage: %s <new-result-directory> [command ...]\n' "${0##*/}" >&2
}

nanoseconds() {
  python3 -c 'import time; print(time.time_ns())'
}

toml_escape() {
  python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()), end="")'
}

[[ $# -ge 1 ]] || { usage; exit 2; }
readonly result_directory="$1"
shift
readonly fixture="${WUKONG_BENCH_FIXTURE:?set WUKONG_BENCH_FIXTURE for this workload}"
readonly cache_state="${WUKONG_BENCH_CACHE_STATE:?set WUKONG_BENCH_CACHE_STATE for this workload}"
[[ ! -e "$result_directory" ]] || {
  printf 'error: result directory already exists: %s\n' "$result_directory" >&2
  exit 2
}

if [[ $# -eq 0 ]]; then
  command=(cargo +1.85.0 bench --locked -p wukong-core --bench component_harness)
else
  command=("$@")
fi
command_display="$(printf '%q ' "${command[@]}")"
command_display="${command_display% }"

mkdir -p "$result_directory/raw" "$result_directory/environment"
printf '%s\n' "$command_display" > "$result_directory/command.sh"
{
  printf 'schema = 1\n'
  printf 'wukong_revision = "%s"\n' "$(git rev-parse HEAD)"
  printf 'fixture_revision = "wukong-111-v1"\n'
  printf 'fixture = %s\n' "$(printf '%s' "$fixture" | toml_escape)"
  printf 'cache_state = %s\n' "$(printf '%s' "$cache_state" | toml_escape)"
  printf 'command = %s\n' "$(printf '%s' "$command_display" | toml_escape)"
  printf 'repetitions = %s\n' "$repetitions"
  printf 'rustc = "environment/rustc.txt"\n'
  printf 'hardware = "environment/hardware.txt"\n'
  printf 'operating_system = "environment/os.txt"\n'
  printf 'filesystem = "environment/mount.txt"\n'
  printf 'network_conditions = %s\n' "$(printf '%s' "${WUKONG_BENCH_NETWORK_CONDITIONS:-not-applicable}" | toml_escape)"
} > "$result_directory/metadata.toml"

rustc +1.85.0 -Vv > "$result_directory/environment/rustc.txt"
uname -a > "$result_directory/environment/os.txt"
mount > "$result_directory/environment/mount.txt"
if command -v system_profiler >/dev/null 2>&1; then
  system_profiler SPHardwareDataType SPSoftwareDataType > "$result_directory/environment/hardware.txt"
elif command -v lscpu >/dev/null 2>&1; then
  lscpu > "$result_directory/environment/hardware.txt"
elif command -v systeminfo >/dev/null 2>&1; then
  systeminfo > "$result_directory/environment/hardware.txt"
else
  uname -a > "$result_directory/environment/hardware.txt"
fi

for run in $(seq -w 1 "$repetitions"); do
  started="$(nanoseconds)"
  if "${command[@]}" > "$result_directory/raw/$run.stdout" 2> "$result_directory/raw/$run.stderr"; then
    status=0
  else
    status=$?
  fi
  ended="$(nanoseconds)"
  printf '%s\n' "$status" > "$result_directory/raw/$run.status"
  printf '%s\n' "$((ended - started))" > "$result_directory/raw/$run.wall_ns"
done

{
  printf '# Raw benchmark record\n\n'
  printf 'Fixture: `%s`  \n' "$fixture"
  printf 'Cache state: `%s`  \n' "$cache_state"
  printf 'Runs: `%s`  \n\n' "$repetitions"
  printf 'This file is an index only. Derive statistics from the immutable `raw/` observations.\n'
} > "$result_directory/summary.md"
