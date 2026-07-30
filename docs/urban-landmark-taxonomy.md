# Urban landmark taxonomy and naming

`WorldUrbanLandmarks` classifies existing urban landmark placements into civic-reclamation, waterworks, industrial-heritage, or domestic-memory taxonomy and derives a deterministic canonical name. `WorldLandmarks` stores the metadata with its persistent placement record.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_urban_landmarks_test.gd
```

## Dependencies

- Existing macro-region family and landmark fields plus `WorldRng`.

## Performance impact

Only existing urban landmark records receive three small metadata fields.

## Out of scope

- Landmark meshes, missions, discovery UI, voice-over, and authored lore.
