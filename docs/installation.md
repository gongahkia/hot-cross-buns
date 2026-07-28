# Installation

No public Wukong release is published yet. The commands below describe the
versioned artifacts prepared for the first release; verify every downloaded
asset against its published `SHA256SUMS` before executing it.

## Direct binary

Download the ZIP matching the operating system and architecture from the exact
GitHub release tag, verify its SHA-256 line, extract it, and place `wukong` (or
`wukong.exe`) on `PATH`. macOS artifacts are separate `aarch64` and `x86_64`
builds; Linux and Windows currently use `x86_64` builds.

```text
wukong-<version>-aarch64-apple-darwin.zip
wukong-<version>-x86_64-apple-darwin.zip
wukong-<version>-x86_64-unknown-linux-gnu.zip
wukong-<version>-x86_64-pc-windows-gnu.zip
```

Confirm the installed artifact with:

```sh
wukong --version
```

## Homebrew

The release process renders a source-building formula from the immutable tag
archive and its SHA-256. Once its tap is published, install with the exact tap
and formula name stated in that release; do not install an unverified copied
formula.

## Scoop

The release process renders a Scoop manifest that pins the Windows ZIP URL and
its SHA-256. Once its bucket is published, add only the bucket URL stated in
the release and install `wukong` from that manifest.

## Cargo

Before a crates.io package exists, install the exact source tag instead of a
branch:

```sh
cargo install --git https://github.com/gongahkia/wukong.git --tag v<version> --path crates/wukong-cli
```

For a local checkout, use `cargo install --path crates/wukong-cli`. Never use a
mutable branch as a release identity. A future crates.io release must publish
`wukong-core` before the matching `wukong-cli` package.

## Release operator workflow

Run the packaging script natively for each listed target. It refuses a binary
whose embedded `wukong --version` does not match the requested version. Collect
all ZIP assets into one directory, run `scripts/write-release-checksums.sh`,
then render the Homebrew and Scoop files with
`scripts/render-install-manifests.sh`. Publish the artifacts, `SHA256SUMS`, and
the rendered manifests together.

See [ADR 0037](adr/0037-release-artifact-layout.md).
