#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/install-mac-preview.sh <artifact.dmg|artifact.zip> [SHASUMS256.txt] [destination]

Verifies the artifact SHA-256 against SHASUMS256.txt, then copies the contained
Hot Cross Buns.app to the destination. The default destination is /Applications.

This helper is for unsigned macOS preview artifacts only. It does not sign,
notarize, bypass Gatekeeper, or enable automatic updates.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

artifact="${1:-}"
checksums="${2:-SHASUMS256.txt}"
destination="${3:-/Applications}"

if [[ -z "$artifact" ]]; then
  usage >&2
  exit 2
fi

if [[ ! -f "$artifact" ]]; then
  echo "Artifact not found: $artifact" >&2
  exit 1
fi

if [[ ! -f "$checksums" ]]; then
  echo "Checksum file not found: $checksums" >&2
  exit 1
fi

if ! command -v shasum >/dev/null 2>&1; then
  echo "shasum is required to verify preview artifacts." >&2
  exit 1
fi

artifact_name="$(basename "$artifact")"
expected_sha="$(
  awk -v file="$artifact_name" '$2 == file { print $1; found = 1 } END { exit found ? 0 : 1 }' "$checksums" || true
)"

if [[ -z "$expected_sha" ]]; then
  echo "No checksum entry for $artifact_name in $checksums" >&2
  exit 1
fi

actual_sha="$(shasum -a 256 "$artifact" | awk '{ print $1 }')"

if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "Checksum mismatch for $artifact_name" >&2
  echo "Expected: $expected_sha" >&2
  echo "Actual:   $actual_sha" >&2
  exit 1
fi

echo "Checksum verified for $artifact_name"
echo "Installing unsigned preview app. macOS may require Finder > Control-click > Open on first launch."

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/hcb-install.XXXXXX")"
mount_point=""

cleanup() {
  if [[ -n "$mount_point" ]]; then
    hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

case "$artifact" in
  *.dmg)
    if ! command -v hdiutil >/dev/null 2>&1; then
      echo "hdiutil is required to install DMG preview artifacts." >&2
      exit 1
    fi

    attach_output="$(hdiutil attach "$artifact" -nobrowse -readonly)"
    mount_point="$(printf '%s\n' "$attach_output" | sed -n 's|^/dev/.*[[:space:]]\(/Volumes/.*\)$|\1|p' | tail -n 1)"

    if [[ -z "$mount_point" || ! -d "$mount_point" ]]; then
      echo "Unable to locate mounted DMG volume." >&2
      exit 1
    fi

    app_path="$(find "$mount_point" -maxdepth 2 -name "*.app" -type d -print -quit)"
    ;;
  *.zip)
    if ! command -v unzip >/dev/null 2>&1; then
      echo "unzip is required to install zip preview artifacts." >&2
      exit 1
    fi

    unzip -q "$artifact" -d "$tmp_dir"
    app_path="$(find "$tmp_dir" -maxdepth 4 -name "*.app" -type d -print -quit)"
    ;;
  *)
    echo "Unsupported artifact type. Expected .dmg or .zip." >&2
    exit 1
    ;;
esac

if [[ -z "${app_path:-}" || ! -d "$app_path" ]]; then
  echo "No .app bundle found in $artifact_name" >&2
  exit 1
fi

mkdir -p "$destination"
target_path="$destination/$(basename "$app_path")"
rm -rf "$target_path"
ditto "$app_path" "$target_path"

echo "Installed $(basename "$app_path") to $destination"
echo "This preview remains unsigned and unnotarized. Do not disable Gatekeeper."
