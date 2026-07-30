# Lithology generation

`WorldLithology.classify` ports the Thoth lithology table and decision order. It returns a deterministic rock ID, density, albedo, erodibility coefficient, and inherited plate age from plate/crust state plus climate, elevation, stability, rift, and island-arc inputs. `apply` writes the generated ID, erodibility coefficient, and age to a caller-owned cell. `refine` replaces dry, non-water cells without a downstream cell with evaporite.

The GDScript port uses snake-case field names: `erodibility_k`, `lithology_age`, and `down_cell`.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_lithology_test.gd
```

The fixture covers all oceanic and continental classification branches, source-derived hash decisions, property copy isolation, and dry-cell refinement. It exits non-zero on a mismatch.

## Dependencies

- Thoth-compatible hash/unit primitives for stable continental and boundary choices.
- Plate crust, age, and boundary fields; caller-supplied climate/elevation and tectonic inputs.

## Performance impact

Classification is constant-time scalar branching with at most one hash lookup. It allocates only its result dictionary; refinement mutates the supplied cell dictionary.

## Out of scope

- Soil production, erosion, hydrology, and biome selection.
- Terrain-generator integration, persistent lithology storage, and mesh/material rendering.
