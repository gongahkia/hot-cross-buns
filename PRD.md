# Product Requirements Document: Godot Package Manager

> Working name: `wukong`
>
> Status: Draft for implementation
>
> Primary target: Godot 4 projects
>
> Implementation language: Rust
>
> Product category: Reproducible dependency manager for Godot addons

## 1. Product summary

`wukong` is a fast, reproducible package and dependency manager for Godot 4 addons.

It gives Godot projects a single declarative manifest and deterministic lockfile for installing addons from:

- Git repositories
- HTTP archives
- Local filesystem paths
- The official Godot asset ecosystem, once a stable integration can be implemented

The primary proposition is **reproducible, declarative Godot addon management**.

Speed is a supporting advantage achieved through:

- Parallel downloads
- A global content-addressed cache
- Incremental synchronisation
- Deduplication across projects
- Avoiding repeated Git clones and archive downloads
- Concurrent checksum calculation

The product should not initially be marketed merely as a faster downloader. Godot addon installation is often dominated by network and filesystem operations, so the strongest value is dependency correctness, reproducibility and workflow consistency.

## 2. Problem statement

Godot addon installation is fragmented.

Developers commonly install addons by:

- Downloading ZIP files manually
- Copying directories into `addons/`
- Cloning Git repositories
- Adding Git submodules
- Following addon-specific installation instructions
- Using small third-party addon managers with different conventions

These approaches make it difficult to:

- Reproduce the same addon set on another machine
- Pin exact versions
- Audit where an addon came from
- Update safely
- remove all files owned by an addon
- Install development-only addons
- Support transitive addon dependencies
- Use the same setup locally and in CI
- Detect conflicting files
- Work offline after dependencies have already been fetched

`wukong` should convert this workflow into a deterministic dependency graph.

## 3. Product vision

A Godot developer should be able to clone a project and run:

```bash
wukong sync
```

The project should then receive exactly the addon versions recorded in its lockfile, regardless of which supported operating system performs the installation.

The long-term vision is:

> Cargo-like dependency management for Godot addons, built around compatibility, reproducibility and safe installation.

## 4. Target users

### 4.1 Primary users

- Individual Godot developers
- Small game teams
- Open-source Godot project maintainers
- Godot addon authors
- Tutorial and template authors
- CI pipelines that export or test Godot projects

### 4.2 Secondary users

- Game jams and educational teams
- Organisations maintaining multiple Godot projects
- Tooling authors building Godot project generators
- Build and release infrastructure maintainers

## 5. Goals

### 5.1 Initial goals

1. Provide a simple project manifest.
2. Resolve direct and transitive dependencies.
3. Generate a deterministic lockfile.
4. Support Git, HTTP archive and local path sources.
5. Install packages safely and atomically.
6. Maintain a global content-addressed cache.
7. Support offline installation when all required artifacts are cached.
8. Support CI and headless environments.
9. Detect package file conflicts.
10. Prevent common archive and filesystem attacks.
11. Behave consistently on macOS, Linux and Windows.
12. Provide understandable errors and diagnostics.

### 5.2 Later goals

1. Integrate with official Godot package or asset infrastructure.
2. Add an optional Godot editor plugin.
3. Add package provenance and audit commands.
4. Support signed package metadata or artifacts.
5. Import manifests from selected existing Godot addon managers.
6. Add a public compatibility index without requiring a new hosted package registry.
7. Offer machine-readable output for editor and CI integrations.

## 6. Non-goals

The first stable release will not:

- Host a new package registry.
- Execute arbitrary package installation scripts.
- Automatically enable plugins without explicit project configuration.
- Modify addon source code.
- Replace the Godot editor.
- Manage Godot engine installations.
- Manage non-addon project assets unless explicitly supported later.
- Guarantee semantic compatibility between addons.
- Solve native extension distribution in the first implementation.
- Support Godot 3 unless added after the Godot 4 workflow is stable.
- Implement a custom dependency solver before an established library has been evaluated.

## 7. Product principles

### 7.1 Compatibility before novelty

Use existing Godot project and addon conventions where possible. Do not require addon authors to adopt `wukong` before users can install their packages.

