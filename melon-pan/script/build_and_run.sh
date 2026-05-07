#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="MelonPan"
BUNDLE_ID="com.gongahkia.MelonPan"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAC_APP_DIR="$ROOT_DIR/apps/macos/melon-pan-mac"
DERIVED_DATA="$MAC_APP_DIR/Build/DerivedData"
APP_BUNDLE="$DERIVED_DATA/Build/Products/Debug/$APP_NAME.app"
APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/$APP_NAME"
STALE_APP_BUNDLE="$MAC_APP_DIR/.build/Build/Products/Debug/$APP_NAME.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister"

detect_signing_identity() {
  local line identity team
  line="$(security find-identity -p codesigning -v 2>/dev/null | grep 'Apple Development:' | head -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  identity="$(sed -E 's/^[[:space:]]*[0-9]+\) [A-F0-9]+ "([^"]+)".*$/\1/' <<<"$line")"
  team="$(sed -nE 's/.*\(([A-Z0-9]{10})\)".*/\1/p' <<<"$line")"
  if [[ -z "$identity" || -z "$team" ]]; then
    return 1
  fi
  printf '%s\n%s\n' "$identity" "$team"
}

stop_existing_app() {
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
}

unregister_stale_app_bundles() {
  local bundle
  while IFS= read -r bundle; do
    [[ -z "$bundle" ]] && continue
    if [[ "$bundle" != "$APP_BUNDLE" ]]; then
      "$LSREGISTER" -u "$bundle" >/dev/null 2>&1 || true
    fi
  done < <(
    {
      mdfind 'kMDItemFSName == "MelonPan.app"' 2>/dev/null || true
      find "$MAC_APP_DIR" "$HOME/Library/Developer/Xcode/DerivedData"/MelonPan-* \
        -path "*/$APP_NAME.app" -type d 2>/dev/null || true
    } | awk '!seen[$0]++'
  )
}

build_app() {
  echo "==> Building $APP_NAME Debug app"
  xcodebuild \
    -project "$MAC_APP_DIR/MelonPan.xcodeproj" \
    -scheme "$APP_NAME" \
    -configuration Debug \
    -destination platform=macOS \
    -derivedDataPath "$DERIVED_DATA" \
    build
  stable_sign_app
}

stable_sign_app() {
  local signing_text identity
  if ! signing_text="$(detect_signing_identity)"; then
    echo "==> No Apple Development signing identity found; keeping Xcode's ad-hoc signature"
    return 0
  fi
  identity="$(printf '%s\n' "$signing_text" | sed -n '1p')"
  echo "==> Re-signing debug app with $identity"
  codesign --force --deep \
    --sign "$identity" \
    --entitlements "$MAC_APP_DIR/MelonPan/MelonPan.entitlements" \
    --timestamp=none \
    "$APP_BUNDLE"
}

open_app() {
  echo "==> Opening $APP_BUNDLE"
  unregister_stale_app_bundles
  "$LSREGISTER" -f -R -trusted "$APP_BUNDLE" >/dev/null 2>&1 || true
  /usr/bin/open -n "$APP_BUNDLE"
}

stop_existing_app
build_app

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_EXECUTABLE"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 2
    pgrep -x "$APP_NAME" >/dev/null
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
