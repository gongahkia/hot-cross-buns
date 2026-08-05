# Long-distance traversal soak test

`world_traversal_soak_test.gd` drives an expedition streamer through 33 canonical positions: 128 chunks outward and 128 chunks back in eight-chunk increments. At every point it forces active descriptors and checks active/far-window counts, center collision, cache capacity, canonical sampling, and floating-origin rebasing.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_traversal_soak_test.gd
```

## Dependencies

- Expedition scene, streamer, chunk scheduler/cache, far terrain, collision LOD, and floating origin.

## Performance impact

This is a deliberate integration soak test, not a per-commit microtest. It waits for active descriptors at each of 33 positions and should remain headless-only.

## Out of scope

- Real-time movement input, rendered-frame timing, GPU memory, and a 15-minute device benchmark.
