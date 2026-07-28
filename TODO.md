# TODO: Godot Package Manager

> Working name: `wukong`
>
> This checklist is ordered to produce a usable, testable vertical slice early.
>
> Each task should be implemented as a small reviewable change. Do not start later phases merely because earlier code compiles; satisfy the listed acceptance criteria first.

## Progress rules

- [ ] Every implementation task has tests.
- [ ] Every externally visible behaviour is documented.
- [ ] Every bug fix adds a regression fixture.
- [ ] CI must remain green on macOS, Linux and Windows.
- [ ] Avoid speculative abstractions without a second concrete use case.
- [ ] Record consequential design choices under `docs/adr/`.
- [ ] Do not execute arbitrary package scripts.
- [ ] Do not add a hosted registry during the initial roadmap.

---

# Phase 0 — Repository foundation

## wukong-001: Create the Rust workspace

- [x] Create a Cargo workspace.
- [x] Add a reusable core crate, provisionally `wukong-core`.
- [x] Add a CLI crate, provisionally `wukong-cli`.
- [x] Add a test-support crate only when shared fixtures justify it.
- [x] Set a supported minimum Rust version.
- [x] Enable strict linting.
- [x] Configure formatting.
- [x] Add licence and contribution files.

Acceptance criteria:

- [x] `cargo build --workspace` succeeds.
- [x] `cargo test --workspace` succeeds.
- [x] `cargo fmt --check` succeeds.
- [x] `cargo clippy --workspace --all-targets --all-features -- -D warnings` succeeds.

## wukong-003: Add repository documentation skeleton

- [x] Add `README.md`.
- [x] Add `CONTRIBUTING.md`.
- [x] Add `SECURITY.md`.
- [x] Add `docs/architecture.md`.
- [x] Add `docs/adr/README.md`.
- [x] Add `docs/benchmarks.md`.
- [x] Link the PRD and roadmap from the README.

## wukong-004: Define error and diagnostic conventions

- [x] Create structured internal error types.
- [x] Separate user errors, source errors, integrity errors and internal errors.
- [x] Define stable process exit codes.
- [x] Ensure secrets and credentials are redacted.
- [x] Provide contextual error chains without exposing implementation noise by default.

Acceptance criteria:

- Representative errors contain package and source context.
- Verbose mode exposes causes.
- Default output gives a concrete recovery action where possible.

---

# Phase 1 — Project discovery and manifest

## wukong-010: Detect a Godot project

- [x] Walk upward from the working directory to locate `project.godot`.
- [x] Stop at filesystem boundaries where appropriate.
- [x] Support an explicit `--project` path.
- [x] Reject ambiguous or missing projects clearly.

Tests:

- [x] Current directory is project root.
- [x] Nested working directory.
- [x] Explicit project path.
- [x] Missing `project.godot`.
- [x] Multiple nested project roots.

## wukong-011: Define the manifest schema

- [x] Adopt `wukong.toml`.
- [x] Define `[project]`.
- [x] Define `[dependencies]`.
- [x] Define `[dev-dependencies]`.
- [x] Define Git, URL and path dependency forms.
- [x] Define Godot version constraints.
- [x] Reject ambiguous source declarations.
- [x] Add schema-version handling if required.

Acceptance criteria:

- The example manifest in the PRD parses successfully.
- Invalid combinations produce field-specific errors.

## wukong-012: Implement manifest parsing

- [x] Parse TOML into typed domain structures.
- [x] Validate package names.
- [x] Validate source definitions.
- [x] Validate version constraints.
- [x] Canonicalise paths relative to the manifest.
- [x] Preserve enough source-position information for useful errors.

Tests:

- [x] Valid minimal manifest.
- [x] Full manifest.
- [x] Duplicate keys.
- [x] Invalid versions.
- [x] Multiple source types.
- [x] Missing project metadata.
- [x] Invalid relative paths.
- [x] Unicode package names policy.

## wukong-013: Implement `wukong init`

