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

## Observed local result

The following is one reproducible local observation, not a supported
cross-platform limit. The package-management core was at commit
`6a1f29be34ee0f034af1d6aed5bf8135c3ee6bcd`; the worktree also contained the
observation-only harness instrumentation described below. It used Rust 1.85.0
on macOS 26.5.2, APFS, Apple M3, and 16 GB of memory:

```sh
/usr/bin/time -l cargo +1.85.0 test -p wukong-core --test stress_harness -- --nocapture
```

The command completed in 25.00 seconds, with a 173 MiB maximum resident set
size. The observation lines below are emitted immediately before each
temporary project is cleaned up. Direct local dependencies deliberately use no
shared package cache, so every cache-size value is zero.

| Fixture/count/shape | Project size | Fresh writes | Diagnostic/rollback | Final verification |
| --- | ---: | ---: | --- | --- |
| 500 local dependency roots | 479,995 B | 1,000 | none / not required | lock, state, fresh sync, and no-op sync passed |
| 512 small files plus one 8 MiB addon | 33,684,641 B | 515 | none / not required | exact large-file size and final small file passed |
| 24-level Unicode path | 1,317 B | 2 | none / not required | exact Unicode path and content passed |
| 16 aliases from one local source | 15,475 B | 32 | none / not required | independent targets and no-op sync passed |

The raw terminal capture is deliberately not committed because it includes
host-specific diagnostics. Reproduce it with the exact command above and keep
the redacted raw output beside any future published row. No safety or
correctness failure occurred in this observation.

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

Observed limits: one macOS/APFS local-path observation reached 500 dependency
roots, 512 small files, an 8 MiB addon, a 24-level Unicode path, and 16
aliases. This is not evidence for Linux, Windows, remote sources, or a
supported universal limit.
