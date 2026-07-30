# Dense-city blocks and parcels

`WorldCityParcels` turns arterial and secondary-road lanes into bounded reclaimed-city blocks, then deterministically subdivides each block into two or three land-use parcels. Blocks reserve road widths and a one-unit setback; parcels remain inside their parent blocks.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_city_parcels_test.gd
```

## Dependencies

- Urban fields plus arterial and secondary-road records.

## Performance impact

The bounded lane set produces a small descriptor-only block/parcel list. It creates no scene nodes in this stage.

## Out of scope

- Building massing, facade geometry, lot ownership, navigation, and parcel collision.
