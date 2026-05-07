#!/usr/bin/env bash
# Build the universal libmelon_pan_mac_ffi.a + copy the bridging
# header into MelonPan/Build/ where the xcodegen-generated project
# expects it. Idempotent; safe to run before every Xcode build.
#
# Usage: scripts/build-rust-staticlib.sh [debug|release]
set -euo pipefail

profile_arg="$(printf '%s' "${1:-release}" | tr '[:upper:]' '[:lower:]')"
case "$profile_arg" in
    debug)
        profile="debug"
        ;;
    release)
        profile="release"
        ;;
    *)
        echo "usage: $0 [debug|release]" >&2
        exit 2
        ;;
esac
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$project_dir/../../.." && pwd)"
build_dir="$project_dir/MelonPan/Build"

mkdir -p "$build_dir"

cargo_flags=()
if [[ "$profile" == "release" ]]; then
    cargo_flags=(--release)
fi

build_for_target() {
    local target="$1"
    echo "==> Building melon-pan-mac-ffi for $target ($profile)"
    rustup target add "$target" >/dev/null 2>&1 || true
    (cd "$repo_root" && MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-13.0}" cargo build "${cargo_flags[@]+"${cargo_flags[@]}"}" \
        --target "$target" -p melon-pan-mac-ffi)
}

build_for_target aarch64-apple-darwin
build_for_target x86_64-apple-darwin

echo "==> Lipo-ing universal staticlib"
lipo -create \
    "$repo_root/target/aarch64-apple-darwin/$profile/libmelon_pan_mac_ffi.a" \
    "$repo_root/target/x86_64-apple-darwin/$profile/libmelon_pan_mac_ffi.a" \
    -output "$build_dir/libmelon_pan_mac_ffi.a"

echo "==> Copying bridging header"
cp "$repo_root/crates/melon-pan-mac-ffi/include/melon_pan_mac_ffi.h" \
    "$build_dir/melon_pan_mac_ffi.h"

echo "Built $build_dir/libmelon_pan_mac_ffi.a"
echo "Bridging header at $build_dir/melon_pan_mac_ffi.h"
