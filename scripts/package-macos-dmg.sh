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
    CODE_SIGNING_ALLOWED="${CODE_SIGNING_ALLOWED:-NO}" \
    "$@" \
    build
)

APP_PATH="$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION/$APP_BUNDLE_NAME"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected app bundle not found: $APP_PATH" >&2
  exit 1
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

echo "$DMG_PATH"
