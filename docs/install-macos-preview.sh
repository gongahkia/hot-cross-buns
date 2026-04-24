#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="${REPO_OWNER:-gongahkia}"
REPO_NAME="${REPO_NAME:-hot-cross-buns}"
ASSET_NAME="${ASSET_NAME:-HotCrossBuns-macOS.dmg}"
APP_NAME="${APP_NAME:-Hot Cross Buns.app}"
DOWNLOAD_URL="${DOWNLOAD_URL:-https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/${ASSET_NAME}}"
DOWNLOAD_SHA256_URL="${DOWNLOAD_SHA256_URL:-${DOWNLOAD_URL}.sha256}"
INSTALL_DIR_OVERRIDE="${INSTALL_DIR:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

choose_install_dir() {
  if [[ -n "$INSTALL_DIR_OVERRIDE" ]]; then
    mkdir -p "$INSTALL_DIR_OVERRIDE"
    printf '%s\n' "$INSTALL_DIR_OVERRIDE"
    return 0
  fi

  if [[ -d "/Applications" && -w "/Applications" ]]; then
    printf '%s\n' "/Applications"
    return 0
  fi

  mkdir -p "$HOME/Applications"
  printf '%s\n' "$HOME/Applications"
}

cleanup() {
  if [[ -n "${MOUNT_POINT:-}" && -d "${MOUNT_POINT:-}" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 || true
  fi
  if [[ -n "${TMP_DIR:-}" && -d "${TMP_DIR:-}" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

resolve_app_source() {
  local requested_path="$1"
  local candidates=()
  local candidate

  if [[ -d "$requested_path" ]]; then
    printf '%s\n' "$requested_path"
    return 0
  fi

  while IFS= read -r -d '' candidate; do
    candidates+=("$candidate")
  done < <(find "$MOUNT_POINT" -maxdepth 1 -type d -name '*.app' -print0 | sort -z)

  case "${#candidates[@]}" in
    1)
      printf '%s\n' "${candidates[0]}"
      ;;
    0)
      echo "App bundle not found inside DMG: $requested_path" >&2
      return 1
      ;;
    *)
      echo "Multiple app bundles found inside DMG; refusing to guess." >&2
      printf '  %s\n' "${candidates[@]}" >&2
      return 1
      ;;
  esac
}

require_command curl
require_command ditto
require_command hdiutil
require_command sed
require_command shasum

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hot-cross-buns-install.XXXXXX")"
MOUNT_POINT=""
trap cleanup EXIT

INSTALL_DIR="$(choose_install_dir)"
TARGET_PATH="$INSTALL_DIR/$APP_NAME"
DMG_PATH="$TMP_DIR/$ASSET_NAME"
SHA256_PATH="$TMP_DIR/${ASSET_NAME}.sha256"

echo "Downloading latest preview DMG..."
curl -fL "$DOWNLOAD_URL" -o "$DMG_PATH"
curl -fL "$DOWNLOAD_SHA256_URL" -o "$SHA256_PATH"

echo "Verifying SHA-256 checksum..."
EXPECTED_SHA="$(sed -E 's/[[:space:]].*$//' "$SHA256_PATH" | tr -d '\r\n')"
if [[ -z "$EXPECTED_SHA" ]]; then
  echo "Checksum file did not contain a SHA-256 digest." >&2
  exit 1
fi

ACTUAL_SHA="$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
if [[ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
  echo "Checksum mismatch for downloaded DMG." >&2
  echo "Expected: $EXPECTED_SHA" >&2
  echo "Actual:   $ACTUAL_SHA" >&2
  exit 1
fi

echo "Mounting DMG..."
ATTACH_OUTPUT="$(hdiutil attach "$DMG_PATH" -nobrowse)"
MOUNT_POINT="$(printf '%s\n' "$ATTACH_OUTPUT" | sed -n $'s/^.*\t//p' | tail -n 1)"

if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
  echo "Failed to locate mounted DMG volume." >&2
  exit 1
fi

APP_SOURCE="$(resolve_app_source "$MOUNT_POINT/$APP_NAME")"
TARGET_PATH="$INSTALL_DIR/$(basename "$APP_SOURCE")"

if [[ -e "$TARGET_PATH" ]]; then
  rm -rf "$TARGET_PATH"
fi

echo "Installing to $INSTALL_DIR..."
ditto "$APP_SOURCE" "$TARGET_PATH"

echo "Installed $(basename "$TARGET_PATH") to $TARGET_PATH"
echo "This preview build is unsigned."
echo "If macOS blocks the first launch, open the app once, then use System Settings > Privacy & Security > Open Anyway."
