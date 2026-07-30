# Plate-center generation and cache

`WorldPlates` deterministically creates a plate-center record from `(seed, cell_x, cell_z)`:

- `id` is the signed Thoth hash with salt `37`.
- `x`/`z` are the cell midpoint plus independently seeded jitter at salts `11` and `23`.
- `center_at(world_x, world_z)` uses floor cell coordinates, including negative world positions.

Each instance owns a bounded least-recently-used cache. Returned records are copies, so a caller cannot mutate cached plate data. A cache capacity of `0` disables retention while preserving deterministic center generation.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_plates_test.gd
```

The headless fixture checks LuaJIT-derived centers, negative coordinate lookup, cache-copy isolation, LRU eviction order, cache clearing, and disabled-cache behavior. It exits non-zero on a mismatch.

## Dependencies

- `WorldRng.thoth_hash` and `thoth_signed` for the historical plate-center stream.
- A fixed cell size shared by later plate lookup/classification code; the legacy default is `640` world units.

## Performance impact

A cache miss performs three deterministic hash samples; a hit only copies a small dictionary. LRU recency updates use a bounded linear array, so choose a practical cache capacity and avoid calling `clear_cache()` in hot paths.

## Out of scope

- Nearest-plate selection, plate velocity/crust/age, boundary classification, drift, and geology integration.
- Sharing mutable cache instances across threads.
- Persisting cache records or using cache state as generation identity.
