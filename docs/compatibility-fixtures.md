# Compatibility fixtures

Schema-one fixtures live in `fixtures/compatibility/v1/`. Every fixture pins a
public HTTPS Git source to a full commit and records its explicit layout,
complete expected installed file paths, canonical package-tree SHA-256, and
Godot version requirement.

Fixtures are parsed in ordinary tests. Source verification is opt-in and uses
only manually checked-out local repositories:

```text
WUKONG_COMPATIBILITY_SOURCES=/absolute/path cargo test -p wukong-core --test compatibility_fixture -- --ignored
```

The directory must contain one source checkout per fixture id, at the exact
recorded commit. The verifier does not fetch a source and does not execute
`headless_validation`; that command is retained only for later explicit Godot
validation work. See [ADR 0011](adr/0011-compatibility-fixture-schema.md).
