# Natural-biome screenshot goldens

`WorldNaturalBiomeScreenshot` rasterizes fixed `WorldBiomes.lookup` inputs into RGBA8 `Image` thumbnails with the production wilderness palette from `WorldRegionPresentation`. `levels/natural-biome-screenshot-goldens.v1.json` fixes dimensions, resolved biome labels, and SHA-256 hashes of the raw pixel bytes for terrestrial/relief and water/coastal cases.

The suite is deliberately CPU-only. It verifies the natural-biome visual contract while preserving the policy that GPU camera screenshots are not cross-platform deterministic identity.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_natural_biome_screenshot_test.gd
```

## Dependencies

- `WorldBiomes.lookup`, `WorldRegionPresentation.palette`, Godot `Image` RGBA8 storage, and `HashingContext` SHA-256.
- The versioned JSON fixture; changing its hash requires a reviewed visual-compatibility decision.

## Performance impact

Headless-only. The current fixture creates 80 × 64 pixels and hashes 20,480 bytes; it has no runtime streaming, material, GPU, or disk-write cost.

## Out of scope

- GPU/camera screenshot comparison, post-processing, lighting, font rasterization, and driver validation.
- Visual-art approval, mesh/LOD coverage, dynamic weather, or automatic golden regeneration.
