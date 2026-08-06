# Stress-test ledger

Schema version: 1. This is the reproducible results ledger for issue #3. It
separates automated regression coverage from observed limits; `not-run` does
not establish a supported limit.

## Automated matrix

| Scenario | Coverage | Invariant |
| --- | --- | --- |
| Local counts | `stress_harness` at 1, 10, 100, 500 | fresh sync, no-op, lockfile, and installed state agree |
| Package shapes | `stress_harness` many-small, large, deep/Unicode, portable long path | exact files materialise without path loss |
| Target conflicts | `native_transaction_fixtures` | conflicts precede project mutation and user edits survive removal |
| Frozen/offline | `direct_sync` and source-adapter tests | unavailable immutable sources fail before mutation |
| Cache corruption/interruption | cache, Git, HTTP, and native transaction tests | corrupt or interrupted state is not reused |
| Shared cache/processes | Git and catalog acquisition tests | concurrent publication converges on verified objects |

Pinned public Git and checksummed HTTPS scenarios remain opt-in: configure only
credential-free immutable inputs and record their full raw result directory.

## Result row template

Create one row per platform, filesystem, fixture, cache state, and source type.
Never replace a prior row or include credentials, private source paths, or raw
project content.

| Date | Commit | OS/filesystem | Fixture/count/shape | Source/cache state | Elapsed | Peak memory | Project/cache size | Writes | Diagnostic/rollback | Final verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<date>` | `<commit>` | `<os>/<fs>` | `<fixture>` | `<source>/<state>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<pass/fail>` | not-run |

Store complete redacted raw observations beside the row. Record the command,
Rust version, host details, and network conditions using the benchmark
collector's metadata format. For a new correctness or safety failure, add a
regression fixture before raising any observed limit.

## Limits

Supported limits: no documented scale limit.

Observed limits: no reviewed cross-platform result rows.
