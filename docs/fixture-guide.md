# Fixture guide

Use the smallest deterministic fixture that proves the invariant. Unit and
integration fixtures belong beside the affected crate tests; fuzz seeds belong
under `fuzz/corpus/`; compatibility fixtures belong under
`fixtures/compatibility/v1/`.

Compatibility fixture entries must pin a public source to a complete immutable
commit, state the selected layout and target paths explicitly, list every
expected installed path, record the canonical tree SHA-256, and declare the
Godot requirement. Never add credentials, private URLs, mutable branches,
timestamps, or package scripts.

Test normal fixture parsing in the standard suite. Opt-in source verification
must use a manually checked-out exact source and must not fetch or execute
Godot. See [compatibility fixtures](compatibility-fixtures.md) and
[fuzzing](fuzzing.md).

## Compatibility corpus process

Before adding an external repository, verify that its licence and access terms
permit recording the immutable public fixture metadata. Record the observed
layout rather than guessing it. If a source changes, do not rewrite history:
add a new reviewed fixture revision or remove only data this repository owns.
Run the opt-in verification where the exact source checkout and Godot runtime
are available, then record the result and limitations in the fixture guide.