- [x] Detect the project.
- [x] Refuse to overwrite an existing manifest.
- [x] Infer a default project name.
- [x] Write a minimal manifest atomically.
- [x] Add an optional non-interactive mode.

Acceptance criteria:

- Running `wukong init` twice does not corrupt or overwrite the manifest.
- The generated manifest parses successfully.

## wukong-014: Add manifest editing support

- [x] Add a dependency without destroying unrelated fields.
- [x] Remove a dependency.
- [x] Preserve comments where practical.
- [x] Maintain deterministic formatting.
- [x] Back up or transactionally update the file.

# Phase 2 — Package identity and source adapters

## wukong-020: Define canonical package identity

Resolve through an ADR:

- [x] Package naming rules.
- [x] Source-qualified identity rules.
- [x] Handling of the same name from different sources.
- [x] Case-sensitivity policy.
- [x] Unicode normalisation policy.
- [x] Development versus runtime identity.

Acceptance criteria:

- Equivalent references canonicalise identically.
- Conflicting identities fail before download.

## wukong-021: Define the source-adapter interface

The interface should support:

- [x] Canonical source identity.
- [x] Available version discovery where possible.
- [x] Resolution to an immutable source revision.
- [x] Fetching.
- [x] Integrity metadata.
- [x] Package layout metadata.
- [x] Human-readable diagnostics.
- [x] Offline availability checks.

Do not leak Git-specific assumptions into the resolver.

## wukong-022: Implement local path dependencies

- [x] Support relative and absolute paths.
- [x] Resolve paths relative to `wukong.toml`.
- [x] Snapshot or hash package contents.
- [x] Detect missing paths.
- [x] Define handling for paths outside the project.
- [x] Ignore `.git` and configurable irrelevant files when hashing.

Tests:

- [x] Local addon root.
- [x] Repository containing `addons/<name>`.
- [x] Missing path.
- [x] Changed local contents.
- [x] Symlink inside local package.
- [x] Path outside project.

## wukong-023: Implement Git source canonicalisation

- [x] Support HTTPS URLs.
- [x] Redact credentials from logs.
- [x] Canonicalise equivalent repository URLs where safe.
- [x] Support tags, branches and exact revisions.

Acceptance criteria:

- The lockfile never stores a branch as the immutable identity.
- Private repository credentials never appear in normal logs.

## wukong-024: Implement Git fetching

- [x] Decide between invoking system Git and using a Rust Git implementation.
- [x] Record the decision in an ADR.
- [x] Delegate SSH authentication to the user's Git configuration.
- [x] Fetch into a temporary cache location.
- [x] Verify the resolved commit.
- [x] Resolve every floating reference to an exact commit.
- [x] Avoid Git submodule initialisation by default.
- [x] Handle interrupted fetches.
- [x] Deduplicate concurrent fetches.

Tests:

- [x] Public repository (ignored network integration test).
- [x] Tag.
- [x] Branch resolved to commit.
- [x] Exact commit.
- [x] Missing revision.
- [x] Interrupted fetch.
- [x] Existing warm cache.
- [x] Concurrent fetch.

## wukong-025: Implement HTTP archive sources

- [x] Support HTTPS.
- [x] Require or derive a checksum.
- [x] Stream downloads to disk.
- [x] Enforce configured size limits.
- [x] Support redirects with a safe policy.
- [x] Use temporary files and atomic publication.
- [x] Support conditional requests later if useful (deferred; immutable checksum cache).

Tests:

- [x] Successful ZIP download (fixture and ignored pinned HTTPS integration test).
- [x] Checksum mismatch.
- [x] Redirect.
- [x] Excessive size.
- [x] Interrupted download.
- [x] Warm cache.
- [x] Invalid TLS or URL (ignored invalid-TLS integration test and URL tests).

## wukong-026: Define source adapter contract tests

- [x] Create a reusable adapter test suite.
- [x] Verify immutable resolution.
- [x] Verify offline behaviour.
- [x] Verify deterministic source identity.
- [x] Verify fetch integrity.
- [x] Verify cancellation and cleanup.

