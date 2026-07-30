# Save-file migration and version policy

## Save envelope

Local persistent state is stored in a versioned envelope, distinct from individual run-record schemas:

```json
{
  "schema": "save-envelope/v1",
  "written_at": "optional ISO-8601",
  "active_run_id": "optional opaque ID",
  "runs": [],
  "settings": {},
  "integrity": {"canonical_hash_algorithm": "sha256", "canonical_hash": "hex"}
}
```

`runs` contain versioned run records. Local settings remain non-authoritative and cannot modify a run’s world/ruleset identity. An opaque run ID may identify a local artifact but is excluded from deterministic replay state.

## Version rules

| Change | Save-envelope action | Reader behavior |
| --- | --- | --- |
| Internal code refactor with identical serialized bytes | none | read normally |
| Add optional field with deterministic/default-safe meaning | minor-compatible reader | fill documented default in memory |
| Add a required field or change validation | new minor schema plus explicit migration | migrate copy, then validate |
| Change meaning/type/unit, hash/canonical encoding, or nested authoritative schema interpretation | new major schema | explicit migration or safe rejection |
| Remove data | new major schema | retain original record until migration verified |

The writer always emits the current schema. Readers support the current schema and an explicitly enumerated migration window; unknown future schemas are rejected as read-only/incompatible rather than truncated or rewritten.

## Migration procedure

1. Read bytes without modifying the source and validate size limit, syntax, schema identifier, and integrity hash.
2. Parse into a neutral data structure; reject duplicate critical keys, invalid types, unbounded arrays, or malformed identity fields.
3. Select an explicit `from → to` migration. Each migration is pure, deterministic, and idempotent for a given source version.
4. Preserve the source file as a recoverable generation. Write the migrated output as a new candidate, validate it with the current schema, then promote it through the crash-safe recovery protocol.
5. Retain provenance in metadata: source schema, source hash, migration ID, and migration timestamp. Provenance is not part of replay identity.
6. If migration cannot preserve authoritative world/ruleset meaning, archive the source and present an incompatibility result; do not regenerate or reinterpret the run.

## Validation and limits

- Use strict UTF-8 JSON or a documented replacement format; never execute serialized text.
- Bound total file bytes, run count, replay bytes, metadata bytes, nesting depth, string length, and numeric ranges before full allocation.
- Validate the full world identity, canonical coordinate format, fixed-point units, ordering, and record integrity of every nested run.
- Apply migrations before attaching saved state to the scene tree or autoloads.
- A failed migration has no side effect on the active source or last-known-good save.

## Compatibility report

The load result contains one of: `current`, `migrated`, `read_only_incompatible`, `corrupt_recoverable`, or `missing`. The UI can show this status and offer recovery/export/new-run actions without claiming that an incompatible record is playable.

## Verification

Headless fixtures cover current round trips, every supported source migration, default insertion, idempotence, source preservation, oversized/malformed files, future schema rejection, nested run-record mismatch, and failed promotion. Fixtures assert bytes/hash of source files stay unchanged when migration fails.

## Dependencies

- Run-record schema, deterministic identity policy, atomic save recovery, settings serialization, and local archive contracts.
- A bounded parser plus a file replacement mechanism that can retain a last-known-good file.

## Performance impact

Migration occurs on load or explicit upgrade, never per frame. File and collection limits bound parsing/allocation; large replay payloads are streamed or rejected before resident-memory caps are exceeded.

## Out of scope

- Cloud conflict resolution, account identity, encryption, signing, or anti-tamper guarantees.
- Migrating arbitrary prototype/third-party save files.
- Silently adapting a run to changed generator or gameplay semantics.
