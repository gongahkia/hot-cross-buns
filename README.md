# a-slow-walk

First-person forest speedrunner built with Godot 4.7.1 and GDScript.

## Run

`./script/build_and_run.sh`

## Release builds

`./script/export_release.sh` produces `dist/a-slow-walk.app` and the Windows `dist/a-slow-walk.exe` package. Keep the Windows `.exe`, `.pck`, and `.console.exe` files together.

The macOS build is ad-hoc signed for local testing, not notarized. Gatekeeper will reject it after Internet distribution until it is signed with an Apple Developer ID and notarized.

## Controls

- WASD / left stick: move
- Mouse / right stick: look
- Space / A: jump and wall jump
- Shift / right bumper: dash
- Ctrl / B: slide
- R / Y: instant reset
- Escape / Start: pause

All actions can be rebound in Settings. Records, ghost data, and settings save under Godot's local `user://` path.
