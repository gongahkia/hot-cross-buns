# Continental base elevation synthesis

`WorldContinents` ports the non-tectonic base elevation layer. For each sample it warps the world coordinate by scale, resolves the deterministic plate pair, then combines:

- continent fBm, roughness fBm, and ridge signal;
- continental shield/craton damping for old stable continental interiors;
- ocean-age depth, continental-margin blending, and shelf proximity for oceanic plates.

The returned `elevation` is intentionally the base composition only: continental/ocean bias, continental fBm, and damped roughness. It exposes every intermediate field needed by later tectonic and terrain systems.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_continents_test.gd
```

The fixture checks deterministic oceanic interior, oceanic continental-margin, and continental branches across local/region scales, ocean-depth coupling, the exact composition equation, and repeatability. It exits non-zero on a mismatch.

## Dependencies

- OpenSimplex fBm/domain warp, deterministic scale hierarchy, plate classification, and ocean-age depth.
- Seed, sea level, plate-cell size, maximum ocean age, and vertical scale supplied at construction.

## Performance impact

Each sample performs one warp, three bounded noise compositions, and one cached 3×3 plate lookup. Reuse one `WorldContinents` instance per seeded generation context; it owns the plate cache.

## Out of scope

- Tectonic uplift, rifts, trenches, island arcs, hotspots, seamounts, erosion, climate, and biome classification.
- Replacing the active `WorldGenerator` terrain output before the later terrain layers are integrated and re-versioned.
