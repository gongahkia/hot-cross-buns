# Manual verification matrix

Schema version: 1. This matrix records human Godot validation separately from
automated tests. `not-run` is not compatibility evidence.

## Fixture policy

Use a copied or disposable Godot project. Do not record source URLs,
credentials, cache paths, private scenes, or generated `.godot` contents. A
real-project row identifies only a public project or a redacted project class.

| ID | Project | Platform/filesystem | Godot | Wukong | Commands | Headless/editor result | Generated-state change | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic-local | `fixtures/validation/minimal` plus local addon | `<os>/<fs>` | `<version>` | `<commit>` | sequence below | `<pass/fail>` | `<none/describe>` | not-run |
| synthetic-rollback | disposable conflict fixture | `<os>/<fs>` | `<version>` | `<commit>` | rollback sequence below | `<pass/fail>` | `<none/describe>` | not-run |
| real-project | `<public id or redacted class>` | `<os>/<fs>` | `<version>` | `<commit>` | sequence below | `<pass/fail>` | `<none/describe>` | not-run |

Run each available row on macOS APFS, Linux, and Windows filesystems for every
reviewed Godot release. Add a dated row rather than overwriting an observation.

## Reproducible sequence

From a disposable project copy with a package-free local addon at
`../local-addon`:

```sh
wukong init --project . --non-interactive
wukong add local-addon --path ../local-addon --dev --project .
wukong lock --project .
wukong sync --dev --project .
wukong sync --frozen --dev --project .
wukong status --project .
wukong doctor --project .
wukong cache verify
wukong validate --project . --godot-executable <godot> --timeout-seconds 60
wukong remove local-addon --dev --project .
```

After every sync and removal, open the project in the Godot editor, inspect the
addon tree, and record whether Godot changed derived `.godot` state. Capture
only redacted command output sufficient to identify the command, exit status,
diagnostic code, and rollback status.

## Conflict and rollback sequence

Before the first sync, create a project-owned file at the package target. Run
`wukong sync --dev --project .`; it must report a conflict and preserve that
file. Remove the fixture conflict, sync successfully, edit a materialised file
as a user, then remove the package. Record that the user edit remains and that
the resulting installed state is valid. Treat an unexpected project mutation as
a security-sensitive defect and add a minimal fixture before retrying.

## Recording requirements

Each completed row records the exact Wukong commit, Godot version, operating
system, filesystem, manifest/lockfile shape, command exit status, observed
diagnostic, rollback result, and editor result. Failed rows require a focused
follow-up issue with redacted diagnostics. This document intentionally contains
no completed rows yet.
