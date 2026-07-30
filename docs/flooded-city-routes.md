# Flooded-city roof, bridge, and canal routes

`WorldFloodedCityRoutes` derives one seam-stable canal, bridge, and raised roof route from flooded-basin orientation and inundation depth. `WorldStreamer` renders a non-colliding canal overlay plus collision bridge and roof-route platforms.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_flooded_city_routes_test.gd
```

## Dependencies

- Flooded-city basin/inundation fields and `WorldRng`.

## Performance impact

Each active flooded-city chunk adds one visual canal and two small route collision boxes.

## Out of scope

- Boat travel, water collision, buoyancy, dynamic bridge failure, and navigation solving.
