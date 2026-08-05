# Karst, sinkhole, cenote, and cave fields

`WorldKarst.apply` ports carbonate candidate selection, deterministic spatial pruning, doline/polje/tower/plain stamps, cave presence, sinkholes, and cenotes.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_karst_test.gd
```

The fixture checks forced deterministic doline, cave, and depth fields.

## Dependencies

- Carbonate lithology, rainfall, latitude, slope, terrain, and optional sea level.

## Performance impact

Candidate selection is linear; each stamp is bounded by its deterministic radius.

## Out of scope

- Cave meshing, groundwater flow, hydrology/lake solve integration, and rendering.
