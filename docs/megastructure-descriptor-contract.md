# Megastructure descriptor contract

`WorldMegastructureGenerator` is the pure-data source for the first archetype: `ruined_transcontinental_spine` v1. `WorldGenerator` consumes its M3 intersections for local procedural chunk descriptors; workers carry the resulting data unchanged. Scene attachment remains owned by `WorldStreamer` and its existing M4 queue categories.

## Identity and canonical form

`generate(Vector3i)` accepts a canonical 4096-unit megacell. Descriptor schema v6 identity contains only:

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

The v3 grapple shortcut is one 18-unit lateral-forward commitment with its reachable anchor carried through chunk compilation to runtime attachment. It replaces the v2 long-distance placeholder, which could not be acquired within `SpeedPlayer.GRAPPLE_RANGE`. Schema v4 adds its explicit floor-supported recovery volume for route-preservation revalidation. Schema v5 adds threshold and grapple-affordance visibility distances.

Schema v6 adds the ordered construction epochs consumed by M6 transformations. Schema v7 adds their canonical attachment/cut elements. Schema v8 adds constrained off-route damage records. Schema v9 derives route-safe hydrology from that damage. Schema v10 derives ecological reclamation from material, water, light, and exposure. Schema v11 binds the warm-refuge detour to utility history. Their relationships are declared in [megastructure-construction-history.md](megastructure-construction-history.md).

The values are planning data only. M2 owns visual realization; M3 owns chunk intersection; M5 owns analytic movement validation and survival runtime wiring.

## Enclosed interior

The descriptor's `interior` contract defines a `flat_enclosed_floor` at `24 world_unit` and ceiling at `100 world_unit`. It is authoritative generation data, not an M2 visual offset: M3 terrain and collision use the floor in every touched macro chunk, and ordinary biome features are suppressed there. The entry prototype encloses the route with its walls and long overhead deck, so the generated opening is occupied from within rather than suspended above ordinary terrain.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_generator_test.gd
```

The test verifies canonical identity, descriptor hashing, entry/reveal/route contracts, fresh-data isolation, and equality across forward, reverse, and shuffled megacell generation orders.
