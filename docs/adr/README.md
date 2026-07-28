# Architecture decision records

ADRs capture consequential, durable technical decisions.

Current records:

- [0001: manifest v1 schema](0001-manifest-schema.md)
- [0002: manifest initialisation transaction](0002-manifest-initialisation-transaction.md)
- [0003: manifest edit transaction](0003-manifest-edit-transaction.md)
- [0004: package identity](0004-package-identity.md)
- [0005: source-adapter contract](0005-source-adapter-contract.md)
- [0006: local-path snapshot](0006-local-path-snapshot.md)
- [0007: ZIP extraction security](0007-zip-extraction-security.md)
- [0008: package layout detection](0008-package-layout-detection.md)
- [0009: package metadata schema](0009-package-metadata-schema.md)
- [0010: canonical package trees](0010-canonical-package-trees.md)
- [0011: compatibility-fixture schema](0011-compatibility-fixture-schema.md)
- [0012: lockfile schema](0012-lockfile-schema.md)
- [0013: cache layout](0013-cache-layout.md)
- [0014: cache publication](0014-cache-publication.md)
- [0015: cache integrity verification](0015-cache-integrity-verification.md)
- [0016: installed-state schema](0016-installed-state-schema.md)

## When to write an ADR

Create one before changing manifest or lockfile formats, package identity,
source-adapter interfaces, cache keys, filesystem transactions, dependency
solving, Git strategy, security policy, or cross-platform support policy.

## Format

Name records `NNNN-short-title.md`, using the next four-digit sequence. Each
record must contain:

1. Status: proposed, accepted, superseded, or rejected.
2. Context and constraints.
3. Decision.
4. Consequences and alternatives considered.
5. Migration or compatibility impact, when relevant.

ADRs are immutable after acceptance except for status transitions or factual
corrections. A replacement ADR must link to the decision it supersedes.
