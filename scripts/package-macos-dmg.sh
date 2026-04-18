#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPLE_DIR="$ROOT_DIR/apps/apple"
BUILD_ROOT="${BUILD_ROOT:-$ROOT_DIR/build/apple}"
DERIVED_DATA_PATH="$BUILD_ROOT/DerivedData"
DMG_ROOT="$BUILD_ROOT/dmg-root"
CONFIGURATION="${CONFIGURATION:-Release}"
SCHEME="${SCHEME:-HotCrossBunsMac}"
APP_BUNDLE_NAME="${APP_BUNDLE_NAME:-HotCrossBunsMac.app}"
VOLUME_NAME="${VOLUME_NAME:-Hot Cross Buns}"
VERSION="${VERSION:-$(git -C "$ROOT_DIR" describe --tags --always --dirty 2>/dev/null || echo dev)}"
DMG_PATH="$BUILD_ROOT/HotCrossBuns-$VERSION-macOS.dmg"
CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:-}"
NOTARIZE="${NOTARIZE:-0}"

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

APP_PATH="$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION/$APP_BUNDLE_NAME"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected app bundle not found: $APP_PATH" >&2
  exit 1
fi

if [[ -n "$CODE_SIGN_IDENTITY" ]]; then
  codesign \
    --force \
    --deep \
    --options runtime \
    --timestamp \
    --sign "$CODE_SIGN_IDENTITY" \
    "$APP_PATH"
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
