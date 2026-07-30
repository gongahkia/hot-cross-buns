# Urban land-use and ruin-age fields

`WorldUrbanFields` derives a deterministic `land_use` class and `ruin_age_years` per urban chunk. `WorldGenerator.chunk_descriptor` adds the `urban` field only for reclaimed city, flooded city, industrial ruin, and overgrown suburb families.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_urban_fields_test.gd
```

## Dependencies

- Region family, canonical chunk coordinates, and `WorldRng`.

## Performance impact

Urban descriptors add two hash lookups and a two-field dictionary. Wilderness descriptors are unchanged.

## Out of scope

- Urban layout, roads, parcels, building geometry, flood dynamics, and gameplay effects.
