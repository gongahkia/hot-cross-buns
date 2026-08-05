# Overgrown-suburb road hierarchy and cul-de-sacs

`WorldSuburbRoads` derives a deterministic collector, local road, and two cul-de-sacs from overgrown-suburb urban fields. `WorldStreamer` renders the roads as non-colliding overlays while existing placeholder homes remain until parcel generation.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_suburb_roads_test.gd
```

## Dependencies

- Overgrown-suburb `WorldUrbanFields` records and `WorldRng`.

## Performance impact

Each active overgrown-suburb chunk adds six small road meshes.

## Out of scope

- Parcel generation, homes, utilities, collision, navigation, and vegetation interaction.