---

# Phase 3 — Safe package preparation

## wukong-030: Implement secure archive extraction

- [x] Support ZIP initially.
- [x] Consider tar formats only after ZIP is robust.
- [x] Reject `../` traversal.
- [x] Reject absolute paths.
- [x] Reject Windows drive-prefix escapes.
- [x] Define symlink policy.
- [x] Define hardlink policy.
- [x] Enforce file-count limits.
- [x] Enforce total expanded-size limits.
- [x] Enforce expansion-ratio limits.
- [x] Clean temporary output after failure.

Acceptance criteria:

- Every malicious archive fixture fails without writing outside the staging directory.

## wukong-031: Detect package layout

Support explicit configuration and conservative inference for:

- [x] Root is the addon.
- [x] Root contains `addons/<name>`.
- [x] Archive contains one wrapper directory.
- [x] Repository contains multiple addon candidates.
- [x] Declared source subdirectory.
- [x] Declared target path.

Acceptance criteria:

- Ambiguous layouts fail with candidate paths listed.
- No silent selection among multiple addons.

## wukong-032: Define optional package metadata

- [x] Define `wukong-package.toml`.
- [x] Add package name and version.
- [x] Add Godot compatibility.
- [x] Add dependency declarations.
- [x] Add package root or target mapping.
- [x] Add schema-version handling.
- [x] Document that metadata is optional for direct installation.

## wukong-033: Prepare canonical package trees

- [x] Copy or transform fetched sources into a canonical staging tree.
- [x] Exclude source-control metadata.
- [x] Exclude unrelated repository files where layout rules permit.
- [x] Compute a deterministic content hash.
- [x] Record file paths and permissions.
- [x] Reject path collisions after normalisation.

Tests:

- [x] Deterministic hash.
- [x] Different source wrappers produce identical canonical content where intended.
- [x] Case-collision fixture.
- [x] Unicode-normalisation collision fixture.
- [x] Executable-bit behaviour across platforms.

## wukong-034: Build the first compatibility-fixture format

Each fixture should declare:

- [x] Package source.
- [x] Immutable revision.
- [x] Package layout.
- [x] Expected installed paths.
- [x] Expected package hash.
- [x] Supported Godot version.
- [x] Optional headless validation command.

Completed with five public addons before implementing resolution.

---

# Phase 4 — Lockfile and direct dependency installation

## wukong-040: Define the lockfile schema

- [x] Select TOML or another reviewable deterministic format.
- [x] Add lockfile schema version.
- [x] Record exact source identities.
- [x] Record checksums.
- [x] Record dependencies.
- [x] Record package layout.
- [x] Record Godot compatibility.
- [x] Avoid timestamps.

## wukong-041: Implement deterministic lockfile serialisation

- [x] Stable package ordering.
- [x] Stable dependency ordering.
- [x] Stable source formatting.
- [x] Byte-identical output for identical graphs.
- [x] Forward-compatible unknown-field policy.

Property tests:

- [x] Parse/serialise round-trip.
- [x] Deterministic repeated writes.
- [x] Entry-order independence.
- [x] Unknown optional fields.
- [x] Unknown mandatory schema version.

## wukong-042: Implement direct dependency locking

Before transitive resolution:

- [x] Resolve every direct Git dependency to an exact commit.
- [x] Verify every HTTP dependency checksum.
- [x] Hash every local dependency.
- [x] Produce a lockfile.
- [x] Reuse existing valid locks.
- [x] Avoid unnecessary source access.

Acceptance criteria:

- A project with multiple direct dependencies produces a deterministic lockfile.
- Re-running lock without changes performs no writes.

## wukong-043: Implement `wukong lock`

- [x] Lock without materialising packages.
- [x] Support `--locked`.
- [x] Support `--offline`.
- [x] Explain manifest-lock mismatches.
- [x] Return a non-zero exit code when lock changes are forbidden.

