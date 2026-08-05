# Free-camera controls

Photo mode retains `P` to enter/exit and `F12` to capture. Use movement bindings for planar movement, `Space`/`Q` to rise, `Ctrl`/`E` to descend, `Shift` for fast travel, and `Alt` for precise travel. `-`/`=` halve/double fly speed, `,`/`.` halve/double mouse sensitivity, and `R` restores the entry camera pose.

The controls depend only on the active `PhotoMode` camera and do not alter player/world state. They add no per-frame allocation beyond the existing input vector and are unavailable outside photo mode. FOV, depth, exposure, filters, high-resolution capture, and export metadata are separate work.