### 7.2 Reproducibility before convenience

The lockfile is authoritative during normal synchronisation. Commands that change dependency resolution must be explicit.

### 7.3 Safe by default

- No package scripts by default.
- Validate archive paths.
- Refuse ambiguous file ownership.
- Use temporary directories and atomic renames.
- Verify checksums before materialisation.
- Never silently overwrite user files.

### 7.4 One engine, multiple interfaces

The CLI, future editor plugin and CI integrations must use the same core library rather than implementing separate package-management behaviour.

### 7.5 Honest performance claims

Benchmarks must distinguish:

- Resolution time
- Network time
- Extraction time
- Cache-hit installation time
- End-to-end cold installation
- End-to-end warm installation

## 8. Proposed command-line interface

The executable name is provisionally `wukong`.

```text
wukong init
wukong add <package>
wukong add <package> --dev
wukong remove <package>
wukong install
wukong sync
wukong update [package]
wukong lock
wukong tree
wukong why <package>
wukong outdated
wukong audit
wukong cache dir
wukong cache status
wukong cache clean
wukong doctor
```

### 8.1 Command semantics

#### `wukong init`

- Detect a Godot project.
- Create `wukong.toml`.
- Add sensible ignore rules if requested.
- Never overwrite an existing manifest.

#### `wukong add`

- Add or update a dependency declaration.
- Resolve the complete graph.
- Update the lockfile.
- Materialise changed packages.
- Roll back manifest and lockfile changes if installation fails.

#### `wukong remove`

- Remove a dependency declaration.
- Re-resolve the graph.
- Remove files no longer owned by any package.
- Preserve shared transitive dependencies still required elsewhere.

#### `wukong install`

- Install according to the existing lockfile.
- Fail when the manifest and lockfile are incompatible unless an explicit update flag is supplied.

#### `wukong sync`

- Make the project filesystem match the lockfile exactly.
- Remove stale package-owned files.
- Preserve unrelated project files.
- Be idempotent.

#### `wukong update`

- Re-resolve permitted versions.
- Update all packages or a selected package and its affected dependency closure.
- Present a change summary before modifying project files when running interactively.

#### `wukong tree`

- Show the resolved dependency graph.
- Indicate direct, transitive and development dependencies.
- Support machine-readable JSON output.

#### `wukong why`

- Explain every path from a root dependency to the selected package.

#### `wukong doctor`

- Diagnose malformed manifests, stale lockfiles, cache corruption, filesystem limitations and unsupported Godot versions.

## 9. Manifest

Use TOML unless implementation research shows a compelling reason not to.

Example:

```toml
[project]
name = "my-game"
godot = ">=4.5,<5"

[dependencies]
dialogic = "^2.1"
terrain3d = { git = "https://github.com/TokisanGames/Terrain3D", tag = "v1.0.0" }
custom-ui = { url = "https://example.com/custom-ui-1.2.0.zip", sha256 = "..." }
shared-tools = { path = "../shared-tools" }

[dev-dependencies]
gut = { git = "https://github.com/bitwes/Gut", tag = "v9.4.0" }
```

### 9.1 Manifest requirements

- Human-readable.
- Stable key ordering when rewritten.
- Comments should be preserved where practical.
- Dependency source must be unambiguous.
- A dependency may specify only one source type.
- Git dependencies should support exact revisions and tags.
- Floating branches should be permitted only when the lockfile records an immutable commit.
- HTTP archives should require a checksum unless obtained from a trusted metadata source.
- Local path dependencies should record enough information to detect changes.
- Development dependencies should be separable from runtime dependencies.

## 10. Lockfile

The lockfile should be deterministic and machine-generated.

Provisionally use `wukong.lock`.

Each package entry should include:

- Canonical package name
- Resolved version, when available
- Source type
- Immutable source identifier
- Resolved Git commit
- Download URL, when applicable
- Artifact checksum
- Package content checksum
- Dependency list
- Godot compatibility constraints
- Package root within the source archive or repository
- Installed path mapping
- Development-only status
- Lockfile schema version

