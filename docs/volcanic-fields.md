# Volcanic arc, hotspot, lava, and fumarole fields

`WorldVolcano.apply` ports the Thoth local-maxima selection, deterministic spacing/order, stratocones, shields, cinder cones, calderas, and downhill lava stamps. It writes `volcanic_form`, `volcanic_age_my`, terrain elevation/slope, and `region.volcanoes`.

`WorldVolcano.classify_fumaroles` ports the legacy `Biomes.lookup` fumarole branch as `fumarole_field`; it preserves preceding reef, water, flood-basalt, karst, exotic, shield, caldera, and ash-plain precedence without assigning a biome. It requires climate fields and therefore runs after climate generation. Natural-biome assignment remains the later biome-stage responsibility.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_volcano_test.gd
```

The fixture checks hotspot shield/lava output, forced arc caldera output, and fumarole precedence.

## Dependencies

- A complete land-cell lattice with `gx`, `gy`, elevation, water, volcanic-arc, hotspot, lithology, and optional hotspot-age fields.
- Fumarole classification additionally needs temperature, precipitation, slope, and the prior biome-rule inputs.

## Performance impact

Candidate scan/sort and spacing are linear/quadratic in local candidates; cone stamps are bounded by deterministic radii. Fumarole classification is linear in cells.

## Out of scope

- Volcano meshes, particle effects, fluid simulation, and final natural-biome assignment.
