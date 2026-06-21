#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DMG_PATH="${1:-}"
APP_NAME="${APP_NAME:-Hot Cross Buns.app}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-20}"
MOUNT_POINT=""

if [[ -z "$DMG_PATH" ]]; then
  echo "Usage: $0 path/to/HotCrossBuns-<version>-macOS.dmg" >&2
  exit 1
fi

if [[ ! -f "$DMG_PATH" ]]; then
  echo "DMG not found: $DMG_PATH" >&2
  exit 1
fi

cleanup() {
  if [[ -n "$MOUNT_POINT" && -d "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
  fi
}

trap cleanup EXIT

ATTACH_OUTPUT="$(hdiutil attach "$DMG_PATH" -nobrowse -readonly)"
MOUNT_POINT="$(printf '%s\n' "$ATTACH_OUTPUT" | awk -F '\t' '$NF ~ /^\// { print $NF }' | tail -n 1)"

if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
  echo "Failed to determine mounted volume for $DMG_PATH" >&2
  exit 1
fi

APP_PATH="$MOUNT_POINT/$APP_NAME"
if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found in mounted DMG: $APP_PATH" >&2
  exit 1
fi

EXECUTABLE="$APP_PATH/Contents/MacOS/${APP_NAME%.app}"
if [[ ! -x "$EXECUTABLE" ]]; then
  echo "Executable not found in app bundle: $EXECUTABLE" >&2
  exit 1
fi

"$EXECUTABLE" --smoke-test &
APP_PID=$!
DEADLINE=$((SECONDS + WAIT_TIMEOUT_SECONDS))

while kill -0 "$APP_PID" 2>/dev/null; do
  if (( SECONDS >= DEADLINE )); then
    echo "Smoke test timed out after ${WAIT_TIMEOUT_SECONDS}s: $EXECUTABLE" >&2
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

wait "$APP_PID"