### 10.1 Lockfile properties

- Stable ordering.
- No timestamps unless required.
- Repeated resolution of the same graph produces byte-identical output.
- A schema version is mandatory.
- Unknown mandatory fields must produce an error.
- The lockfile must be reviewable in version control.

## 11. Package model

A package is a set of files plus metadata.

A package may be sourced from:

1. A Git repository.
2. A Git repository subdirectory.
3. An HTTP archive.
4. A local directory.
5. An official Godot asset source added later.

### 11.1 Package metadata

`wukong` should support an optional package-owned manifest, provisionally `wukong-package.toml`.

Possible fields:

```toml
[package]
name = "example-addon"
version = "1.2.0"
godot = ">=4.4,<5"
root = "addons/example_addon"

[dependencies]
another-addon = "^2.0"
```

Packages without this manifest must remain installable through project-level declarations and inferred layout.

### 11.2 Layout handling

The resolver and installer must distinguish:

- Repository root is the addon root.
- Repository contains an `addons/<name>` directory.
- Repository contains multiple addons.
- Archive contains a wrapper directory.
- Package files must be remapped to a declared target directory.

Ambiguous layouts should fail with a useful error rather than guessing silently.

## 12. Dependency resolution

### 12.1 Resolution inputs

- Root manifest constraints
- Package metadata constraints
- Godot engine version
- Platform constraints, if introduced
- Existing lockfile preferences
- Source-specific available versions

### 12.2 Resolution outputs

- A complete directed acyclic dependency graph
- Exact immutable package identities
- Explanations for conflicts
- A deterministic lockfile

### 12.3 Solver requirements

- Support semantic version constraints where package versions exist.
- Detect cycles.
- Detect incompatible duplicate package identities.
- Prefer locked versions when still valid.
- Avoid unnecessary updates.
- Produce actionable conflict diagnostics.
- Be covered by unit and property-based tests.

Before implementing a custom solver, evaluate mature Rust libraries or a PubGrub-compatible implementation.

## 13. Content-addressed cache

The global cache should store immutable fetched and prepared package artifacts.

Example conceptual layout:

```text
~/.cache/wukong/
├── objects/
│   └── sha256/
├── git/
├── archives/
├── prepared/
├── metadata/
└── locks/
```

### 13.1 Cache requirements

- Content-addressed keys.
- Integrity verification on read.
- Concurrent process safety.
- Partial downloads must not appear as complete objects.
- Atomic object publication.
- Garbage collection based on reachability or last access.
- An offline mode.
- Cache inspection commands.
- Recovery from corrupted entries.

### 13.2 Project materialisation

Evaluate, in order:

1. Reflinks where safely available.
2. Hardlinks where semantics are acceptable.
3. File copies as the universal fallback.

Symlinks should not be the default because they can create portability and export issues.

## 14. Installation algorithm

A synchronisation operation should approximately:

1. Locate and parse the project manifest.
2. Locate and validate the lockfile.
3. Determine the selected dependency groups.
4. Fetch missing source artifacts into temporary locations.
5. Verify source integrity.
6. Prepare each package into a canonical package tree.
7. Compute package content hashes.
8. Construct the desired file ownership map.
9. Detect ownership conflicts.
10. Compare the desired state with the recorded installed state.
11. Materialise changes into a staging directory.
12. Atomically commit changes where possible.
13. Write installation metadata.
14. Remove stale package-owned files.
15. Leave unrelated user files untouched.

A failed operation must leave the project in its previous valid state whenever practical.

## 15. Installed-state tracking

The lockfile records desired dependency resolution, but an additional project-local state file may be required to track:

- Which files were materialised
- Which package owns each file
- Content hashes at installation time
- Installation strategy used
- Selected dependency groups

This state file should be machine-generated and may be placed under a tool-specific directory such as `.wukong/`.

The installer must not delete a file merely because it is absent from the new package version unless it can prove that the file was previously package-owned.

## 16. Security model

### 16.1 Threats

