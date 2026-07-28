# TODO: Godot Package Manager

> Working name: `gpm`
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

## GPM-001: Create the Rust workspace

- [ ] Create a Cargo workspace.
- [ ] Add a reusable core crate, provisionally `gpm-core`.
- [ ] Add a CLI crate, provisionally `gpm-cli`.
- [ ] Add a test-support crate only when shared fixtures justify it.
- [ ] Set a supported minimum Rust version.
- [ ] Enable strict linting.
- [ ] Configure formatting.
- [ ] Add licence and contribution files.

Acceptance criteria:

- `cargo build --workspace` succeeds.
- `cargo test --workspace` succeeds.
- `cargo fmt --check` succeeds.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` succeeds.

## GPM-002: Establish CI

- [ ] Add GitHub Actions for macOS, Linux and Windows.
- [ ] Run formatting, linting and tests.
- [ ] Cache Cargo dependencies safely.
- [ ] Add a dependency vulnerability audit.
- [ ] Add a minimal release-build smoke test.

Acceptance criteria:

- A pull request cannot merge with failing required checks.
- All three operating systems execute at least one integration test.

## GPM-003: Add repository documentation skeleton

- [ ] Add `README.md`.
- [ ] Add `CONTRIBUTING.md`.
- [ ] Add `SECURITY.md`.
- [ ] Add `docs/architecture.md`.
- [ ] Add `docs/adr/README.md`.
- [ ] Add `docs/benchmarks.md`.
- [ ] Link the PRD and roadmap from the README.

## GPM-004: Define error and diagnostic conventions

- [ ] Create structured internal error types.
- [ ] Separate user errors, source errors, integrity errors and internal errors.
- [ ] Define stable process exit codes.
- [ ] Ensure secrets and credentials are redacted.
- [ ] Provide contextual error chains without exposing implementation noise by default.

Acceptance criteria:

- Representative errors contain package and source context.
- Verbose mode exposes causes.
- Default output gives a concrete recovery action where possible.

---

# Phase 1 — Project discovery and manifest

## GPM-010: Detect a Godot project

- [ ] Walk upward from the working directory to locate `project.godot`.
- [ ] Stop at filesystem boundaries where appropriate.
- [ ] Support an explicit `--project` path.
- [ ] Reject ambiguous or missing projects clearly.

Tests:

- [ ] Current directory is project root.
- [ ] Nested working directory.
- [ ] Explicit project path.
- [ ] Missing `project.godot`.
- [ ] Multiple nested project roots.

## GPM-011: Define the manifest schema

- [ ] Adopt `gpm.toml`.
- [ ] Define `[project]`.
- [ ] Define `[dependencies]`.
- [ ] Define `[dev-dependencies]`.
- [ ] Define Git, URL and path dependency forms.
- [ ] Define Godot version constraints.
- [ ] Reject ambiguous source declarations.
- [ ] Add schema-version handling if required.

Acceptance criteria:

- The example manifest in the PRD parses successfully.
- Invalid combinations produce field-specific errors.

## GPM-012: Implement manifest parsing

- [ ] Parse TOML into typed domain structures.
- [ ] Validate package names.
- [ ] Validate source definitions.
- [ ] Validate version constraints.
- [ ] Canonicalise paths relative to the manifest.
- [ ] Preserve enough source-position information for useful errors.

Tests:

- [ ] Valid minimal manifest.
- [ ] Full manifest.
- [ ] Duplicate keys.
- [ ] Invalid versions.
- [ ] Multiple source types.
- [ ] Missing project metadata.
- [ ] Invalid relative paths.
- [ ] Unicode package names policy.

## GPM-013: Implement `gpm init`

- [ ] Detect the project.
- [ ] Refuse to overwrite an existing manifest.
- [ ] Infer a default project name.
- [ ] Write a minimal manifest atomically.
- [ ] Add an optional non-interactive mode.

Acceptance criteria:

- Running `gpm init` twice does not corrupt or overwrite the manifest.
- The generated manifest parses successfully.

## GPM-014: Add manifest editing support

- [ ] Add a dependency without destroying unrelated fields.
- [ ] Remove a dependency.
- [ ] Preserve comments where practical.
- [ ] Maintain deterministic formatting.
- [ ] Back up or transactionally update the file.

---

# Phase 2 — Package identity and source adapters

## GPM-020: Define canonical package identity

Resolve through an ADR:

- [ ] Package naming rules.
- [ ] Source-qualified identity rules.
- [ ] Handling of the same name from different sources.
- [ ] Case-sensitivity policy.
- [ ] Unicode normalisation policy.
- [ ] Development versus runtime identity.

Acceptance criteria:

- Equivalent references canonicalise identically.
- Conflicting identities fail before download.

## GPM-021: Define the source-adapter interface

The interface should support:

- [ ] Canonical source identity.
- [ ] Available version discovery where possible.
- [ ] Resolution to an immutable source revision.
- [ ] Fetching.
- [ ] Integrity metadata.
- [ ] Package layout metadata.
- [ ] Human-readable diagnostics.
- [ ] Offline availability checks.

Do not leak Git-specific assumptions into the resolver.

## GPM-022: Implement local path dependencies

- [ ] Support relative and absolute paths.
- [ ] Resolve paths relative to `gpm.toml`.
- [ ] Snapshot or hash package contents.
- [ ] Detect missing paths.
- [ ] Define handling for paths outside the project.
- [ ] Ignore `.git` and configurable irrelevant files when hashing.

Tests:

- [ ] Local addon root.
- [ ] Repository containing `addons/<name>`.
- [ ] Missing path.
- [ ] Changed local contents.
- [ ] Symlink inside local package.
- [ ] Path outside project.

## GPM-023: Implement Git source canonicalisation

- [ ] Support HTTPS URLs.
- [ ] Delegate SSH authentication to the user's Git configuration.
- [ ] Redact credentials from logs.
- [ ] Canonicalise equivalent repository URLs where safe.
- [ ] Support tags, branches and exact revisions.
- [ ] Resolve every floating reference to an exact commit.

Acceptance criteria:

- The lockfile never stores a branch as the immutable identity.
- Private repository credentials never appear in normal logs.

## GPM-024: Implement Git fetching

- [ ] Decide between invoking system Git and using a Rust Git implementation.
- [ ] Record the decision in an ADR.
- [ ] Fetch into a temporary cache location.
- [ ] Verify the resolved commit.
- [ ] Avoid Git submodule initialisation by default.
- [ ] Handle interrupted fetches.
- [ ] Deduplicate concurrent fetches.

Tests:

- [ ] Public repository.
- [ ] Tag.
- [ ] Branch resolved to commit.
- [ ] Exact commit.
- [ ] Missing revision.
- [ ] Interrupted fetch.
- [ ] Existing warm cache.
- [ ] Concurrent fetch.

## GPM-025: Implement HTTP archive sources

- [ ] Support HTTPS.
- [ ] Require or derive a checksum.
- [ ] Stream downloads to disk.
- [ ] Enforce configured size limits.
- [ ] Support redirects with a safe policy.
- [ ] Use temporary files and atomic publication.
- [ ] Support conditional requests later if useful.

Tests:

- [ ] Successful ZIP download.
- [ ] Checksum mismatch.
- [ ] Redirect.
- [ ] Excessive size.
- [ ] Interrupted download.
- [ ] Warm cache.
- [ ] Invalid TLS or URL.

## GPM-026: Define source adapter contract tests

- [ ] Create a reusable adapter test suite.
- [ ] Verify immutable resolution.
- [ ] Verify offline behaviour.
- [ ] Verify deterministic source identity.
- [ ] Verify fetch integrity.
- [ ] Verify cancellation and cleanup.

---

# Phase 3 — Safe package preparation

## GPM-030: Implement secure archive extraction

- [ ] Support ZIP initially.
- [ ] Consider tar formats only after ZIP is robust.
- [ ] Reject `../` traversal.
- [ ] Reject absolute paths.
- [ ] Reject Windows drive-prefix escapes.
- [ ] Define symlink policy.
- [ ] Define hardlink policy.
- [ ] Enforce file-count limits.
- [ ] Enforce total expanded-size limits.
- [ ] Enforce expansion-ratio limits.
- [ ] Clean temporary output after failure.

Acceptance criteria:

- Every malicious archive fixture fails without writing outside the staging directory.

## GPM-031: Detect package layout

Support explicit configuration and conservative inference for:

- [ ] Root is the addon.
- [ ] Root contains `addons/<name>`.
- [ ] Archive contains one wrapper directory.
- [ ] Repository contains multiple addon candidates.
- [ ] Declared source subdirectory.
- [ ] Declared target path.

Acceptance criteria:

- Ambiguous layouts fail with candidate paths listed.
- No silent selection among multiple addons.

## GPM-032: Define optional package metadata

- [ ] Define `gpm-package.toml`.
- [ ] Add package name and version.
- [ ] Add Godot compatibility.
- [ ] Add dependency declarations.
- [ ] Add package root or target mapping.
- [ ] Add schema-version handling.
- [ ] Document that metadata is optional for direct installation.

## GPM-033: Prepare canonical package trees

- [ ] Copy or transform fetched sources into a canonical staging tree.
- [ ] Exclude source-control metadata.
- [ ] Exclude unrelated repository files where layout rules permit.
- [ ] Compute a deterministic content hash.
- [ ] Record file paths and permissions.
- [ ] Reject path collisions after normalisation.

Tests:

- [ ] Deterministic hash.
- [ ] Different source wrappers produce identical canonical content where intended.
- [ ] Case-collision fixture.
- [ ] Unicode-normalisation collision fixture.
- [ ] Executable-bit behaviour across platforms.

## GPM-034: Build the first compatibility-fixture format

Each fixture should declare:

- [ ] Package source.
- [ ] Immutable revision.
- [ ] Package layout.
- [ ] Expected installed paths.
- [ ] Expected package hash.
- [ ] Supported Godot version.
- [ ] Optional headless validation command.

Start with at least five public addons before implementing resolution.

---

# Phase 4 — Lockfile and direct dependency installation

## GPM-040: Define the lockfile schema

- [ ] Select TOML or another reviewable deterministic format.
- [ ] Add lockfile schema version.
- [ ] Record exact source identities.
- [ ] Record checksums.
- [ ] Record dependencies.
- [ ] Record package layout.
- [ ] Record Godot compatibility.
- [ ] Avoid timestamps.

## GPM-041: Implement deterministic lockfile serialisation

- [ ] Stable package ordering.
- [ ] Stable dependency ordering.
- [ ] Stable source formatting.
- [ ] Byte-identical output for identical graphs.
- [ ] Forward-compatible unknown-field policy.

Property tests:

- [ ] Parse/serialise round-trip.
- [ ] Deterministic repeated writes.
- [ ] Entry-order independence.
- [ ] Unknown optional fields.
- [ ] Unknown mandatory schema version.

## GPM-042: Implement direct dependency locking

Before transitive resolution:

- [ ] Resolve every direct Git dependency to an exact commit.
- [ ] Verify every HTTP dependency checksum.
- [ ] Hash every local dependency.
- [ ] Produce a lockfile.
- [ ] Reuse existing valid locks.
- [ ] Avoid unnecessary source access.

Acceptance criteria:

- A project with multiple direct dependencies produces a deterministic lockfile.
- Re-running lock without changes performs no writes.

## GPM-043: Implement `gpm lock`

- [ ] Lock without materialising packages.
- [ ] Support `--locked`.
- [ ] Support `--offline`.
- [ ] Explain manifest-lock mismatches.
- [ ] Return a non-zero exit code when lock changes are forbidden.

---

# Phase 5 — Cache and atomic materialisation

## GPM-050: Define cache directory layout

- [ ] Follow platform conventions for cache directories.
- [ ] Separate downloads, source checkouts, prepared packages and metadata.
- [ ] Use content-addressed object names.
- [ ] Add cache schema versioning.
- [ ] Add process-safe lock files.

## GPM-051: Implement atomic cache object publication

- [ ] Write to a unique temporary path.
- [ ] Verify final content hash.
- [ ] Flush where required.
- [ ] Atomically rename into place.
- [ ] Handle another process winning the race.
- [ ] Remove stale partial objects safely.

Tests:

- [ ] Concurrent writers.
- [ ] Process interruption simulation.
- [ ] Corrupted existing object.
- [ ] Read during publication.
- [ ] Windows rename behaviour.

## GPM-052: Implement cache integrity verification

- [ ] Verify content hashes on read.
- [ ] Quarantine or remove corrupted objects.
- [ ] Provide actionable diagnostics.
- [ ] Add an optional full cache verification command.

## GPM-053: Define installed-state metadata

- [ ] Create `.gpm/`.
- [ ] Record installed package identities.
- [ ] Record owned files.
- [ ] Record file hashes.
- [ ] Record selected dependency groups.
- [ ] Record materialisation strategy.
- [ ] Version the state schema.

## GPM-054: Build desired file ownership maps

- [ ] Combine package file trees.
- [ ] Detect exact-path conflicts.
- [ ] Detect case-insensitive conflicts.
- [ ] Detect conflicts with non-package project files.
- [ ] Distinguish identical shared content from incompatible collisions.
- [ ] Produce a clear conflict report.

## GPM-055: Implement transactional project synchronisation

- [ ] Calculate differences before writing.
- [ ] Stage new files.
- [ ] Preserve unrelated files.
- [ ] Remove only previously recorded package-owned files.
- [ ] Commit changes atomically where possible.
- [ ] Restore prior state after failure where practical.
- [ ] Write state metadata last.

Acceptance criteria:

- An interrupted sync leaves either the previous valid state or the complete new state.
- A repeated sync makes no changes.
- Removing a package never deletes an unrelated user file.

## GPM-056: Implement materialisation strategies

Evaluate and implement:

- [ ] File copy fallback.
- [ ] Hardlinks where safe.
- [ ] Reflinks where available.
- [ ] Per-platform capability detection.
- [ ] Explicit strategy override for testing.

Do not default to symlinks.

## GPM-057: Implement `gpm install` and `gpm sync`

- [ ] `install` follows the lockfile.
- [ ] `sync` reconciles the filesystem to the lockfile and selected dependency groups.
- [ ] Add `--offline`.
- [ ] Add `--locked`.
- [ ] Add `--frozen` semantics if useful.
- [ ] Add concise operation summaries.

---

# Phase 6 — Dependency resolution

## GPM-060: Evaluate resolver implementations

- [ ] Define required constraint semantics.
- [ ] Evaluate PubGrub-compatible Rust libraries.
- [ ] Evaluate simpler graph resolution for source-pinned packages.
- [ ] Record the decision in an ADR.
- [ ] Build resolver benchmarks before custom implementation.

## GPM-061: Implement semantic version handling

- [ ] Exact versions.
- [ ] Ranges.
- [ ] Caret requirements.
- [ ] Tilde requirements if supported.
- [ ] Pre-release policy.
- [ ] Invalid or missing versions.
- [ ] Source-pinned packages without version catalogues.

Document deviations from conventional SemVer.

## GPM-062: Discover package versions

For Git sources:

- [ ] Enumerate version-like tags.
- [ ] Apply configurable tag-prefix handling.
- [ ] Map tags to immutable commits.
- [ ] Reject duplicate semantic versions mapping ambiguously.
- [ ] Cache metadata safely.

For other sources:

- [ ] Define whether version discovery is possible.
- [ ] Require exact versions or metadata where it is not.

## GPM-063: Resolve transitive dependencies

- [ ] Read package-owned metadata.
- [ ] Build the package universe lazily.
- [ ] Resolve complete graphs.
- [ ] Detect cycles.
- [ ] Prefer existing valid lockfile selections.
- [ ] Avoid unnecessary package updates.
- [ ] Report conflicts with dependency paths.

Acceptance criteria:

- Resolver results satisfy all constraints.
- Resolver output is deterministic.
- Conflict errors identify the incompatible requirements.

## GPM-064: Add resolver property tests

- [ ] Generated solvable graphs.
- [ ] Generated unsatisfiable graphs.
- [ ] Cyclic graphs.
- [ ] Multiple valid solutions.
- [ ] Locked-version preference.
- [ ] Pre-release cases.
- [ ] Duplicate source identities.

## GPM-065: Implement `gpm tree` and `gpm why`

- [ ] Human-readable tree.
- [ ] JSON output.
- [ ] Indicate direct, transitive and dev dependencies.
- [ ] Explain all root-to-package paths.
- [ ] Detect and display repeated subgraphs compactly.

---

# Phase 7 — Dependency mutation commands

## GPM-070: Implement `gpm add`

- [ ] Parse package specifications.
- [ ] Support Git URL.
- [ ] Support exact Git revision.
- [ ] Support URL plus checksum.
- [ ] Support local path.
- [ ] Support `--dev`.
- [ ] Update manifest transactionally.
- [ ] Resolve and sync.
- [ ] Roll back manifest and lockfile after failure.

## GPM-071: Implement `gpm remove`

- [ ] Remove direct dependency.
- [ ] Re-resolve graph.
- [ ] Remove unneeded transitive packages.
- [ ] Preserve still-required packages.
- [ ] Preserve unrelated files.
- [ ] Present a removal summary.

## GPM-072: Implement `gpm update`

- [ ] Update all dependencies.
- [ ] Update one selected dependency.
- [ ] Minimise unrelated changes.
- [ ] Respect version constraints.
- [ ] Show old and new versions or revisions.
- [ ] Support dry-run.

## GPM-073: Implement `gpm outdated`

- [ ] Detect newer compatible versions.
- [ ] Distinguish compatible and breaking updates.
- [ ] Handle Git dependencies without version tags.
- [ ] Support JSON output.

---

# Phase 8 — Godot compatibility and validation

## GPM-080: Parse project Godot compatibility

- [ ] Define manifest-based Godot requirement.
- [ ] Optionally inspect `project.godot` for useful version metadata.
- [ ] Allow an explicit CLI override.
- [ ] Avoid unreliable inference.

## GPM-081: Enforce package Godot constraints

- [ ] Read constraints from package metadata.
- [ ] Include Godot version in resolution.
- [ ] Report incompatible packages before installation.
- [ ] Support packages with unknown compatibility explicitly.

## GPM-082: Add optional Godot executable discovery

- [ ] Support explicit executable path.
- [ ] Search common platform locations.
- [ ] Support environment-variable configuration.
- [ ] Print the selected executable in verbose mode.

## GPM-083: Add headless validation

- [ ] Run a safe Godot headless import or project check.
- [ ] Capture structured diagnostics where possible.
- [ ] Do not make Godot execution mandatory for normal package installation.
- [ ] Add a timeout.
- [ ] Redact project paths where necessary in shared reports.

## GPM-084: Expand compatibility corpus to 20 addons

For each addon:

- [ ] Pin an immutable source.
- [ ] Verify expected files.
- [ ] Verify cold installation.
- [ ] Verify warm installation.
- [ ] Verify no-op sync.
- [ ] Run headless validation where feasible.
- [ ] Record failures and required layout overrides.

Version `0.1.0` must not be released before this task is complete.

---

# Phase 9 — Offline, concurrency and resilience

## GPM-090: Implement strict offline mode

- [ ] Prevent all network access.
- [ ] Explain every missing cache object.
- [ ] Install successfully from a complete cache.
- [ ] Add tests that fail if a network socket is opened.

## GPM-091: Implement cross-process locking

- [ ] Cache object locks.
- [ ] Repository fetch locks.
- [ ] Project mutation lock.
- [ ] Stale-lock recovery.
- [ ] Clear diagnostics when another operation is active.

## GPM-092: Add interruption and crash tests

Simulate failure during:

- [ ] Download.
- [ ] Extraction.
- [ ] Hashing.
- [ ] Cache publication.
- [ ] File staging.
- [ ] Project commit.
- [ ] State-file write.
- [ ] Stale-file removal.

## GPM-093: Add cache maintenance commands

- [ ] `gpm cache dir`.
- [ ] `gpm cache status`.
- [ ] `gpm cache verify`.
- [ ] `gpm cache clean`.
- [ ] Safe garbage collection.
- [ ] Dry-run.
- [ ] Human-readable size reporting.

## GPM-094: Implement `gpm doctor`

Check:

- [ ] Project discovery.
- [ ] Manifest validity.
- [ ] Lockfile validity.
- [ ] State-file consistency.
- [ ] Cache permissions.
- [ ] Cache corruption.
- [ ] Filesystem capability.
- [ ] Godot executable availability.
- [ ] Network configuration when not offline.
- [ ] Concurrent operation locks.

---

# Phase 10 — Security hardening

## GPM-100: Create a written threat model

- [ ] Identify assets.
- [ ] Identify trust boundaries.
- [ ] Identify attacker-controlled inputs.
- [ ] Define security assumptions.
- [ ] Document residual risk.

## GPM-101: Fuzz manifest and lockfile parsers

- [ ] Add fuzz targets.
- [ ] Seed with valid and invalid fixtures.
- [ ] Run bounded fuzzing in CI or scheduled workflows.
- [ ] Convert crashes into regression tests.

## GPM-102: Fuzz archive extraction

- [ ] Malformed ZIP structures.
- [ ] Path traversal.
- [ ] Duplicate paths.
- [ ] Unicode paths.
- [ ] Compression bombs within bounded harness limits.
- [ ] Symlink and special-file entries.

## GPM-103: Harden credential handling

- [ ] Redact embedded URL credentials.
- [ ] Avoid logging authentication headers.
- [ ] Do not persist private tokens in the lockfile.
- [ ] Delegate Git authentication safely.
- [ ] Review crash reports for secret exposure.

## GPM-104: Add dependency provenance

- [ ] Display canonical source.
- [ ] Display immutable revision.
- [ ] Display checksum.
- [ ] Add `gpm audit` baseline output.
- [ ] Reserve signature-verification design for a later milestone.

## GPM-105: Commission or perform a security review before `1.0`

- [ ] Review archive handling.
- [ ] Review filesystem transactions.
- [ ] Review cache race conditions.
- [ ] Review credential handling.
- [ ] Review update and rollback paths.

---

# Phase 11 — Performance and benchmarks

## GPM-110: Build benchmark harness

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

## GPM-111: Define benchmark fixtures

- [ ] Small project.
- [ ] Medium dependency graph.
- [ ] Large graph.
- [ ] Many small files.
- [ ] One large addon.
- [ ] Cold cache.
- [ ] Warm cache.
- [ ] Offline cache hit.
- [ ] Concurrent project installs.

## GPM-112: Publish honest benchmark methodology

- [ ] Hardware.
- [ ] Operating system.
- [ ] Network conditions.
- [ ] Cache state.
- [ ] Competitor commands.
- [ ] Repetition count.
- [ ] Variance.
- [ ] Raw result data.

## GPM-113: Optimise only measured bottlenecks

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

## GPM-120: Research official integration boundaries

- [ ] Document public APIs or supported metadata sources.
- [ ] Review authentication and rate limits.
- [ ] Review download licences and redistribution constraints.
- [ ] Identify stable identifiers and version metadata.
- [ ] Record findings in an ADR.

## GPM-121: Implement the asset-source adapter

- [ ] Search or resolve assets by stable identifier.
- [ ] Retrieve version metadata.
- [ ] Resolve to immutable downloadable artifacts.
- [ ] Verify checksums where available.
- [ ] Cache metadata responsibly.
- [ ] Produce clear errors when upstream data is incomplete.

## GPM-122: Keep official integration replaceable

- [ ] No official-source types inside the generic resolver.
- [ ] No assumptions about one registry in lockfile core types.
- [ ] Contract tests shared with other source adapters.
- [ ] Feature flag if upstream stability requires it.

---

# Phase 13 — Editor integration

## GPM-130: Define a machine-readable CLI protocol

- [ ] Stable JSON output.
- [ ] Progress events.
- [ ] Structured diagnostics.
- [ ] Cancellation.
- [ ] Exit-status conventions.
- [ ] Protocol versioning.

## GPM-131: Build a minimal Godot editor plugin

- [ ] Detect CLI.
- [ ] Display installed packages.
- [ ] Run sync.
- [ ] Show progress.
- [ ] Display errors.
- [ ] Open manifest and lockfile.
- [ ] Avoid duplicating package-management logic.

## GPM-132: Add editor dependency views

- [ ] Dependency tree.
- [ ] Outdated packages.
- [ ] Source and checksum.
- [ ] Godot compatibility warnings.
- [ ] Package ownership conflicts.

---

# Phase 14 — Release readiness

## GPM-140: Prepare installation channels

- [ ] GitHub release binaries.
- [ ] macOS universal or architecture-specific binaries.
- [ ] Linux binaries.
- [ ] Windows binaries.
- [ ] Homebrew formula.
- [ ] Scoop manifest.
- [ ] Cargo installation where appropriate.
- [ ] Artifact checksums.

## GPM-141: Complete user documentation

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

## GPM-142: Complete contributor documentation

- [ ] Architecture overview.
- [ ] Source adapter guide.
- [ ] Fixture guide.
- [ ] Release process.
- [ ] Debugging instructions.
- [ ] Compatibility corpus process.
- [ ] ADR process.

## GPM-143: Recruit external testers

- [ ] Identify at least three unrelated Godot repositories.
- [ ] Add their reproducible cases to the fixture corpus where permitted.
- [ ] Record onboarding friction.
- [ ] Resolve critical installation failures.
- [ ] Collect launch testimonials only when genuinely provided.

## GPM-144: Release `0.1.0`

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

## GPM-150: Triage using reproducibility-first issue templates

Require:

- [ ] Operating system.
- [ ] `gpm` version.
- [ ] Godot version.
- [ ] Minimal manifest.
- [ ] Lockfile where safe.
- [ ] Verbose diagnostic output with secrets removed.
- [ ] Expected and actual behaviour.

## GPM-151: Expand the compatibility corpus

Targets:

- [ ] 50 addons.
- [ ] 100 addons.
- [ ] Multi-addon repositories.
- [ ] Native-extension packages.
- [ ] Private Git sources.
- [ ] Large projects.
- [ ] Windows-specific cases.

## GPM-152: Publish a technical launch article

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

## GPM-153: Decide whether to pursue `1.0`

Require evidence of:

- [ ] External recurring users.
- [ ] Stable manifest and lockfile semantics.
- [ ] Manageable support burden.
- [ ] Strong compatibility-corpus results.
- [ ] No unresolved architectural blockers.
- [ ] A credible migration policy.

---

# Suggested first implementation slice

Codex should begin with this exact vertical slice:

1. Create the Rust workspace and CI.
2. Detect a Godot project.
3. Parse a minimal `gpm.toml`.
4. Support one local path dependency.
5. Prepare it into a canonical package tree.
6. Produce a deterministic one-package lockfile.
7. Copy it into `addons/` transactionally.
8. Record file ownership in `.gpm/state.toml`.
9. Make repeated `gpm sync` a no-op.
10. Add tests for installation, idempotence, conflict refusal and safe removal.

Do not start with GitHub APIs, official asset integration, an editor plugin or a custom dependency solver.

The first milestone should prove the core invariant:

> Given the same manifest, lockfile and source content, `gpm sync` produces the same project addon state without modifying unrelated files.
