# Internal security review — 2026-07-29

## Scope and method

This is an internal static review of the Rust implementation and local tests.
It is not an independent audit, penetration test, or guarantee of security.
The review covered `archive.rs`, `project_sync.rs`, `transactional_file.rs`,
`cache.rs`, `operation_lock.rs`, `credentials.rs`, `git_fetch.rs`,
`http_archive.rs`, `direct_lock.rs`, and `direct_sync.rs`, plus their focused
tests and bounded fuzz targets.

## Finding and remediation

### R-001: recovery could delete a concurrent edit

An incomplete transaction journal recorded only output paths. Recovery removed
such an output before restoring a rollback copy, so a user edit made after an
interruption could have been deleted. Journal `v2` now records a SHA-256 for
every written regular file. Recovery removes an output only if its type and
hash still match; otherwise it preserves the file and transaction for manual
resolution. Legacy `v1` journals fail closed when a published output cannot be
verified. Regression tests cover both a concurrent edit and legacy recovery.
See [ADR 0033](adr/0033-hashed-transaction-recovery.md).

## Review results

| Area | Reviewed controls | Result and residual risk |
| --- | --- | --- |
| Archive handling | ZIP preflight rejects unsafe paths, links, special files, duplicates, file/size/ratio limits; extraction is confined to a new staging root. | Bounded archive fuzzing and regression tests run locally. Archive parser/library defects and untested hostile-platform behavior remain possible. |
| Filesystem transactions | Ownership validation precedes mutation; writes stage first; journal rollback restores prior files; state publishes last; R-001 was remediated. | Crash durability still depends on filesystem rename and flush semantics. Legacy incomplete `v1` transactions may require manual resolution. |
| Cache races | Content-addressed objects are verified before use/publication; scoped advisory locks protect competing cache work; cleanup is conservative. | Advisory locks coordinate Wukong processes only; a local actor with cache write access can deny service or alter inputs. |
| Credentials | Manifests/lockfiles reject credential-bearing sources; diagnostics redact URL/header secrets; HTTP accepts no configured headers; Git delegates to user configuration. | Git helpers, proxies, TLS roots, and user-supplied environment configuration remain outside Wukong's control. |
| Update and rollback | Add/remove/update retain manifest and lockfile snapshots; project sync recovery is journaled; update tests cover selected-update rollback and dry runs. | The multi-file mutation is not filesystem-wide atomic across process crash boundaries. |

## Validation evidence

The local validation suite was run after R-001 remediation: formatting, native
workspace build/test/lint, dependency audits for both lockfiles, and Windows
cross-target lint. Networked public-source tests remain ignored by design;
Linux execution was not run on this macOS host.

## Follow-up

No independent external review is recorded in this repository. Before a 1.0
release, obtain an independent review and repeat this review after any change
to archive extraction, transactions, cache synchronization, credentials, or
source transport.
