# Urban-region determinism fixtures

`urban-region-fixtures.v1.json` fixes one reclaimed-city, flooded-city, industrial-ruin, and overgrown-suburb descriptor case. The verifier checks fixed family/urban fields, required subsystem fields, representative signatures, and repeat generation equality.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_urban_region_fixtures_test.gd
```

## Dependencies

- `WorldGenerator` and the four urban descriptor pipelines.

## Performance impact

- Test-only descriptor generation; no runtime impact.

## Out of scope

- Pixel goldens, collision reachability, long-run streaming, and cross-platform rendering validation.
