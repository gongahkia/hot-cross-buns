# ADR 0037: release artifact layout

## Status

Accepted

## Context and constraints

Wukong needs directly downloadable command-line binaries for macOS, Linux, and
Windows, without publishing credentials or mutable identities. Installation
metadata must be generated from exact release artifacts and checksums. The
repository currently has no authority to publish releases, taps, buckets, or
crates.

## Decision

Package one architecture-specific ZIP asset per supported Rust target:

```text
wukong-<version>-aarch64-apple-darwin.zip
wukong-<version>-x86_64-apple-darwin.zip
wukong-<version>-x86_64-unknown-linux-gnu.zip
wukong-<version>-x86_64-pc-windows-gnu.zip
```

Every asset contains only `wukong` or `wukong.exe`, has a sibling SHA-256 file,
and is listed in a lexically ordered `SHA256SUMS`. `scripts/package-release.sh`
builds, checks the embedded CLI version, normalises the ZIP entry timestamp,
and writes the per-asset checksum. `scripts/write-release-checksums.sh` creates
the aggregate checksum file after all native artifacts are collected.

The Homebrew formula template builds the immutable tag source archive with
Rust; it therefore verifies that source archive's SHA-256. The Scoop template
uses the immutable Windows ZIP asset and its SHA-256. Both are rendered only
after the relevant final checksums exist.

## Consequences and alternatives considered

Architecture-specific macOS artifacts avoid a cross-linking requirement for a
universal binary. Prebuilt Homebrew formulae were rejected: Homebrew core
requires formulae to build from source or install platform-independent output.
Scoop is retained for the native Windows archive. No installer runs package
scripts or stores credentials.

## Migration and compatibility impact

No manifest, lockfile, cache, or project state format changes. The release
operator must update the workspace package version before packaging, publish
`wukong-core` before a crates.io `wukong-cli` package, and publish exact
versioned assets before distributing generated install manifests.
