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

The package-management features are not implemented. Planned controls are
tracked in the PRD and TODO; they are not security guarantees until implemented
and tested.
