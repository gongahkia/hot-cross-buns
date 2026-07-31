# Megastructure descriptor contract

Milestone 1 adds `WorldMegastructureGenerator`, an unused pure-data source for the first archetype: `ruined_transcontinental_spine` v1. It is not yet part of `WorldGenerator`, workers, streaming queues, collision, runtime scene attachment, or the procedural spawn path.

## Identity and canonical form

`generate(Vector3i)` accepts a canonical 4096-unit megacell. Descriptor identity contains only:

- decimal world seed;
- `WorldGenerator.GENERATOR_SCHEMA_VERSION`;
- canonical megacell coordinate;
- archetype id and version;
- descriptor schema version.

All descriptor values are JSON-safe dictionaries, arrays, strings, booleans, and integers. Spatial data uses integer `world_unit` coordinates; no `Node`, `Resource`, `Vector`, float, runtime object ID, cache state, global RNG, or loaded-neighbor state enters the descriptor.

`WorldMegastructureHash` serializes dictionary keys lexicographically, preserves ordered arrays, and hashes UTF-8 canonical JSON with SHA-256. Floats are intentionally rejected: a later descriptor schema must explicitly document any fixed-point unit before adding one.

Each generation stage derives an owned `WorldRng` seed from `WorldRng.thoth_hash` over the seed, all megacell coordinates, a fixed stage salt, archetype version, and descriptor schema version. It cannot consume shared RNG state.

## Initial archetype contract

The descriptor includes one opening `entry_transit` sector, a playable `elevated_spine_underpass` entry, and one `transcontinental_spine_continuation` reveal. The entry supplies approach, threshold bounds, post-threshold, first-goal, and reveal identity data.

Its ordered route array contains:

- mandatory walk baseline from approach through the opening sector;
- optional grapple shortcut, matching the existing `SpeedPlayer` ability;
- optional walk detour to a `warm_utility_refuge`, with declarative shelter, warmth, and exposure effects.

The values are planning data only. M2 owns visual realization; M3 owns chunk intersection; M5 owns analytic movement validation and survival runtime wiring.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_generator_test.gd
```

The test verifies canonical identity, descriptor hashing, entry/reveal/route contracts, fresh-data isolation, and equality across forward, reverse, and shuffled megacell generation orders.
