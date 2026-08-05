# High-resolution screenshot capture

`F11` in photo mode renders the shared 3D world once through a temporary `SubViewport` at 2× the current viewport dimensions, then writes a `_hires.png` beside normal captures. The output is capped at 16,777,216 pixels (64 MiB RGBA8 readback); large source resolutions are reduced proportionally. `F12` remains the standard-resolution capture path.

The capture waits for the off-screen render and GPU-to-CPU image readback, so it can stall briefly and should be used on demand only. It depends on `SubViewport` shared-world rendering and does not include HUD/canvas overlays, add tiling, save visual presets, or embed image metadata.
