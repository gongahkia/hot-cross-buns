# Region palette and silhouette rules

Active terrain uses a deterministic biome/family palette. Far chunks use a darkened, desaturated, unshaded silhouette of that family color, making city, flooded, industrial, suburban, and wilderness regions distinguishable at distance.

Dependencies: `WorldRegionPresentation` and active/far `WorldStreamer` terrain materials. Palette lookup is constant-time per chunk material.

Out of scope: procedural skyline meshes, LOD geometry changes, atmospheric scattering, texture assets, and GPU/camera pixel validation. CPU natural-biome palette thumbnails are covered by [natural-biome-screenshot-goldens.md](natural-biome-screenshot-goldens.md).