- ZIP Slip and archive path traversal
- Absolute archive paths
- Symlink escapes
- Hardlink attacks
- Case-insensitive path collisions
- Unicode path confusion
- Decompression bombs
- Malicious Git submodules
- Credential leakage in logs
- Checksum substitution
- Cache poisoning
- Package namespace confusion
- Overwriting project-owned files
- Unexpected executable hooks

### 16.2 Required controls

- Canonicalise and validate every extracted path.
- Reject paths outside the staging root.
- Define explicit limits for archive size, file count and expansion ratio.
- Treat symlinks conservatively.
- Do not initialise Git submodules by default.
- Redact credentials from displayed URLs.
- Require immutable commits in the lockfile.
- Verify cryptographic hashes.
- Publish cache objects atomically.
- Refuse file conflicts unless an explicit future override mechanism exists.
- Do not run package scripts in the initial product.

## 17. Cross-platform support

Initial target platforms:

- macOS
- Linux
- Windows

The codebase must account for:

- Case-sensitive and case-insensitive filesystems
- File locking differences
- Path separator differences
- Long paths
- Executable permission bits
- Symlink privileges
- Antivirus interference
- Atomic rename limitations
- Unicode filenames

CI should exercise all supported platforms from the beginning.

## 18. Godot integration

### 18.1 CLI integration

The CLI should be useful without an editor plugin.

It should:

- Detect `project.godot`.
- Read the configured Godot compatibility constraint.
- Support headless CI.
- Optionally invoke a Godot executable for validation.
- Avoid editing `project.godot` unless explicitly required.

### 18.2 Optional editor plugin

The editor plugin is a later milestone.

It should:

- Call the same core package-management engine.
- Display installed and outdated packages.
- Show dependency trees.
- Present conflicts and diagnostics.
- Avoid implementing its own resolver or installer.
- Be distributable independently from the CLI.

## 19. Testing strategy

### 19.1 Unit tests

Cover:

- Manifest parsing and validation
- Version constraints
- Package identifiers
- Source canonicalisation
- Graph construction
- Cycle detection
- Conflict explanations
- Lockfile serialisation
- Hashing
- Path validation
- Archive extraction
- Ownership maps
- Cache garbage collection

### 19.2 Property-based tests

Properties should include:

- Lockfile serialisation round-trips.
- Resolution output satisfies every declared constraint.
- Resolution is deterministic.
- Repeated `sync` is idempotent.
- Failed transactions do not corrupt a valid project.
- Install followed by removal restores the prior package-owned state.
- Equivalent source identifiers canonicalise identically.

### 19.3 Security tests

Include fixtures for:

- `../` traversal
- Absolute paths
- Nested malicious archives
- Symlink escapes
- Case collisions
- Unicode-normalisation collisions
- Excessive expansion ratios
- Corrupted checksums
- Interrupted downloads
- Poisoned cache entries

### 19.4 Integration tests

Test:

- Git tags
- Git commits
- Git repository subdirectories
- HTTP archives
- Local paths
- Offline mode
- Empty cache
- Warm cache
- Corrupted cache
- Concurrent installs
- Interrupted installs
- Manifest-lock mismatch
- Project file conflicts
- Multiple packages owning the same path

### 19.5 Real-world compatibility corpus

Create a pinned corpus of public Godot addons.

For each fixture, record:

- Source
- Immutable revision
- Expected package root
- Expected installed paths
- Supported Godot versions
- Whether headless import succeeds
- Known special handling

Start with 20 representative addons and expand towards 50–100.

## 20. Performance evaluation

Benchmarks should include:

- Manifest parse time
- Lockfile parse time
- Dependency resolution time
- Cold Git fetch
- Warm Git fetch
- Cold HTTP install
- Warm cached install
- Project materialisation time
- No-op `sync`
- Large dependency graph
- Many small files
- One large addon

Results must compare like-for-like workflows and disclose network conditions.

Suggested continuation thresholds:

- Deterministic output across repeated runs.
- A no-op sync that feels effectively immediate.
- At least a 5× improvement in package-manager-controlled warm-install work compared with a naïve implementation.
- At least a 50% end-to-end improvement in one common repeat-install workflow.
- Successful testing across at least 20 representative real-world projects.
- At least three unrelated external repositories willing to test the tool.

