#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPLE_DIR="$ROOT_DIR/apps/apple"
BUILD_ROOT="${BUILD_ROOT:-$ROOT_DIR/build/apple}"
DERIVED_DATA_PATH="$BUILD_ROOT/DerivedData"
DMG_ROOT="$BUILD_ROOT/dmg-root"
CONFIGURATION="${CONFIGURATION:-Release}"
SCHEME="${SCHEME:-HotCrossBunsMac}"
APP_BUNDLE_NAME="${APP_BUNDLE_NAME:-Hot Cross Buns.app}"
VOLUME_NAME="${VOLUME_NAME:-Hot Cross Buns}"
VERSION="${VERSION:-$(git -C "$ROOT_DIR" describe --tags --always --dirty 2>/dev/null || echo dev)}"
DMG_PATH="$BUILD_ROOT/HotCrossBuns-$VERSION-macOS.dmg"
ENTITLEMENTS_PATH="$APPLE_DIR/HotCrossBuns/Support/HotCrossBuns.entitlements"
CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:-}"
NOTARIZE="${NOTARIZE:-0}"
PLIST_BUDDY="/usr/libexec/PlistBuddy"

if [[ -n "$CODE_SIGN_IDENTITY" && -z "${CODE_SIGNING_ALLOWED+x}" ]]; then
  CODE_SIGNING_ALLOWED=YES
else
  CODE_SIGNING_ALLOWED="${CODE_SIGNING_ALLOWED:-NO}"
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required. Install it with: brew install xcodegen" >&2
  exit 1
fi

mkdir -p "$BUILD_ROOT"

(
  cd "$APPLE_DIR"
  xcodegen generate
  xcodebuild \
    -project HotCrossBuns.xcodeproj \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination 'platform=macOS' \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    CODE_SIGNING_ALLOWED="$CODE_SIGNING_ALLOWED" \
    "$@" \
    build
)

resolve_app_path() {
  local products_dir="$1"
  local requested_path="$products_dir/$APP_BUNDLE_NAME"
  local candidates=()
  local candidate

  if [[ -d "$requested_path" ]]; then
    printf '%s\n' "$requested_path"
    return 0
  fi

  while IFS= read -r -d '' candidate; do
    candidates+=("$candidate")
  done < <(find "$products_dir" -maxdepth 1 -type d -name '*.app' -print0 | sort -z)

  case "${#candidates[@]}" in
    0)
      echo "Expected app bundle not found: $requested_path" >&2
      return 1
      ;;
    1)
      printf '%s\n' "${candidates[0]}"
      return 0
      ;;
    *)
      echo "Expected app bundle not found: $requested_path" >&2
      echo "Found multiple app bundles in $products_dir:" >&2
      printf '  %s\n' "${candidates[@]}" >&2
      return 1
      ;;
  esac
}

plist_value() {
  local plist_path="$1"
  local key="$2"
  "$PLIST_BUDDY" -c "Print :$key" "$plist_path" 2>/dev/null || true
}

is_missing_release_value() {
  local value="$1"
  local placeholder="$2"
  local trimmed="${value#"${value%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"

  if [[ -z "$trimmed" ]]; then
    return 0
  fi

  if [[ "$trimmed" == '$('* ]]; then
    return 0
  fi

  if [[ -n "$placeholder" && "$trimmed" == "$placeholder" ]]; then
    return 0
  fi

  return 1
}

check_release_preflight() {
  local app_path="$1"
  local info_plist="$app_path/Contents/Info.plist"
  local release_failures=()
  local release_warnings=()
  local client_id
  local require_google_oauth="${REQUIRE_GOOGLE_OAUTH_FOR_RELEASE:-0}"

  if [[ ! -f "$info_plist" ]]; then
    echo "Release preflight failed: missing app Info.plist at $info_plist" >&2
    exit 1
  fi

  client_id="$(plist_value "$info_plist" "GIDClientID")"

  if is_missing_release_value "$client_id" "your-macos-oauth-client-id.apps.googleusercontent.com"; then
    if [[ "$require_google_oauth" == "1" ]]; then
      release_failures+=("Google OAuth client ID is missing or unresolved in the built app")
    else
      release_warnings+=("Embedded Google OAuth client ID is missing or unresolved; runtime Desktop OAuth setup will still work")
    fi
  fi

  if [[ "${#release_warnings[@]}" -gt 0 ]]; then
    echo "Release preflight warnings:" >&2
    printf '  - %s\n' "${release_warnings[@]}" >&2
  fi

  if [[ "${#release_failures[@]}" -eq 0 ]]; then
    return 0
  fi

  echo "Release preflight found missing distribution configuration:" >&2
  printf '  - %s\n' "${release_failures[@]}" >&2

  if [[ "$require_google_oauth" == "1" ]]; then
    echo "Refusing to package a tag release until Google OAuth credentials are embedded." >&2
    exit 1
  fi

  echo "Continuing because runtime Desktop OAuth setup does not require embedded OAuth credentials." >&2
}

APP_PATH="$(resolve_app_path "$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION")"
check_release_preflight "$APP_PATH"

if [[ -n "$CODE_SIGN_IDENTITY" ]]; then
  codesign \
    --force \
    --deep \
    --options runtime \
    --timestamp \
    --entitlements "$ENTITLEMENTS_PATH" \
    --sign "$CODE_SIGN_IDENTITY" \
    "$APP_PATH"

  spctl --assess --type execute --verbose=2 "$APP_PATH" || {
    echo "Gatekeeper assessment failed for $APP_PATH" >&2
    exit 1
  }
fi

rm -rf "$DMG_ROOT" "$DMG_PATH"
mkdir -p "$DMG_ROOT"
cp -R "$APP_PATH" "$DMG_ROOT/"
ln -s /Applications "$DMG_ROOT/Applications"

hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$DMG_ROOT" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

if [[ -n "$CODE_SIGN_IDENTITY" ]]; then
  codesign \
    --force \
    --timestamp \
    --sign "$CODE_SIGN_IDENTITY" \
    "$DMG_PATH"
fi

if [[ "$NOTARIZE" == "1" ]]; then
  : "${APPLE_ID:?APPLE_ID is required when NOTARIZE=1}"
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required when NOTARIZE=1}"
  : "${APP_SPECIFIC_PASSWORD:?APP_SPECIFIC_PASSWORD is required when NOTARIZE=1}"

  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APP_SPECIFIC_PASSWORD" \
    --wait
  xcrun stapler staple "$DMG_PATH"
fi

echo "$DMG_PATH"
