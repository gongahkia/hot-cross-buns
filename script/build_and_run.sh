#!/usr/bin/env bash
set -euo pipefail

mode="${1:-run}"
app_name="Hot Cross Buns"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_bundle="$root_dir/build/macos-debug-xcode/native/Debug/$app_name.app"
app_binary="$app_bundle/Contents/MacOS/$app_name"

pkill -x "$app_name" >/dev/null 2>&1 || true
cmake --preset macos-debug
cmake --build --preset macos-debug --target hcb_native --parallel 3

if [[ ! -x "$app_binary" ]]; then
  echo "missing built app: $app_binary" >&2
  exit 1
fi

case "$mode" in
  run)
    /usr/bin/open -n "$app_bundle"
    ;;
  --debug|debug)
    lldb -- "$app_binary"
    ;;
  --logs|logs)
    /usr/bin/open -n "$app_bundle"
    /usr/bin/log stream --info --style compact --predicate "process == \"$app_name\""
    ;;
  --telemetry|telemetry)
    /usr/bin/open -n "$app_bundle"
    /usr/bin/log stream --info --style compact --predicate "process == \"$app_name\""
    ;;
  --verify|verify)
    /usr/bin/open -n "$app_bundle"
    sleep 1
    pgrep -x "$app_name" >/dev/null
    ;;
  --profile-timeline|profile-timeline)
    /usr/bin/open -n "$app_bundle" --args --timeline-profile-events=25000
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify|--profile-timeline]" >&2
    exit 2
    ;;
esac
