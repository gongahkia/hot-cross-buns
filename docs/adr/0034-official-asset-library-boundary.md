# ADR 0034: Official Asset Library boundary

## Status

Accepted

## Context

Godot AssetLib exposes read endpoints that identify an asset with `asset_id`
and return a download URL, download commit, and optional archive hash. The
official service leaves the archive-hash field empty. Its backend is in
maintenance mode and planned for future deprecation.

Wukong requires immutable lock identities, verified cache objects, no persisted
credentials, and no registry-specific fields in generic resolver or lockfile
types.

## Decision

Implement any AssetLib integration behind an opt-in feature flag. It may use
the public read API only. Authentication and write endpoints are out of scope.

The adapter resolves an `asset_id` to metadata, stages the selected artifact,
computes SHA-256 from its bytes, and translates the result into the existing
generic checksum-addressed HTTP artifact path. The lockfile records that
generic immutable artifact identity; it does not gain AssetLib-specific source
types. AssetLib metadata is cacheable only for an operation until a stable
upstream cache and rate-limit policy exists.

`--locked` and offline installation use the locked generic artifact and never
query AssetLib. The adapter reports an incomplete-upstream diagnostic when the
ID, type, URL, or staged artifact cannot meet these requirements.

## Consequences

An AssetLib entry can be reproducible after locking even though the upstream
does not supply a digest. Initial locking needs one verified artifact download.
Search and version discovery remain provider-specific conveniences and do not
enter generic resolver logic. The feature flag gives users a safe default if
the upstream is replaced or changes incompatibly.

## Alternatives considered

- Lock only the asset ID or displayed version: rejected because either can be
  changed upstream without preserving artifact bytes.
- Trust `download_commit` or the generated URL alone: rejected because neither
  is an artifact checksum and the API documents an empty official hash.
- Add AssetLib fields to generic lockfile source types: rejected because other
  source adapters do not need those fields.
- Persist authenticated sessions: rejected because read-only locking needs no
  credentials and credential persistence violates Wukong security constraints.

## Migration and compatibility impact

No schema changes occur in this research decision. A future feature-gated
adapter may add a manifest declaration while translating its selected artifact
to the existing immutable HTTP lock representation.
