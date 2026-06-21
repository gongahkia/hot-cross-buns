#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:-release}"

if [[ -d "$release_dir" ]]; then
  dmg_path="$(find "$release_dir" -maxdepth 1 -type f -name '*.dmg' ! -name '*blockmap' | sort | tail -n 1)"
else
  dmg_path="$release_dir"
fi

if [[ -z "${dmg_path:-}" || ! -f "$dmg_path" ]]; then
  echo "No DMG found for smoke test." >&2
  exit 1
fi

mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/hcb-dmg-smoke.XXXXXX")"
cleanup() {
  hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
  rm -rf "$mount_dir"
}
trap cleanup EXIT

hdiutil attach "$dmg_path" -readonly -nobrowse -mountpoint "$mount_dir" -quiet

app_path="$(find "$mount_dir" -maxdepth 2 -type d -name 'Hot Cross Buns.app' | head -n 1)"
if [[ -z "$app_path" ]]; then
  echo "DMG did not contain Hot Cross Buns.app." >&2
  exit 1
fi

plist="$app_path/Contents/Info.plist"
executable="$app_path/Contents/MacOS/Hot Cross Buns"

if [[ ! -f "$plist" ]]; then
  echo "App bundle is missing Info.plist." >&2
  exit 1
fi

if [[ ! -x "$executable" ]]; then
  echo "App bundle executable is missing or not executable." >&2
  exit 1
fi

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
if [[ "$bundle_id" != "dev.hotcrossbuns.hotcrossbuns" ]]; then
  echo "Unexpected bundle identifier: $bundle_id" >&2
  exit 1
fi

echo "DMG smoke passed: $dmg_path"
