#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GODOT_BIN="${GODOT_BIN:-/Applications/Godot.app/Contents/MacOS/Godot}"
GODOT_APP="${GODOT_APP:-/Applications/Godot.app}"
LOG_FILE="/tmp/a-slow-walk.log"
PID_FILE="/tmp/a-slow-walk.pid"

if [[ ! -x "$GODOT_BIN" ]]; then
  echo "Godot 4 was not found at $GODOT_BIN" >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  PREVIOUS_PID="$(<"$PID_FILE")"
  kill "$PREVIOUS_PID" >/dev/null 2>&1 || true
fi
"$GODOT_BIN" --headless --path "$ROOT_DIR" --editor --quit

launch() {
  BEFORE_PIDS="$(pgrep -x Godot || true)"
  /usr/bin/open -n "$GODOT_APP" --args --path "$ROOT_DIR" --scene res://scenes/main.tscn
  sleep 1
  GAME_PID="$(comm -13 \
    <(printf '%s\n' "$BEFORE_PIDS" | sed '/^$/d' | sort) \
    <(pgrep -x Godot | sort) | tail -n 1)"
  if [[ -z "$GAME_PID" ]]; then
    echo "Godot did not start a separate game process" >&2
    exit 1
  fi
  echo "$GAME_PID" >"$PID_FILE"
}

case "$MODE" in
  run)
    launch
    ;;
  --debug|debug)
    lldb -- "$GODOT_BIN" --path "$ROOT_DIR" --scene res://scenes/main.tscn
    ;;
  --logs|logs|--telemetry|telemetry)
    launch
    /usr/bin/log stream --info --style compact --predicate "process == \"Godot\""
    ;;
  --verify|verify)
    launch
    sleep 2
    kill -0 "$GAME_PID"
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