---

# Phase 5 — Cache and atomic materialisation

## wukong-050: Define cache directory layout

- [x] Follow platform conventions for cache directories.
- [x] Separate downloads, source checkouts, prepared packages and metadata.
- [x] Use content-addressed object names.
- [x] Add cache schema versioning.
- [x] Add process-safe lock files.

## wukong-051: Implement atomic cache object publication

- [x] Write to a unique temporary path.
- [x] Verify final content hash.
- [x] Flush where required.
- [x] Atomically rename into place.
- [x] Handle another process winning the race.

Tests:

- [x] Concurrent writers.
- [x] Corrupted existing object.
- [x] Read during publication.
- [x] Windows rename behaviour.

## wukong-052: Implement cache integrity verification

- [x] Verify content hashes on read.
- [x] Quarantine or remove corrupted objects.
- [x] Provide actionable diagnostics.
- [x] Add an optional full cache verification command.

## wukong-053: Define installed-state metadata

- [x] Create `.wukong/`.
- [x] Record installed package identities.
- [x] Record owned files.
- [x] Record file hashes.
- [x] Record selected dependency groups.
- [x] Record materialisation strategy.
- [x] Version the state schema.

## wukong-054: Build desired file ownership maps

- [x] Combine package file trees.
- [x] Detect exact-path conflicts.
- [x] Detect case-insensitive conflicts.
- [x] Detect conflicts with non-package project files.
- [x] Distinguish identical shared content from incompatible collisions.
- [x] Produce a clear conflict report.

## wukong-055: Implement transactional project synchronisation

- [x] Calculate differences before writing.
- [x] Stage new files.
- [x] Preserve unrelated files.
- [x] Remove only previously recorded package-owned files.
- [x] Commit changes atomically where possible.
- [x] Restore prior state after failure where practical.
- [x] Write state metadata last.

Acceptance criteria:

- An interrupted sync leaves either the previous valid state or the complete new state.
- A repeated sync makes no changes.
- Removing a package never deletes an unrelated user file.

## wukong-056: Implement materialisation strategies

Evaluate and implement:

- [x] File copy fallback.
- [x] Hardlinks where safe.
- [x] Reflinks where available.
- [x] Per-platform capability detection.
- [x] Explicit strategy override for testing.

Do not default to symlinks.

## wukong-057: Implement `wukong install` and `wukong sync`

- [x] `install` follows the lockfile.
- [x] `sync` reconciles the filesystem to the lockfile and selected dependency groups.
- [x] Add `--offline`.
- [x] Add `--locked`.
- [x] Add `--frozen` semantics as a local-only `--locked` alias.
- [x] Add concise operation summaries.

---

# Phase 6 — Dependency resolution

## wukong-060: Evaluate resolver implementations

- [x] Define required constraint semantics.
- [x] Evaluate PubGrub-compatible Rust libraries.
- [x] Evaluate simpler graph resolution for source-pinned packages.
- [x] Record the decision in an ADR.
- [x] Build resolver benchmarks before custom implementation.

## wukong-061: Implement semantic version handling

- [x] Exact versions.
- [x] Ranges.
- [x] Caret requirements.
- [x] Tilde requirements if supported.
- [x] Pre-release policy.
- [x] Invalid or missing versions.
- [x] Source-pinned packages without version catalogues.

Document deviations from conventional SemVer.

## wukong-062: Discover package versions

For Git sources:

- [x] Enumerate version-like tags.
- [x] Apply configurable tag-prefix handling.
- [x] Map tags to immutable commits.
- [x] Reject duplicate semantic versions mapping ambiguously.
- [x] Cache metadata safely.

For other sources:

- [x] Define whether version discovery is possible.
- [x] Require exact versions or metadata where it is not.

## wukong-063: Resolve transitive dependencies

- [x] Read package-owned metadata.
- [x] Build the package universe lazily.
- [x] Resolve complete graphs.
- [x] Detect cycles.
- [x] Prefer existing valid lockfile selections.
- [x] Avoid unnecessary package updates.
- [x] Report conflicts with dependency paths.

