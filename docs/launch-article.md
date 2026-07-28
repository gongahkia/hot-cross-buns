# Wukong: reproducible Godot addon state

> Draft for publication. This document is not a release announcement and does
> not claim a public `0.1.0` release.

Godot addon installation often begins with a ZIP archive, a copied `addons/`
directory, or a Git checkout. Godot's own plugin guide describes downloading a
ZIP and moving its `addons/` content into a project; the AssetLib installer
also downloads an archive and lets the user select files to install. Those are
useful workflows, but neither is a project-level, immutable record of the
complete desired addon state. [Godot's plugin guide](https://docs.godotengine.org/en/stable/tutorials/plugins/editor/installing_plugins.html)
and [AssetLib guide](https://docs.godotengine.org/en/stable/community/asset_library/using_assetlib.html)
describe those installation paths.

Wukong is a Rust dependency manager for Godot 4 addons. Its purpose is not to
replace the editor or a source host. Its purpose is to make this statement
true: given the same manifest, lockfile, and source content, `wukong sync`
produces the same addon state without changing unrelated project files.

## Reproducibility is the product

`wukong.toml` declares direct local-path, Git, and HTTPS archive sources.
`wukong.lock` records the resulting immutable source identity, selected source
directory, target path, declaration fingerprint, and prepared-tree SHA-256.
Git tags and branches are convenient inputs, but the lock records a complete
commit; HTTPS archives require a checksum. A changed declaration, source, or
selected package tree cannot silently reuse an old lock.

This makes a clone-and-sync workflow reviewable. The manifest says what a
project asks for. The lock says what it resolved to. The installed-state file
records only files Wukong owns. Re-running a successful sync is a no-op.

## Resolver and source boundaries

The core library keeps source adapters behind a source-neutral contract. A
resolver consumes immutable candidate metadata rather than Git or HTTP fields;
it selects a deterministic compatible graph and has no filesystem side
effects. Source acquisition, package preparation, and materialisation happen
only after resolution.

Direct sources can select `root` and `target` explicitly. That matters for a
repository that contains several addons: each declaration can lock one safe
subdirectory and target without inventing a new source identity. The chosen
paths are part of the declaration fingerprint and persisted lock state.

## Canonical trees and a content-addressed cache

Before installation, Wukong prepares the selected addon into a canonical tree.
The tree hash covers sorted paths, entry kinds, normalised executable bits, and
file content. Source-control metadata is excluded; unsafe paths, symlinks,
special files, non-UTF-8 names, and normalisation collisions are rejected.

Verified artifacts and prepared trees live in a content-addressed cache.
Immutable Git checkouts, checksummed archives, and package trees can therefore
be reused offline. Cache publication is staged and verified before it becomes
visible to another process.

## Installation is a transaction

Wukong computes the desired ownership map before it mutates the Godot project.
It detects package conflicts and project-owned file conflicts, stages files,
verifies them, commits the new state, writes metadata, then removes obsolete
files only when ownership and expected content are proven. A failed operation
preserves the preceding valid state where practical; a modified formerly owned
file is not silently removed.

That behaviour intentionally differs from a file-manager merge. It is slower
to reject an ambiguous overwrite than to copy through it, but it leaves a
clearer recovery path.

## Security model

Wukong does not execute package scripts. It keeps credentials out of manifests,
lockfiles, cache metadata, normal diagnostics, and public issue forms. Archive
extraction remains inside a staging root after path validation. A native
extension is treated as opaque package content: Wukong may materialise its
descriptor and bytes, but does not compile or load it and does not claim ABI or
platform compatibility.

These controls reduce particular project-file and reproducibility risks; they
do not establish publisher trust or prove an addon is safe. The
[security guide](security.md) and [threat model](threat-model.md) state the
remaining boundaries.

## Performance: measure before claiming

Wukong has no published speed claim. Its benchmark harness separates manifest
and lock parsing, resolution, extraction, hashing, cache access,
materialisation, cold and warm synchronisation, and no-op work. It requires
raw results, hardware, operating-system, filesystem, network, cache-state, and
repetition details before any comparison. See the
[benchmark methodology](benchmarks.md).

Measured implementation choices currently include bounded parallel direct
preparation, single-pass file hashing, checksum reuse in ownership maps,
reflink-or-copy materialisation without hardlink aliasing, and a no-op fast
path. They are engineering decisions, not benchmark marketing.

## Existing workflows and tools

Wukong complements rather than replaces Godot's editor installer. AssetLib is
useful for discovery and interactive archive installation; Wukong records
selected immutable source content and applies its own transaction. Manual Git
or ZIP installation remains appropriate for one-off work, but it leaves the
team to record revisions, checksums, ownership, and removal policy itself.

Script-oriented managers make a different trade-off. For example, the
[GDQuest addon collection](https://github.com/GDQuest/godot-addons) documents
an include-based `gd-plug` workflow that invokes a Godot script. Wukong's
security boundary is deliberately narrower: source acquisition and addon-file
materialisation, with no package-script execution. Users should choose a tool
based on their workflow and threat model, not on an unverified feature matrix.

## Known limitations and next evidence

Wukong remains pre-alpha and has no public release. Native macOS validation,
public Git/HTTP integration tests, and the 20-fixture public corpus have been
exercised locally. Linux and Windows native validation, external onboarding,
private-source validation, and 50/100-addon corpus goals still require their
respective environments or consented testers. GitHub Actions remains deferred
until account billing or spending configuration is resolved.

The next release decision requires reproducible CI on macOS, Linux, and
Windows; no known critical data-loss or credential-exposure issue; and the
remaining external readiness evidence. Until then, the useful contribution is
testing Wukong against a safe, reproducible project and reporting the result
through the redacted issue form.
