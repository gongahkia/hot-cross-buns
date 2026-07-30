# Tectonic elevation synthesis

`WorldTectonics` layers deterministic tectonic terms over a `WorldContinents` base sample:

- convergent uplift;
- continental rift and rift-valley reduction;
- oceanic trench and opposite-side subduction uplift;
- ocean–ocean island arcs;
- ocean abyssal noise and the base layer’s passive-margin blend.

An optional hotspot contribution is accepted explicitly, so callers can compose the hotspot field without hidden generator state.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_tectonics_test.gd
```

The fixture checks rift, island-arc, trench/passive-margin, optional-hotspot, and repeatability cases. It exits non-zero on a mismatch.

## Dependencies

- Continental base sample, including warped coordinates, scale factor, ridge, shelf, and plate fields.
- OpenSimplex sampler for arc and abyssal terms; optional hotspot field output.

## Performance impact

The layer adds one arc sample only for eligible ocean–ocean boundaries and one three-octave abyssal fBm sample for oceanic plates. It allocates only its result dictionary.

## Out of scope

- Orography archetypes, seamounts, erosion, hydrology, climate, biome selection, and active terrain integration.
- Tectonic feedback into plate velocity or crust classification.
