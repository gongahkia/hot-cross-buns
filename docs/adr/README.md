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
- [0017: desired ownership maps](0017-ownership-maps.md)
- [0018: shared installed-file ownership](0018-shared-file-ownership.md)
- [0019: materialisation strategies](0019-materialisation-strategies.md)
- [0020: Git source canonicalisation](0020-git-source-canonicalisation.md)
- [0021: system Git fetching](0021-system-git-fetching.md)
- [0022: HTTP archive transport](0022-http-archive-transport.md)
- [0023: source-adapter cancellation](0023-source-adapter-cancellation.md)
- [0024: lockfile schema two remote sources](0024-lockfile-schema-two-remote-sources.md)
- [0025: dependency resolver strategy](0025-dependency-resolver-strategy.md)
- [0026: Git version discovery](0026-git-version-discovery.md)
- [0027: dependency mutation transaction](0027-dependency-mutation-transaction.md)
- [0028: optional headless validation execution](0028-headless-validation-execution.md)
- [0029: strict offline mode](0029-strict-offline-mode.md)
- [0030: advisory operation locks](0030-advisory-operation-locks.md)
- [0031: conservative cache maintenance](0031-conservative-cache-maintenance.md)
- [0032: credential handling](0032-credential-handling.md)
- [0033: hashed transaction recovery](0033-hashed-transaction-recovery.md)
- [0034: official Asset Library boundary](0034-official-asset-library-boundary.md)
- [0035: JSON metadata decoding](0035-json-metadata-decoding.md)
- [0036: CLI machine protocol](0036-cli-machine-protocol.md)
- [0037: release artifact layout](0037-release-artifact-layout.md)
- [0038: direct-dependency layout overrides](0038-direct-dependency-layout-overrides.md)
- [0039: 1.0 compatibility policy](0039-one-point-zero-compatibility-policy.md)
- [0040: direct-sync prepared-cache reuse](0040-direct-sync-prepared-cache-reuse.md)
- [0041: CLI progress rendering](0041-cli-progress-rendering.md)
- [0042: project source catalog](0042-project-source-catalog.md)
- [0043: strict package metadata policy](0043-strict-package-metadata-policy.md)
- [0044: catalog graph lockfile schema](0044-catalog-graph-lockfile-schema.md)
- [0045: catalog graph root provenance](0045-catalog-graph-root-provenance.md)
- [0046: native CLI progress and installed Godot workflows](0046-native-cli-progress-and-godot-workflows.md)
- [0047: managed Godot toolchains](0047-managed-godot-toolchains.md)

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