Acceptance criteria:

- Resolver results satisfy all constraints.
- Resolver output is deterministic.
- Conflict errors identify the incompatible requirements.

## wukong-064: Add resolver property tests

- [x] Generated solvable graphs.
- [x] Generated unsatisfiable graphs.
- [x] Cyclic graphs.
- [x] Multiple valid solutions.
- [x] Locked-version preference.
- [x] Pre-release cases.
- [x] Duplicate source identities.

## wukong-065: Implement `wukong tree` and `wukong why`

- [x] Human-readable tree.
- [x] JSON output.
- [x] Indicate direct, transitive and dev dependencies.
- [x] Explain all root-to-package paths.
- [x] Detect and display repeated subgraphs compactly.

---

# Phase 7 — Dependency mutation commands

## wukong-070: Implement `wukong add`

- [x] Parse package specifications.
- [x] Support Git URL.
- [x] Support exact Git revision.
- [x] Support URL plus checksum.
- [x] Support local path.
- [x] Support `--dev`.
- [x] Update manifest transactionally.
- [x] Resolve and sync.
- [x] Roll back manifest and lockfile after failure.

## wukong-071: Implement `wukong remove`

- [x] Remove direct dependency.
- [x] Re-resolve graph.
- [x] Remove unneeded transitive packages.
- [x] Preserve still-required packages.
- [x] Preserve unrelated files.
- [x] Present a removal summary.

## wukong-072: Implement `wukong update`

- [x] Update all dependencies.
- [x] Update one selected dependency.
- [x] Minimise unrelated changes.
- [x] Respect supported immutable source constraints; reject version-only declarations before mutation because no catalogue source exists.
- [x] Show old and new versions or revisions.
- [x] Support dry-run.

Scope: current direct sources are local paths, Git, and checksum-pinned HTTPS
archives. Version-only manifest declarations remain unsupported pending a
catalogue source; `update` reports that before changing the lockfile or project.

## wukong-073: Implement `wukong outdated`

- [x] Detect newer compatible versions.
- [x] Distinguish compatible and breaking updates.
- [x] Handle Git dependencies without version tags.
- [x] Support JSON output.

Scope: Git checks unprefixed semantic-version tags, then `v`-prefixed tags when
no exact tags exist. Compatibility is inferred from the locked tag using caret
SemVer rules because current source-pinned Git declarations have no version
range. Local paths and checksum-pinned archives report unavailable rather than
guessing a newer version.

---

# Phase 8 — Godot compatibility and validation

## wukong-080: Parse project Godot compatibility

- [x] Define manifest-based Godot requirement.
- [x] Treat `project.godot` as project settings only; it has no reliable engine-version field to infer.
- [x] Allow an explicit CLI override.
- [x] Avoid unreliable inference.

`wukong lock` and `wukong sync` accept `--godot <x.y.z>` as an exact active
engine version. It must satisfy `[project].godot` before mutation; absent that
option, no installed engine version is inferred.

## wukong-081: Enforce package Godot constraints

- [x] Read constraints from package metadata.
- [x] Include Godot compatibility in direct-source locking and synchronisation validation.
- [x] Report incompatible packages before installation.
- [x] Support packages with unknown compatibility explicitly.

Known requirements must match `--godot` when supplied; otherwise Wukong proves
stable SemVer-range overlap with `[project].godot`. Missing metadata and
pre-release-only comparisons remain explicit non-fatal states rather than
guessed compatibility.

## wukong-082: Add optional Godot executable discovery

- [x] Support explicit executable path.
- [x] Search common platform locations.
- [x] Support environment-variable configuration.
- [x] Print the selected executable in verbose mode.

`wukong godot path` performs discovery without running Godot. It uses explicit
path, `WUKONG_GODOT_EXECUTABLE`, `PATH`, then platform locations; `--verbose`
prints the chosen source.