## 21. Observability and diagnostics

Support:

- Human-readable default output
- `--verbose`
- `--quiet`
- `--json`
- Structured error codes
- Optional trace logging
- A `wukong doctor` command
- Clear distinction between warnings and fatal errors

Diagnostics should include:

- What failed
- Which package caused it
- Which source was involved
- What state was modified
- Whether rollback succeeded
- A concrete recovery action

## 22. Privacy and telemetry

No telemetry in the initial implementation.

Any future telemetry must be:

- Opt-in
- Documented
- Minimal
- Free of package credentials and project paths
- Disableable through configuration and environment variables

## 23. Distribution

Initial distribution targets:

- GitHub Releases
- Homebrew
- Scoop
- Cargo installation, if appropriate
- Prebuilt binaries for supported platforms

Release artifacts should include:

- Checksums
- Reproducible build information where practical
- Changelog
- Migration notes
- Supported lockfile schema version

## 24. Documentation requirements

The repository should include:

- README with a 60-second quick start
- Installation guide
- Manifest reference
- Lockfile policy
- Source type reference
- Security model
- Troubleshooting guide
- Contributor guide
- Architecture document
- Benchmark methodology
- Compatibility corpus documentation

## 25. Success metrics

### Product metrics

- Number of external projects using `wukong`
- Number of external contributors
- Number of addon authors publishing package metadata
- Percentage of compatibility corpus installed successfully
- Percentage of issues reproducible through fixtures
- Median no-op sync time
- Warm install cache-hit rate

### Launch metrics

Treat these as directional rather than guaranteed:

- External testers before launch
- GitHub stars after launch
- Hacker News discussion quality
- Addon README integrations
- Mentions in Godot community channels
- Inclusion in project templates or starter repositories

## 26. Principal risks

### Risk: Existing Godot managers already cover enough use cases

Mitigation:

- Differentiate through transitive dependencies, deterministic lockfiles, safe atomic updates, provenance and multi-source support.
- Publish a comparison matrix based on implemented behaviour rather than marketing language.

### Risk: Official Godot infrastructure changes

Mitigation:

- Implement every package source behind an adapter interface.
- Keep Git and HTTP sources fully usable without official integration.

### Risk: Addon metadata is inconsistent

Mitigation:

- Support project-level declarations.
- Add layout overrides.
- Maintain a compatibility corpus.
- Introduce optional package-owned metadata gradually.

### Risk: The tool becomes a registry-maintenance project

Mitigation:

- Do not host a registry initially.
- Use existing Git hosts and official asset infrastructure.

### Risk: Speed advantage is too small

Mitigation:

- Position reproducibility as the primary product.
- Benchmark before making performance claims.
- Optimise repeated and CI installations where caching has clear value.

## 27. Initial release definition

Version `0.1.0` is successful when it can:

1. Initialise a Godot 4 project.
2. Add Git, HTTP archive and local path dependencies.
3. Pin every remote source immutably in a lockfile.
4. Synchronise the project deterministically.
5. Detect file conflicts.
6. Install from a global content-addressed cache.
7. Operate offline after a successful fetch.
8. Recover safely from interrupted installations.
9. Pass CI on macOS, Linux and Windows.
10. Install a representative corpus of at least 20 public addons.
11. Provide complete user and contributor documentation.
12. Avoid arbitrary package scripts.

## 28. Open design questions

These should be resolved through small prototypes and architecture decision records:

1. Should package names be globally unique, source-qualified or project-local?
2. Which semantic-version library and solver should be used?
3. How should non-versioned Git packages expose available versions?
4. Should GitHub shorthand be supported?
5. How should multi-addon repositories be modelled?
6. Should installed-state metadata be committed to version control?
7. When should checksums be required for remote sources?
8. Can reflinks or hardlinks be used safely by default?
9. How should Godot compatibility be inferred for packages without metadata?
10. Should the initial CLI be a single crate or a workspace with a reusable core library?
11. How should credentials for private repositories be delegated to Git?
12. What should the eventual official asset-source adapter depend on?
