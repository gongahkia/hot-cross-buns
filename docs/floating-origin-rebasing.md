# Floating-origin rebasing

`WorldOrigin` keeps canonical world chunks separate from engine-local positions. `WorldStreamer` now samples/generates in canonical space and rebases the player plus every active chunk root when the player reaches 32 chunks from the origin.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_origin_test.gd
```

The fixture checks positive/negative rebasing, canonical-position preservation, and zero-local current origin.

## Dependencies

- Versioned chunk size, streamer ownership, and main-thread node mutation.

## Performance impact

Rebases are infrequent and translate only active chunk roots plus the player.

## Out of scope

- Vertical rebase, worker payload rebasing, and save-schema migration.
