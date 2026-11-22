#!/bin/bash
set -euo pipefail
native_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$native_root/.." && pwd)"
native_scratch="${HOT_CROSS_BUNS_NATIVE_BUILD_DIR:-/tmp/hot-cross-buns-native-build}"
native_destination="${HOT_CROSS_BUNS_NATIVE_APP_PATH:-/tmp/HotCrossBuns-Native.app}"
native_stage="$(mktemp -d /tmp/hot-cross-buns-native-app.XXXXXX)"
trap 'rm -rf "$native_stage"' EXIT
swift build --package-path "$native_root" --scratch-path "$native_scratch"
native_bin="$(swift build --package-path "$native_root" --scratch-path "$native_scratch" --show-bin-path)"
mkdir -p "$native_stage/HotCrossBuns.app/Contents/MacOS" "$native_stage/HotCrossBuns.app/Contents/Resources"
cp "$native_bin/HotCrossBunsMac" "$native_stage/HotCrossBuns.app/Contents/MacOS/HotCrossBunsMac"
cp "$native_root/Resources/Info.plist" "$native_stage/HotCrossBuns.app/Contents/Info.plist"
cp -R "$native_root/Resources/Presence" "$native_stage/HotCrossBuns.app/Contents/Resources/Presence"
swift "$native_root/scripts/make-app-icon.swift" "$native_stage/AppIcon.iconset"
cp "$native_stage/HotCrossBunsHead.png" "$native_stage/HotCrossBunsMenuBar.png" "$native_stage/HotCrossBuns.app/Contents/Resources/"
/usr/bin/iconutil -c icns "$native_stage/AppIcon.iconset" -o "$native_stage/HotCrossBuns.app/Contents/Resources/AppIcon.icns"
(cd "$repo_root" && go build -trimpath -o "$native_stage/HotCrossBuns.app/Contents/Resources/hot-cross-buns-runtime" ./cmd/hot-cross-buns)
chmod 755 "$native_stage/HotCrossBuns.app/Contents/MacOS/HotCrossBunsMac" "$native_stage/HotCrossBuns.app/Contents/Resources/hot-cross-buns-runtime"
plutil -lint "$native_stage/HotCrossBuns.app/Contents/Info.plist"
if [ -e "$native_destination" ]; then
  echo "Destination already exists: $native_destination. Choose a fresh HOT_CROSS_BUNS_NATIVE_APP_PATH." >&2
  exit 1
fi
mv "$native_stage/HotCrossBuns.app" "$native_destination"
echo "Built $native_destination"
echo "Launch: open '$native_destination'"
