#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GODOT_BIN="${GODOT_BIN:-/Applications/Godot.app/Contents/MacOS/Godot}"

if [[ ! -x "$GODOT_BIN" ]]; then
  echo "Godot 4 was not found at $GODOT_BIN" >&2
  exit 1
fi

mkdir -p "$ROOT_DIR/dist"
"$GODOT_BIN" --headless --path "$ROOT_DIR" --export-release macOS "$ROOT_DIR/dist/a-slow-walk.app"
"$GODOT_BIN" --headless --path "$ROOT_DIR" --export-release "Windows Desktop" "$ROOT_DIR/dist/a-slow-walk.exe"