## wukong-083: Add headless validation

- [x] Run a safe Godot headless import or project check.
- [x] Capture structured diagnostics where possible.
- [x] Do not make Godot execution mandatory for normal package installation.
- [x] Add a timeout.
- [x] Redact project paths where necessary in shared reports.

`wukong validate` is opt-in and invokes Godot with `--headless --path <project>
--editor --quit --recovery-mode`. It records a bounded, redacted structured
outcome, defaults to 60 seconds, and accepts `--timeout-seconds 1..=600`.

## wukong-084: Expand compatibility corpus to 20 addons

For each addon:

- [x] Pin an immutable source.
- [x] Verify expected files.
- [x] Verify cold installation.
- [x] Verify warm installation.
- [x] Verify no-op sync.
- [x] Run headless validation where feasible.
- [x] Record failures and required layout overrides.

Version `0.1.0` must not be released before this task is complete.

---

# Phase 9 — Offline, concurrency and resilience

## wukong-090: Implement strict offline mode

- [x] Prevent all network access.
- [x] Explain every missing cache object.
- [x] Install successfully from a complete cache.
- [x] Add tests that fail if a network socket is opened.

## wukong-091: Implement cross-process locking

- [x] Cache object locks.
- [x] Safely reclaim cache-publication candidates abandoned by interrupted processes.
- [x] Repository fetch locks.
- [x] Project mutation lock.
- [x] Stale-lock recovery.
- [x] Clear diagnostics when another operation is active.

## wukong-092: Add interruption and crash tests

Simulate failure during:

- [x] Download.
- [x] Extraction.
- [x] Hashing.
- [x] Cache publication.
- [x] File staging.
- [x] Project commit.
- [x] State-file write.
- [x] Stale-file removal.

## wukong-093: Add cache maintenance commands

- [x] `wukong cache dir`.
- [x] `wukong cache status`.
- [x] `wukong cache clean`.
- [x] Safe garbage collection.
- [x] Dry-run.
- [x] Human-readable size reporting.

## wukong-094: Implement `wukong doctor`

Check:

- [x] Project discovery.
- [x] Manifest validity.
- [x] Lockfile validity.
- [x] State-file consistency.
- [x] Cache permissions.
- [x] Cache corruption.
- [x] Filesystem capability.
- [x] Godot executable availability.
- [x] Network configuration when not offline.
- [x] Concurrent operation locks.

---

# Phase 10 — Security hardening

## wukong-100: Create a written threat model

- [x] Identify assets.
- [x] Identify trust boundaries.
- [x] Identify attacker-controlled inputs.
- [x] Define security assumptions.
- [x] Document residual risk.

## wukong-101: Fuzz manifest and lockfile parsers

- [x] Add fuzz targets.
- [x] Seed with valid and invalid fixtures.
- [x] Run bounded fuzzing in CI or scheduled workflows.
- [x] Convert crashes into regression tests.

## wukong-102: Fuzz archive extraction

- [x] Malformed ZIP structures.
- [x] Path traversal.
- [x] Duplicate paths.
- [x] Unicode paths.
- [x] Compression bombs within bounded harness limits.
- [x] Symlink and special-file entries.

## wukong-103: Harden credential handling

- [ ] Redact embedded URL credentials.
- [ ] Avoid logging authentication headers.
- [ ] Do not persist private tokens in the lockfile.
- [ ] Delegate Git authentication safely.
- [ ] Review crash reports for secret exposure.

## wukong-104: Add dependency provenance

- [ ] Display canonical source.
- [ ] Display immutable revision.
- [ ] Display checksum.
- [ ] Add `wukong audit` baseline output.
- [ ] Reserve signature-verification design for a later milestone.

## wukong-105: Commission or perform a security review before `1.0`

- [ ] Review archive handling.
- [ ] Review filesystem transactions.
- [ ] Review cache race conditions.
- [ ] Review credential handling.
- [ ] Review update and rollback paths.

---

