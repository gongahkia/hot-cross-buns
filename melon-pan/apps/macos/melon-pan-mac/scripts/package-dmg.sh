#!/usr/bin/env bash
# Builds an unsigned MelonPan.dmg from a release Xcode build.
#
# Pipeline:
#   1. scripts/build-rust-staticlib.sh release  (universal staticlib + editor.js)
#   2. xcodebuild -configuration Release         (.app bundle)
#   3. Stage the .app + an Applications symlink in a temp dir.
#   4. hdiutil create -format UDZO              (compressed DMG).
#
# The resulting DMG is *unsigned*. Hand-sign by running:
#   codesign --options=runtime \
#            --entitlements MelonPan/MelonPan.entitlements \
#            --sign "Developer ID Application: YOUR NAME" \
#            "<dmg-mount>/MelonPan.app"
#   xcrun notarytool submit MelonPan.dmg --wait \
#         --apple-id ... --team-id ... --password ...
#   xcrun stapler staple MelonPan.dmg
#
# Sparkle is intentionally not wired — distribution is "download a
# fresh DMG from GitHub Releases" because the user opted out of the
# Sparkle signing dance. The in-app updater (Settings → Updates) is
# the discovery path; the DMG is the install path.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$project_dir/../../.." && pwd)"
out_dir="$project_dir/dist"
mkdir -p "$out_dir"

version="${MELON_PAN_VERSION:-$(grep -E '^\s*CFBundleShortVersionString:' \
    "$project_dir/project.yml" | sed -E 's/.*: *"?([0-9.]+)"? *$/\1/' \
    | head -1 || echo 0.1.0)}"
dmg_name="MelonPan-${version}.dmg"
dmg_path="$out_dir/$dmg_name"

echo "==> Building universal staticlib + editor bundle"
"$script_dir/build-rust-staticlib.sh" release

echo "==> Regenerating Xcode project"
(cd "$project_dir" && xcodegen generate)

echo "==> xcodebuild -configuration Release"
build_dir="$(mktemp -d -t melonpan-dmg)"
trap "rm -rf '$build_dir'" EXIT
xcodebuild \
    -project "$project_dir/MelonPan.xcodeproj" \
    -scheme MelonPan \
    -configuration Release \
    -derivedDataPath "$build_dir/DerivedData" \
    SYMROOT="$build_dir/build" \
    > "$build_dir/xcodebuild.log" 2>&1 \
    || (tail -40 "$build_dir/xcodebuild.log"; exit 1)

app_path="$build_dir/build/Release/MelonPan.app"
if [[ ! -d "$app_path" ]]; then
    echo "ERROR: expected $app_path after xcodebuild but it does not exist."
    exit 1
fi

echo "==> Staging DMG payload"
stage="$build_dir/stage"
mkdir -p "$stage"
cp -R "$app_path" "$stage/MelonPan.app"
ln -s /Applications "$stage/Applications"

echo "==> Building DMG (unsigned)"
rm -f "$dmg_path"
hdiutil create \
    -srcfolder "$stage" \
    -volname "Melon Pan ${version}" \
    -fs HFS+ \
    -format UDZO \
    -imagekey zlib-level=9 \
    "$dmg_path" \
    > "$build_dir/hdiutil.log" 2>&1 \
    || (cat "$build_dir/hdiutil.log"; exit 1)

echo
echo "Built $dmg_path"
ls -lh "$dmg_path" | awk '{ print "Size:    " $5 }'
echo "Status:  unsigned"
echo
echo "Sign it via:"
echo "  codesign --options=runtime \\"
echo "           --entitlements $project_dir/MelonPan/MelonPan.entitlements \\"
echo "           --sign 'Developer ID Application: ...' \\"
echo "           '<dmg-mount>/MelonPan.app'"
echo "  xcrun notarytool submit '$dmg_path' --wait \\"
echo "        --apple-id ... --team-id ... --password ..."
echo "  xcrun stapler staple '$dmg_path'"
