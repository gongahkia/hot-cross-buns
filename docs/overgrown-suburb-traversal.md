# Overgrown-suburb root, canopy, and collapse traversal grammar

`WorldSuburbTraversal` derives traversable roots, canopy platforms, and collapsed-beam routes from suburb parcels and transitions. `WorldStreamer` renders all three as collision geometry.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_suburb_traversal_test.gd
```

## Dependencies

- Overgrown-suburb parcel/home and transition descriptors plus `WorldRng`.

## Performance impact

Each active overgrown-suburb chunk adds three roots, two trees with canopy platforms, and two collapse boxes.

## Out of scope

- Tree growth, dynamic collapse, foliage simulation, reachability solving, and grapple links.
