# Security policy

## Reporting a vulnerability

Do not publish exploit details, credentials, private project files, or package
contents in a public issue. Use a private GitHub security advisory for this
repository: <https://github.com/gongahkia/wukong/security/advisories/new>.

Include the affected revision, supported operating system, minimal redacted
reproduction, impact, and any proposed mitigation.

## Scope

Security-sensitive areas include manifest and lockfile parsing, filesystem
transactions, archive extraction, cache integrity, source credentials, and
installed-file ownership.

## Current status

Implemented controls include typed manifest/lock/state parsing, transactional
project synchronisation, ZIP extraction limits, content-addressed cache
verification, advisory operation locks, credential redaction, and no package
script execution. They are covered by local tests but are not security
guarantees. See the [threat model](docs/threat-model.md) for assumptions and
residual risk.
