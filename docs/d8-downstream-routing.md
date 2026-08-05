# D8 downstream routing

`WorldD8Routing.route(region, options)` exposes the Thoth D8 routing behavior. In the source implementation, routing is not a separate downhill scan: the priority-flood heap assigns each settled cell’s eight-neighbor `down_cell` parent and `down_distance` as it fills depressions. This wrapper preserves that coupled behavior through `WorldPriorityFlood.fill`.

The returned result contains visit order/counts; caller-owned cells receive `filled_elevation`, `down_cell`, and `down_distance`. See the priority-flood contract for the rectangular `gx`/`gy` grid and scaling options.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_d8_routing_test.gd
```

The fixture checks that an interior depression gets a D8 downstream link after fill and that every link is non-uphill over filled elevation.

## Dependencies

- `WorldPriorityFlood` and its rectangular-grid/base-elevation input contract.

## Performance impact

The wrapper adds no routing work or allocations; the delegated priority-flood solve is `O(n log n)`.

## Out of scope

- A second, independent D8 scan, flow accumulation, river classification, and cross-region routing.
- Altering priority-flood parent selection or tie behavior.
