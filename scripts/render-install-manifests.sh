#!/usr/bin/env bash
set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

validate_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || fail 'version must be semantic-version-shaped without a leading v'
}

validate_sha256() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]] || fail 'checksums must be lowercase SHA-256 hex'
}

[[ $# -eq 4 ]] || {
  printf 'usage: %s <version> <source-sha256> <windows-sha256> <output-directory>\n' "${0##*/}" >&2
  exit 2
}
readonly version="$1"
readonly source_sha256="$2"
readonly windows_sha256="$3"
readonly output_directory="$4"
validate_version "$version"
validate_sha256 "$source_sha256"
validate_sha256 "$windows_sha256"
mkdir -p "$output_directory/homebrew" "$output_directory/scoop"

sed \
  -e "s/@VERSION@/$version/g" \
  -e "s/@SOURCE_SHA256@/$source_sha256/g" \
  "$repository_root/packaging/homebrew/wukong.rb.in" > "$output_directory/homebrew/wukong.rb"
sed \
  -e "s/@VERSION@/$version/g" \
  -e "s/@WINDOWS_SHA256@/$windows_sha256/g" \
  "$repository_root/packaging/scoop/wukong.json.in" > "$output_directory/scoop/wukong.json"
