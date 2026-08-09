#!/usr/bin/env bash
set -euo pipefail

mode="${1:-run}"
app_name="Hot Cross Buns"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
platform="$(uname -s)"

case "$platform" in
  Darwin)
    preset="macos-debug"
    build_dir="$root_dir/build/macos-debug-xcode"
    app_bundle="$build_dir/native/Debug/$app_name.app"
    app_binary="$app_bundle/Contents/MacOS/$app_name"
    ;;
  Linux)
    preset="fedora43-debug"
    build_dir="$root_dir/build/fedora43-debug"
    app_bundle=""
    app_binary="$build_dir/native/$app_name"
    ;;
  *)
    echo "unsupported platform: $platform" >&2
    exit 2
    ;;
esac

log_file="$build_dir/hcb-debug.log"

launch_app() {
  if [[ "$platform" == "Darwin" ]]; then
    /usr/bin/open -n "$app_bundle" "$@"
  else
    nohup "$app_binary" "$@" >"$log_file" 2>&1 &
  fi
}

pkill -x "$app_name" >/dev/null 2>&1 || true
cmake --preset "$preset"
cmake --build --preset "$preset" --target hcb_native --parallel 3

if [[ ! -x "$app_binary" ]]; then
  echo "missing built app: $app_binary" >&2
  exit 1
fi

case "$mode" in
  run)
    launch_app
    ;;
  --debug|debug)
    lldb -- "$app_binary"
    ;;
  --logs|logs)
    echo "writing logs to $log_file"
    QT_LOGGING_TO_CONSOLE=1 "$app_binary" 2>&1 | tee -a "$log_file"
    ;;
  --telemetry|telemetry)
    if [[ "$platform" != "Darwin" ]]; then
      echo "telemetry mode is only supported on macOS" >&2
      exit 2
    fi
    /usr/bin/open -n "$app_bundle"
    /usr/bin/log stream --info --style compact --predicate "process == \"$app_name\""
    ;;
  --verify|verify)
    launch_app
    sleep 1
    pgrep -x "$app_name" >/dev/null
    ;;
  --profile-timeline|profile-timeline)
    if [[ "$platform" == "Darwin" ]]; then
      launch_app --args --timeline-profile-events=25000
    else
      launch_app --timeline-profile-events=25000
    fi
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify|--profile-timeline]" >&2
    exit 2
    ;;
esac
