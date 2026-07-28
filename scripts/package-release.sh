#!/usr/bin/env bash
set -euo pipefail

readonly TOOLCHAIN='1.85.0'

usage() {
  printf 'usage: %s <version> <target> <output-directory>\n' "${0##*/}" >&2
}

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

validate_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || fail 'version must be semantic-version-shaped without a leading v'
}

checksum() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    fail 'shasum or sha256sum is required'
  fi
}

[[ $# -eq 3 ]] || { usage; exit 2; }
readonly version="$1"
readonly target="$2"
readonly output_directory="$3"
validate_version "$version"
case "$target" in
  aarch64-apple-darwin|x86_64-apple-darwin|x86_64-unknown-linux-gnu|x86_64-pc-windows-gnu) ;;
  *) fail "unsupported release target: $target" ;;
esac
command -v zip >/dev/null 2>&1 || fail 'zip is required'

readonly binary_name=$([[ "$target" == *windows* ]] && printf 'wukong.exe' || printf 'wukong')
readonly target_directory="${CARGO_TARGET_DIR:-target}"
readonly binary_path="$target_directory/$target/release/$binary_name"
readonly archive_name="wukong-$version-$target.zip"
mkdir -p "$output_directory"
readonly archive_path="$(cd "$output_directory" && pwd)/$archive_name"

cargo +"$TOOLCHAIN" build --locked --release --package wukong-cli --target "$target"
[[ -x "$binary_path" || -f "$binary_path" ]] || fail "release binary was not produced: $binary_path"
[[ "$("$binary_path" --version)" == "wukong $version" ]] || fail 'binary version does not match the requested release version'

stage_directory="$(mktemp -d)"
trap 'rm -rf "$stage_directory"' EXIT
cp "$binary_path" "$stage_directory/$binary_name"
if [[ "$target" != *windows* ]]; then
  chmod 755 "$stage_directory/$binary_name"
fi
touch -t 198001010000 "$stage_directory/$binary_name"
(
  cd "$stage_directory"
  zip -X -q "$archive_path" "$binary_name"
)
(
  cd "$output_directory"
  checksum "$archive_name"
) > "$output_directory/$archive_name.sha256"

printf '%s\n' "$output_directory/$archive_name"
