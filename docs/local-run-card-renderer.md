# Local run-card renderer

Each exported run card now includes a 1200×630 SVG image beside its JSON manifest. `RunCardRenderer` deterministically lays out the outcome, level, seed identity, elapsed time, pickups, sorted resource totals, and discovered regions with no network or external renderer dependency.

Rendering performs one bounded string build at export time. It does not rasterize thumbnails, embed screenshots, import old manifests, or claim cross-platform font-pixel identity; SVG viewers select their local monospace font.