# Phase 11 — Performance and benchmarks

## wukong-110: Build benchmark harness

Measure separately:

- [ ] Manifest parsing.
- [ ] Lockfile parsing.
- [ ] Resolution.
- [ ] Git fetch.
- [ ] HTTP fetch.
- [ ] Extraction.
- [ ] Hashing.
- [ ] Cache lookup.
- [ ] Materialisation.
- [ ] No-op sync.

## wukong-111: Define benchmark fixtures

- [ ] Small project.
- [ ] Medium dependency graph.
- [ ] Large graph.
- [ ] Many small files.
- [ ] One large addon.
- [ ] Cold cache.
- [ ] Warm cache.
- [ ] Offline cache hit.
- [ ] Concurrent project installs.

## wukong-112: Publish honest benchmark methodology

- [ ] Hardware.
- [ ] Operating system.
- [ ] Network conditions.
- [ ] Cache state.
- [ ] Competitor commands.
- [ ] Repetition count.
- [ ] Variance.
- [ ] Raw result data.

## wukong-113: Optimise only measured bottlenecks

Potential areas:

- [ ] Parallel fetch scheduling.
- [ ] Hashing concurrency.
- [ ] Git object reuse.
- [ ] Archive streaming.
- [ ] Incremental ownership-map calculation.
- [ ] No-op sync fast path.
- [ ] Reflink or hardlink materialisation.

Do not optimise parser microbenchmarks while downloads or filesystem work dominate.

---

# Phase 12 — Official asset-source adapter

Start only after Git, URL and local sources are stable.

## wukong-120: Research official integration boundaries

- [ ] Document public APIs or supported metadata sources.
- [ ] Review authentication and rate limits.
- [ ] Review download licences and redistribution constraints.
- [ ] Identify stable identifiers and version metadata.
- [ ] Record findings in an ADR.

## wukong-121: Implement the asset-source adapter

- [ ] Search or resolve assets by stable identifier.
- [ ] Retrieve version metadata.
- [ ] Resolve to immutable downloadable artifacts.
- [ ] Verify checksums where available.
- [ ] Cache metadata responsibly.
- [ ] Produce clear errors when upstream data is incomplete.

## wukong-122: Keep official integration replaceable

- [ ] No official-source types inside the generic resolver.
- [ ] No assumptions about one registry in lockfile core types.
- [ ] Contract tests shared with other source adapters.
- [ ] Feature flag if upstream stability requires it.

---

# Phase 13 — Editor integration

## wukong-130: Define a machine-readable CLI protocol

- [ ] Stable JSON output.
- [ ] Progress events.
- [ ] Structured diagnostics.
- [ ] Cancellation.
- [ ] Exit-status conventions.
- [ ] Protocol versioning.

## wukong-131: Build a minimal Godot editor plugin

- [ ] Detect CLI.
- [ ] Display installed packages.
- [ ] Run sync.
- [ ] Show progress.
- [ ] Display errors.
- [ ] Open manifest and lockfile.
- [ ] Avoid duplicating package-management logic.

## wukong-132: Add editor dependency views

- [ ] Dependency tree.
- [ ] Outdated packages.
- [ ] Source and checksum.
- [ ] Godot compatibility warnings.
- [ ] Package ownership conflicts.

---

# Phase 14 — Release readiness

## wukong-140: Prepare installation channels

- [ ] GitHub release binaries.
- [ ] macOS universal or architecture-specific binaries.
- [ ] Linux binaries.
- [ ] Windows binaries.
- [ ] Homebrew formula.
- [ ] Scoop manifest.
- [ ] Cargo installation where appropriate.
- [ ] Artifact checksums.

## wukong-141: Complete user documentation

- [ ] 60-second quick start.
- [ ] Command reference.
- [ ] Manifest reference.
- [ ] Lockfile policy.
- [ ] Git dependency guide.
- [ ] HTTP dependency guide.
- [ ] Local dependency guide.
- [ ] Offline and CI guide.
- [ ] Security guide.
- [ ] Troubleshooting.

