# AGENTS.md

This file defines how coding agents should work in this repository.

## Project objective

Build a fast, reproducible package and dependency manager for Godot 4 addons.

The working executable name is `wukong`.

The primary product value is:

> Reproducible, declarative Godot addon management.

Speed is secondary and must be supported by honest benchmarks.

## Required reading order

Before changing code, read:

1. `PRD.md`
2. `TODO.md`
3. `docs/architecture.md`, once created
4. Relevant architecture decision records under `docs/adr/`
5. Existing tests near the code being changed

## Core constraints

- Use Rust.
- Support macOS, Linux and Windows.
- Do not execute arbitrary package scripts.
- Do not add a hosted package registry.
- Do not silently overwrite project-owned files.
- Do not delete files unless package ownership is proven.
- Do not store credentials in manifests, lockfiles, logs or cache metadata.
- Do not use mutable Git branches as immutable lockfile identities.
- Do not make performance claims without reproducible benchmarks.
- Do not duplicate package-management logic in a future editor plugin.
- Do not implement speculative features outside the current TODO phase.

## Engineering priorities

Use this order when priorities conflict:

1. Data safety
2. Security
3. Deterministic behaviour
4. Compatibility
5. Clear diagnostics
6. Maintainability
7. Performance
8. Convenience

## Working method

For each task:

1. Identify the smallest vertical change that satisfies part of the requirement.
2. Inspect existing architecture and tests.
3. State assumptions in the pull-request or commit description.
4. Add or update tests before considering the task complete.
5. Update documentation for externally visible behaviour.
6. Run the complete local validation suite.
7. Report any unresolved risk or platform limitation explicitly.

Do not mark a TODO item complete merely because code was written.

## Scope discipline

Before starting a task, identify its issue ID from `TODO.md`.

Avoid combining unrelated issue IDs in one change.

Create an ADR when changing:

- Manifest or lockfile formats
- Package identity rules
- Source-adapter interfaces
- Cache key design
- Filesystem transaction design
- Dependency solver
- Git implementation strategy
- Security policy
- Cross-platform support policy

## Architecture expectations

Prefer a reusable core library and a thin CLI.

Suggested boundaries:

```text
wukong-core
├── project discovery
├── manifest
├── lockfile
├── package identity
├── source adapters
├── package preparation
├── resolver
├── cache
├── ownership map
├── materialisation
├── transactions
└── diagnostics

wukong-cli
├── argument parsing
├── human output
├── JSON output
├── progress rendering
└── exit codes
```

Domain types must not depend on terminal-rendering concerns.

Source adapters must not leak source-specific fields into generic resolver logic.

## Coding standards

- Prefer explicit domain types over raw strings.
- Use path types rather than string concatenation.
- Keep filesystem mutation behind narrow interfaces.
- Make operations cancellable where practical.
- Avoid global mutable state.
- Use deterministic collection ordering for persisted output.
- Avoid panics for user-controlled input.
- Add context to I/O errors.
- Redact secrets before formatting URLs.
- Treat warnings as errors in CI.
- Keep public APIs documented.
- Avoid unsafe Rust unless a written justification is added.

## Testing requirements

Every user-visible change requires tests.

### Unit tests

Use for:

- Parsing
- Validation
- Canonicalisation
- Hashing
- Graph logic
- Serialisation
- Path rules
- Error mapping

### Property-based tests

Use for:

- Deterministic serialisation
- Resolver correctness
- Path canonicalisation
- Idempotence
- Transaction invariants
- Install/remove state transitions

### Integration tests

Use temporary directories and real filesystems.

Test at minimum:

- Fresh install
- Warm cache
- No-op sync
- Failed sync
- Conflict detection
- Safe removal
- Offline mode
- Concurrent process behaviour
- Cross-platform path behaviour

### Security regression tests

Every security-sensitive bug must add a fixture.

Never remove a security fixture merely to simplify implementation.

## Core invariants

The following invariants must remain true:

1. The same manifest, lockfile and source content produce the same desired package state.
2. Repeated `wukong sync` is idempotent.
3. A failed operation does not leave a partially valid installed state.
4. Unrelated project files are never deleted.
5. Package file conflicts are detected before destructive mutation.
6. Lockfiles contain immutable source identities.
7. Cache objects are verified before use.
8. Credentials are not persisted or displayed.
9. Package scripts are not executed.
10. Persisted output uses deterministic ordering.

Tests should name the invariant they protect.

## Filesystem safety

All installation work should occur through a transaction abstraction.

Expected pattern:

1. Calculate desired state.
2. Validate conflicts.
3. Prepare staged files.
4. Verify staged state.
5. Commit.
6. Write state metadata.
7. Clean old package-owned files safely.

Do not mutate the project incrementally while dependency fetching or validation is still in progress.

Archive extraction must remain inside a staging root after path canonicalisation.

## Dependencies

When adding a dependency:

- Explain why the standard library is insufficient.
- Prefer maintained, narrowly scoped crates.
- Review licence compatibility.
- Avoid crates that introduce unnecessary native dependencies.
- Pin behaviour through tests rather than relying on undocumented assumptions.
- Record dependency choices affecting architecture in an ADR.

Do not implement a custom semantic-version solver before evaluating mature implementations.

## Command behaviour

Commands should support predictable automation.

Where relevant, provide:

- Non-interactive operation
- Stable exit codes
- `--json`
- `--quiet`
- `--verbose`
- `--offline`
- `--locked`

Human-readable output may evolve before `1.0`; machine-readable output must be explicitly versioned once declared stable.

## Error messages

Errors should answer:

1. What failed?
2. Which package or source caused it?
3. What was modified?
4. Did rollback succeed?
5. What should the user do next?

Do not expose raw backtraces by default.

## Performance

Optimise only measured bottlenecks.

Benchmarks must distinguish:

- Resolution
- Download
- Extraction
- Hashing
- Cache access
- Materialisation
- Complete cold operation
- Complete warm operation

Do not trade correctness or atomicity for marginal benchmark gains.

## Documentation

Update documentation in the same change when modifying:

- Commands
- Manifest fields
- Lockfile fields
- Security behaviour
- Cache behaviour
- Platform support
- Exit codes
- Error recovery

Examples in documentation should be executable or covered by tests where practical.

## Commit and change reporting

At the end of a coding task, report:

- Issue ID
- Files changed
- Behaviour implemented
- Tests added
- Commands run
- Remaining limitations
- Suggested next issue ID

Do not claim completion when required platform tests were not run. State exactly which checks were performed.

## First task

Begin with the “Suggested first implementation slice” at the end of `TODO.md`.

The first implementation should support one local path dependency end to end before adding remote package sources.
