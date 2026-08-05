# Low-poly pixel post-process

The existing world-only pixel filter now combines 2x/4x UV snapping with eight-step RGB palette quantization and a small deterministic ordered dither. UI remains on the higher canvas layer and is not filtered.

Dependencies: Godot canvas-item screen texture and the existing pixel-filter settings control. The filter remains one full-screen sample plus arithmetic per output pixel.

Out of scope: render-scale changes, dynamic resolution, palette authoring, CRT effects, texture upscaling, and a visual-fidelity claim against unavailable upstream assets.
