# Render-mesh LOD

`WorldRenderLod` selects 16×16, 8×8, or 4×4 render grids by chunk distance. `WorldStreamer` records the render grid per root; collision remains 16×16.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_render_lod_test.gd
```

## Dependencies

- Canonical chunk distance and streamer mesh construction.

## Performance impact

Far chunks submit fewer render triangles; collision cost is unchanged.

## Out of scope

- LOD stitching, geomorphing, collision LOD, and impostors.
