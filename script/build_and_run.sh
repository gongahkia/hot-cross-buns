#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GODOT_BIN="${GODOT_BIN:-/Applications/Godot.app/Contents/MacOS/Godot}"
LOG_FILE="/tmp/a-slow-walk.log"

if [[ ! -x "$GODOT_BIN" ]]; then
  echo "Godot 4 was not found at $GODOT_BIN" >&2
  exit 1
fi

pkill -f "Godot.*--path.*$ROOT_DIR" >/dev/null 2>&1 || true
"$GODOT_BIN" --headless --path "$ROOT_DIR" --editor --quit

launch() {
  "$GODOT_BIN" --path "$ROOT_DIR" >"$LOG_FILE" 2>&1 &
}

case "$MODE" in
  run)
    launch
    ;;
  --debug|debug)
    lldb -- "$GODOT_BIN" --path "$ROOT_DIR"
    ;;
  --logs|logs|--telemetry|telemetry)
    launch
    tail -f "$LOG_FILE"
    ;;
  --verify|verify)
    launch
    sleep 2
    pgrep -f "Godot.*--path.*$ROOT_DIR" >/dev/null
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
