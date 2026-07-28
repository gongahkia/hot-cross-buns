# Security policy

## Reporting a vulnerability

Do not publish exploit details, credentials, private project files, package
contents, raw manifests, lockfiles, environment dumps, or process logs in a
public issue. Use a private GitHub security advisory for this repository:
<https://github.com/gongahkia/wukong/security/advisories/new>.

Include the affected revision, supported operating system, minimal redacted
reproduction, impact, and any proposed mitigation.

## Scope

Security-sensitive areas include manifest and lockfile parsing, filesystem
transactions, archive extraction, cache integrity, source credentials, and
installed-file ownership.

## Current status

Implemented controls include typed manifest/lock/state parsing, transactional
project synchronisation, ZIP extraction limits, content-addressed cache
verification, advisory operation locks, credential rejection/redaction, and no
package script execution. Wukong has no telemetry or crash-report upload path.
These controls are covered by local tests but are not security guarantees. See
the [threat model](docs/threat-model.md) for assumptions and residual risk.
The latest internal review is recorded in
[docs/security-review-2026-07.md](docs/security-review-2026-07.md).