## wukong-142: Complete contributor documentation

- [ ] Architecture overview.
- [ ] Source adapter guide.
- [ ] Fixture guide.
- [ ] Release process.
- [ ] Debugging instructions.
- [ ] Compatibility corpus process.
- [ ] ADR process.

## wukong-143: Recruit external testers

- [ ] Identify at least three unrelated Godot repositories.
- [ ] Add their reproducible cases to the fixture corpus where permitted.
- [ ] Record onboarding friction.
- [ ] Resolve critical installation failures.
- [ ] Collect launch testimonials only when genuinely provided.

## wukong-144: Release `0.1.0`

Release criteria:

- [ ] Git, HTTP and path dependencies work.
- [ ] Deterministic lockfile.
- [ ] Content-addressed cache.
- [ ] Offline installation.
- [ ] Atomic sync.
- [ ] Conflict detection.
- [ ] Security fixtures pass.
- [ ] CI passes on macOS, Linux and Windows.
- [ ] At least 20 compatibility fixtures pass.
- [ ] Documentation is complete enough for an external user.
- [ ] No known critical data-loss or credential-exposure bugs.

---

# Phase 15 — Post-launch

## wukong-150: Triage using reproducibility-first issue templates

Require:

- [ ] Operating system.
- [ ] `wukong` version.
- [ ] Godot version.
- [ ] Minimal manifest.
- [ ] Lockfile where safe.
- [ ] Verbose diagnostic output with secrets removed.
- [ ] Expected and actual behaviour.

## wukong-151: Expand the compatibility corpus

Targets:

- [ ] 50 addons.
- [ ] 100 addons.
- [ ] Multi-addon repositories.
- [ ] Native-extension packages.
- [ ] Private Git sources.
- [ ] Large projects.
- [ ] Windows-specific cases.

## wukong-152: Publish a technical launch article

Cover:

- [ ] Existing Godot addon workflow.
- [ ] Why reproducibility is the main product.
- [ ] Resolver architecture.
- [ ] Lockfile design.
- [ ] Content-addressed cache.
- [ ] Atomic installation.
- [ ] Security model.
- [ ] Benchmarks.
- [ ] Known limitations.
- [ ] Comparison with existing managers.

## wukong-153: Decide whether to pursue `1.0`

Require evidence of:

- [ ] External recurring users.
- [ ] Stable manifest and lockfile semantics.
- [ ] Manageable support burden.
- [ ] Strong compatibility-corpus results.
- [ ] No unresolved architectural blockers.
- [ ] A credible migration policy.

---

# Deferred external validation

## wukong-002: Establish CI

> Deferred by project direction until every other TODO issue is complete.
> GitHub Actions cannot start until the repository account's billing or spending
> limit is resolved.

- [ ] Add GitHub Actions for macOS, Linux and Windows.
- [ ] Run formatting, linting and tests.
- [ ] Cache Cargo dependencies safely.
- [ ] Add a dependency vulnerability audit.
- [ ] Add a minimal release-build smoke test.

Acceptance criteria:

- A pull request cannot merge with failing required checks.
- All three operating systems execute at least one integration test.

---

# Suggested first implementation slice

Codex should begin with this exact vertical slice:

1. Create the Rust workspace and CI.
2. Detect a Godot project.
3. Parse a minimal `wukong.toml`.
4. Support one local path dependency.
5. Prepare it into a canonical package tree.
6. Produce a deterministic one-package lockfile.
7. Copy it into `addons/` transactionally.
8. Record file ownership in `.wukong/state.toml`.
9. Make repeated `wukong sync` a no-op.
10. Add tests for installation, idempotence, conflict refusal and safe removal.

Do not start with GitHub APIs, official asset integration, an editor plugin or a custom dependency solver.

The first milestone should prove the core invariant:

> Given the same manifest, lockfile and source content, `wukong sync` produces the same project addon state without modifying unrelated files.
