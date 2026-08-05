# Reclaimed-city macro layouts

`WorldReclaimedCityLayout` adds a deterministic `city_layout` record to reclaimed-city chunk descriptors. Four one-chunk terrain probes provide local slope and water context; the record selects waterfront, contour-terrace, or orthogonal-grid layout plus a spine axis.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_reclaimed_city_layout_test.gd
```

## Dependencies

- Reclaimed-city region family, canonical terrain samples, and local water classification.

## Performance impact

Reclaimed-city descriptor construction adds four deterministic terrain samples. Other descriptor families are unchanged.

## Out of scope

- Roads, parcels, structures, terrain reshaping, and any city collision geometry.
