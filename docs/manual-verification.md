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
| 2026-08-06 synthetic-local | disposable local-addon fixture | macOS 26.5.2/APFS | 4.7.1.stable | `33327cdac1bf05c1631e6151d4e2b268156617b3` | `init`, `add`, `lock`, sync, frozen sync, `status`, `doctor`, cache verify, headless validate, `remove` | baseline editor run, materialisation tree, and post-removal tree inspected; headless validation passed in 1839 ms | Godot migrated `project.godot` from 4.0 input; `.godot/` and `scripts/main.gd.uid` observed after editor use, but sync-specific causality was not isolated | pass; numeric shell exits not captured |
| 2026-08-06 synthetic-rollback | disposable conflict-fixture clone | macOS 26.5.2/APFS | not opened | `33327cdac1bf05c1631e6151d4e2b268156617b3` | `init`, create project-owned target, `add --dev` | expected WUK001 conflict; project-owned file retained; manifest rolled back and lockfile absent | not applicable: Godot was not opened | pass; numeric shell exit not captured |
| 2026-08-06 real-project | public `godotengine/godot-demo-projects` `4.3` at `52e30044658448149b04e8f69b475eebbfbd8f6e`, `2d/dodge_the_creeps` | macOS 26.5.2/APFS | 4.7.1.stable | `33327cdac1bf05c1631e6151d4e2b268156617b3` | `init`, `add`, `lock`, sync, frozen sync, `status`, `doctor`, cache verify, headless validate, `remove` | baseline and post-removal start screens ran; materialisation tree inspected; headless validation passed in 1546 ms | `project.godot`, 12 asset import files, four script UID sidecars, and `.godot/` changed or appeared after editor use; sync-specific causality was not isolated | pass; numeric shell exits not captured |

Run each available row on macOS APFS, Linux, and Windows filesystems for every
reviewed Godot release. Add a dated row rather than overwriting an observation.

## Recorded details

### 2026-08-06 macOS local fixture

- The local package was validated before `init`. `add` completed with two files
  written; `lock` was unchanged; ordinary and frozen sync each reported zero
  written, two unchanged, and zero removed. Numerical shell exit statuses were
  not separately captured; these outcomes are from the command diagnostics.
- `status` reported the selected local package with SHA-256 source and package
  identities. `doctor` passed project, manifest, lockfile, installed-state,
  cache, filesystem, Godot-discovery, network-configuration, and lock checks.
  Cache verification reported 22 verified and zero corrupt objects.
- After materialisation, Godot showed `plugin.cfg` and `plugin.gd`. After a
  user comment was added to `plugin.gd`, `remove` removed only `plugin.cfg`;
  the edited script remained and the editor showed that remaining file. The
  final manifest retained an empty `[dev-dependencies]` table and the final
  lockfile was schema two with no package entries.
- The conflict fixture used the same package target. `add` returned WUK001 with
  `modified: none` and `rollback: not required`; the project-owned script was
  unchanged, no lockfile existed, and the manifest contained no dependency.

### 2026-08-06 macOS public project

- The public project was cloned at its recorded `4.3` branch revision, opened
  in Godot 4.7.1, and reached its start screen before Wukong changes. The
  package target was absent before `add`, present after materialisation, and
  empty after `remove`; the project returned to the start screen after removal.
- `add` wrote two files. `lock` was unchanged; ordinary and frozen sync each
  reported zero written, two unchanged, and zero removed. `status`, `doctor`,
  and cache verification reported the expected installed package, successful
  local checks, and 22 verified cache objects. Headless validation passed in
  1546 ms.
- After removal, the manifest retained an empty `[dev-dependencies]` table and
  the lockfile was schema two with no package entries. Numerical shell exit
  statuses were not separately captured; outcomes are from command diagnostics.

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
follow-up issue with redacted diagnostics.
