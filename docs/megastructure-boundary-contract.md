# Megastructure chunk-boundary contract

Milestone 3 supplies a pure `WorldMegastructureIntersection.compile(descriptor, chunk)` step. It is not wired into `WorldGenerator`, the chunk cache, workers, streaming queues, or scene construction yet; M3.6 requires the generator identity and persisted-run migration decision recorded in the megastructure plan.

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
