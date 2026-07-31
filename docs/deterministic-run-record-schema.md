# Deterministic replay and run-record schema

## Scope

Schema `run-record/v1` stores a completed, failed, extracted, or in-progress expedition summary and, when enabled, a deterministic input replay. It separates authoritative simulation data from display metadata so timestamps, thumbnails, device settings, and local file paths cannot change replay identity.

## Envelope

```json
{
  "schema": "run-record/v1",
  "world": {
    "seed": "20260730",
    "generator_schema_version": "2.0.0",
    "generation_options": {"canonical": "values"}
  },
  "ruleset_version": "1.0.0",
  "simulation": {"tick_hz": 60, "start_tick": 0},
  "run": {"outcome": "active|extracted|failed|abandoned", "summary": {}},
  "replay": {"input_spans": [], "checkpoints": []},
  "integrity": {"canonical_hash_algorithm": "sha256", "canonical_hash": "hex"},
  "metadata": {"created_at": "optional ISO-8601", "display_name": "optional"}
}
```

All required keys exist even when their arrays/dictionaries are empty. Unknown keys are rejected from authoritative sections and permitted only in namespaced metadata extensions (`metadata.extensions.<producer>`) after size validation.

## Authoritative fields

| Path | Type/rule | Meaning |
| --- | --- | --- |
| `world.seed` | decimal signed-64-bit integer string | world seed, never a JSON number |
| `world.generator_schema_version` | semantic version string | generation compatibility boundary |
| `world.generation_options` | canonical object | all and only generation-affecting options |
| `ruleset_version` | semantic version string | movement/survival/gameplay replay boundary |
| `simulation.tick_hz` | positive integer | fixed simulation tick rate |
| `simulation.start_tick` | non-negative int64 | replay timeline origin |
| `run.outcome` | enum | `active`, `extracted`, `failed`, or `abandoned` |
| `run.summary` | canonical object | fixed-point elapsed time, start/end canonical coordinates, inventory/resource totals, discoveries, survival state, and outcome data |
| `replay.input_spans` | tick-ordered array | run-length encoded actions/quantized look input; spans cannot overlap or leave an ambiguous gap |
| `replay.checkpoints` | tick-ordered array | `{tick, state_hash}` samples used to locate divergence |
| `integrity.canonical_hash` | lowercase hex | SHA-256 of the canonical authoritative payload excluding `integrity` and `metadata` |

Coordinates use the chunk-index plus normalized fixed-point offset format in the world-coordinate policy. Durations, meters, meters-per-second, vitality, and look deltas use named fixed-point units; JSON floats are forbidden from authoritative data.

## Canonical encoding

1. Serialize authoritative dictionary keys in UTF-8 bytewise ascending order.
2. Serialize integer strings without leading `+`, whitespace, or unnecessary leading zeroes.
3. Preserve declared array order; resource/discovery maps use sorted keys, not insertion order.
4. Encode input actions as a documented bitmask and look as signed fixed-point integers.
5. Build the SHA-256 input from UTF-8 canonical JSON bytes. The resulting hash detects accidental corruption; it is not a signature or anti-cheat mechanism.

## Replay procedure

Loaders reject a replay unless the schema, full world identity, ruleset version, tick rate, and canonical hash are compatible. Start from the recorded canonical start state, apply input spans one fixed tick at a time, and compare each checkpoint hash. On divergence, stop validation and report the first mismatching checkpoint; do not silently substitute a current-world simulation.

A record without replay spans remains a valid records-only run archive. A replay cannot rely on frame delta, wall time, input-device polling order, unordered container iteration, live streaming completion order, photo mode, or GPU output.

## Compatibility and migration

- Additive metadata-only changes preserve `run-record/v1` compatibility.
- Additive authoritative fields require documented defaults and a compatible minor reader update.
- Reinterpreting a field, changing canonical units/hash, world identity, or ruleset semantics requires a new major schema and explicit migration/rejection.
- Migrations produce a new record with the original source schema/version retained in metadata; they never overwrite the only recoverable local copy.

## Verification

Headless fixtures must validate canonical byte output, parse rejection cases, hash stability, negative coordinates, ordered input spans, summary-only records, replay checkpoints, and an intentional version mismatch. Replay tests use fixed ticks and compare descriptor/state hashes, not screenshots or frame timing.

## Dependencies

- Seed/version, coordinate/origin, save migration/recovery, survival/inventory, run archive, photo metadata, and deterministic test contracts.
- A Godot-owned SHA-256 implementation and fixed-tick simulation boundary.

## Performance impact

Input spans and periodic hashes are bounded by recording duration and checkpoint cadence. Writers stream/cap replay data or compact contiguous spans; loaders validate incrementally rather than allocating an unbounded parsed replay.

## Out of scope

- Network authority, anti-cheat, cryptographic signing, multiplayer rollback, or cloud sync.
- Exact replay of graphics, audio, physics-contact order, UI animations, or photo captures.
- Automatic compatibility with changed generator/ruleset semantics.
