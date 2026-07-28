#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 2
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

[[ $# -eq 1 ]] || { printf 'usage: %s <release-directory>\n' "${0##*/}" >&2; exit 2; }
readonly release_directory="$1"
[[ -d "$release_directory" ]] || fail "release directory does not exist: $release_directory"
assets="$(find "$release_directory" -maxdepth 1 -type f -name 'wukong-*.zip' -print | LC_ALL=C sort)"
[[ -n "$assets" ]] || fail 'release directory contains no Wukong ZIP assets'
temporary="$release_directory/.SHA256SUMS.tmp"
while IFS= read -r asset; do
  (
    cd "$release_directory"
    checksum "${asset##*/}"
  )
done <<< "$assets" > "$temporary"
mv "$temporary" "$release_directory/SHA256SUMS"
