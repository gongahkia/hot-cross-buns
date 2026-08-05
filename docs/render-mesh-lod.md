# Render-mesh LOD

`WorldRenderLod` selects 16×16, 8×8, or 4×4 render grids by chunk distance. `WorldStreamer` records the render grid per root. Collision LOD is documented in `collision-mesh-lod.md`; outer impostors are documented in `far-terrain.md`.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_render_lod_test.gd
```

## Dependencies

- Canonical chunk distance and streamer mesh construction.

## Performance impact

Far active chunks submit fewer render triangles. Collision has independent LOD.

## Out of scope

- LOD stitching and geomorphing.
