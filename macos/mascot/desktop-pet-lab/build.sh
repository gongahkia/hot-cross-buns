#!/bin/bash
set -euo pipefail
pet_root="$(cd "$(dirname "$0")" && pwd)"
macos_root="$(cd "$pet_root/../.." && pwd)"
pet_app="${HOT_CROSS_BUNS_PET_LAB_APP:-/tmp/HotCrossBuns-Mascot-P04M-B1-Desktop-Pet-Lab.app}"
if [[ -e "$pet_app" ]]; then echo 'Choose a fresh isolated app path.' >&2; exit 1; fi
mkdir -p "$pet_app/Contents/MacOS" "$pet_app/Contents/Resources"
swiftc -parse-as-library -swift-version 6 -strict-concurrency=complete -warnings-as-errors -O -target "$(uname -m)-apple-macosx15.0" \
 "$macos_root/Sources/HotCrossBunsMac/NativeMascotModel.swift" "$macos_root/Sources/HotCrossBunsMac/NativeMascotPlayback.swift" \
 "$pet_root/Geometry.swift" "$pet_root/Screens.swift" "$pet_root/Panel.swift" "$pet_root/Lab.swift" -o "$pet_app/Contents/MacOS/PetLab"
cp -R "$macos_root/mascot/2d/assets" "$pet_app/Contents/Resources/Mascot"
cp /tmp/HotCrossBuns-Native-P04M-2D.app/Contents/Resources/HotCrossBunsMenuBar.png "$pet_app/Contents/Resources/"
cat > "$pet_app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.hot-cross-buns.pet.b1.lab</string>
<key>CFBundleName</key><string>Hot Cross Buns Pet Lab</string>
<key>CFBundleExecutable</key><string>PetLab</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>15.0</string>
<key>NSPrincipalClass</key><string>HotCrossBunsPetLabApplication</string>
</dict></plist>
PLIST
plutil -lint "$pet_app/Contents/Info.plist"
echo "Built $pet_app"
