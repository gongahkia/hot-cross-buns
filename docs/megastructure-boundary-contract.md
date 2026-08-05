# Megastructure chunk-boundary contract

Milestone 3 supplies the pure `WorldMegastructureIntersection.compile(descriptor, chunk)` step. `WorldGenerator.chunk_descriptor` now publishes non-empty results as `megastructure: {schema: "megastructure-chunk/v1", intersections: [...]}`; the scheduler, cache, and streamer carry that data without neighbor-load or worker-state input.

## Intersection data

The result is JSON-safe and contains the clipped macro bounds, clipped sectors, structural boundary ports, and traversal boundary ports for one 64-unit chunk. Macro bounds are the union of the opening `world_bounds` and all reveal `background_bounds`, so the far continuation participates in the same boundary contract.

Each port has two lexicographically ordered chunk coordinates, an owner equal to the first coordinate, an axis, and a fixed-point (`1/1024 world_unit`) point. The port payload contains no runtime, cache, neighbor-load, worker, or floating-point data.

## Canonical boundary keys

`mega-boundary:` plus the canonical SHA-256 hash of:

- world seed, generator schema version, descriptor schema version, megacell, archetype id, and archetype version;
- the two ordered adjacent chunk coordinates;
- a boundary schema version and layer.

Structural ports use the `structure` layer. Traversal ports use `traversal/<route_id>`, so routes crossing the same physical boundary retain distinct contracts.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_intersection_test.gd
```

The test verifies macro/sector clipping, matching independently compiled neighbor ports, canonical ownership, cache eviction independence, forward/reverse/shuffled request-order equality, and actual `WorkerThreadPool` queue-order equality.

The M3 streaming test also verifies descriptor and scheduler propagation, grounded interior terrain/collision, biome-feature suppression, and the enclosing prototype floor/deck relationship.

## Debug display

The existing `F4` prototype overlay samples every declared route and compiles its pure intersections. It displays structural owners in green, structural neighboring copies in purple, traversal owners in yellow, and traversal neighboring copies in coral. This is diagnostic geometry only; it does not attach streamed content or mutate chunk descriptors.
