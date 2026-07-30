# Orometry archetypes

`WorldOrometry` ports the six Thoth profiles: Alps, Appalachians, Himalaya, Andes, Fjordland, and Basin&Range. Each retains its two 16-bin prominence histograms, density/spacing/slope/relief statistics, and four terrain modifiers.

Profile assignment is deterministic per scale-aware chunk block. Near a block edge it blends modifiers from the adjacent block over the configured halo, while retaining the primary profile identity and statistical fields.

`WorldContinents` applies those blended ridge-frequency and relief modifiers only when either nearest plate is continental. It retains the effective modifier fields for later slope/peak classification.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_orometry_test.gd
```

The fixture checks profile completeness/order/histogram shape, copy isolation, LuaJIT-derived block assignment and edge blending, and negative-coordinate repeatability. Downstream continent/tectonic fixtures cover modifier application.

## Dependencies

- Thoth hash primitives, world-scale factors, and configured chunk/block/halo dimensions.
- Continental base sampling for application of blended noise modifiers.

## Performance impact

Selection performs a few integer coordinate transforms and one or two hashes. The six profiles are static data; no disk I/O or runtime parsing occurs.

## Out of scope

- Orography mesh generation, peak/ridge classification, hydrology, and climate coupling.
- Changing profiles dynamically during an expedition or treating profile selection as mutable cache state.
