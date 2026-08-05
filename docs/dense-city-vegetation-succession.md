# Dense-city vegetation succession

`WorldCityVegetation` assigns reclaimed-city growth records by ruin age: pioneer, shrub, then canopy. It caps records at six per chunk and places them on surviving roofs or collapsed lots. `WorldStreamer` renders each record as matching collision tree growth.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_city_vegetation_test.gd
```

## Dependencies

- Urban ruin age, building masses, structural failure records, and `WorldRng`.

## Performance impact

At most six tree nodes/colliders are added per active reclaimed-city chunk.

## Out of scope

- Plant simulation, seasonal growth, species inventories, fire, and harvesting.
