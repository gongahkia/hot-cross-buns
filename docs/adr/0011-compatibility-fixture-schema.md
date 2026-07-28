# ADR 0011: compatibility-fixture schema

## Status

Accepted

## Context

The compatibility corpus needs reviewable, reproducible records for public
addons before dependency resolution exists. A fixture must distinguish a public
source location from the immutable revision and expected prepared output.

## Decision

Store schema-one fixtures as UTF-8 TOML under `fixtures/compatibility/v1/`.
Each fixture has a canonical id, a public HTTPS Git URL and a 40-character Git
commit, explicit source subdirectory and target paths, a sorted complete list
of installed file paths, the W033 SHA-256 tree hash, and a Godot semantic-version
requirement. A headless validation command is optional and stored only as an
argument vector.

Parsing rejects unknown fields, malformed revisions or hashes, unsafe paths,
unsorted or duplicate installed paths, credential-bearing URLs, and invalid
version requirements. The verifier accepts already checked-out local sources;
it performs no network I/O and never executes a declared headless command.

## Consequences

Fixtures are independently reviewable and can validate W031 layout selection
and W033 content preparation later. Refreshing a fixture requires a new pinned
commit and recomputed expected output. Headless validation remains explicitly
opt-in under its later TODO issue.

## Alternatives considered

- Use mutable branch names: rejected because they cannot reproduce a source.
- Fetch during normal tests: rejected because test results would depend on
  network availability and remote state.
- Store a shell command: rejected because a structured argument vector avoids
  shell interpretation and makes the non-execution policy clear.

## Migration and compatibility impact

New fixture semantics require a new schema version and migration documentation.
Existing schema-one fixtures remain immutable historical compatibility evidence.
