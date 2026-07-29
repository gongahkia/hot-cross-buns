[![](https://img.shields.io/badge/thoth_1.0.0-passing-dark_green)](https://github.com/gongahkia/thoth/releases/tag/1.0.0)
![](https://github.com/gongahkia/thoth/actions/workflows/ci.yml/badge.svg)

# `Thoth`

[Research-backed](#research) infinite walking simulator in a
[procedurally generated world](#terrain-generation-techniques) that's as close to [earth](https://en.wikipedia.org/wiki/Earth)'s as possible.

<div align="center">
    <img src="./assets/screenshots/gameplay.gif" width="70%">
</div>

## Stack

* *Scripting*: [Lua](https://www.lua.org/), [LÖVE2D](https://love2d.org/)
* *Tests*: [LuaJIT](https://luajit.org/) 

## Assets

* *Font*: [BigBlue Terminal](https://int10h.org/blog/2015/12/bigblue-terminal-oldschool-fixed-width-font/)
* *Sprites*: [Custom billboard texture atlas](./assets/billboards.png)

## Screenshots

<div align="center">
    <img src="./assets/screenshots/01-alpine.png" width="45%">
    <img src="./assets/screenshots/02-coastline.png" width="45%">
</div>
<div align="center">
    <img src="./assets/screenshots/03-desert.png" width="45%">
    <img src="./assets/screenshots/04-taiga.png" width="45%">
</div>
<div align="center">
    <img src="./assets/screenshots/05-wetland.png" width="45%">
    <img src="./assets/screenshots/06-volcanic.png" width="45%">
</div>

## Usage

The below commands are for locally running `Thoth`.

1. First install `Thoth` on your current machine.

```console
$ git clone https://github.com/gongahkia/thoth && cd thoth
```

2. Then run any of the below to start `Thoth`.

```console
$ make run
```

### Controls

| Key | Action |
|:---:|--------|
| `WASD` | walk / strafe |
| `Shift` | sprint |
| mouse / `E` / `<` | look |
| `^` / `v` | pitch |
| `F` | toggle mouse look |
| `B` | toggle all debug panels |
| `1` / `2` / `3` / `4` | toggle plate / drainage / erosion / biome overlay |
| `5` | toggle topographic map overlay |
| `T` | toggle debug topographic map |
| `M` | toggle minimap |
| `N` | mark surveyed terrain |
| `L` | toggle perf overlay |
| `[` / `]` | step season |
| `F5` / `F9` | save / load |
| `Q` / `Esc` | quit |
| `R` | new seed |

3. Finally, optionally execute the below to interact with `Thoth`'s functionality.

```console
$ make test
$ make smoke
$ make diagnostics
$ make regressions
$ make benchmark
$ make bench
$ make bench-update
$ make render-smoke
$ make walk-smoke
$ make export-smoke
```

### Additional configuration

```console
$ love . --skip-menu
$ love . --debug-perf
$ love . --walk-smoke --walk-smoke-frames 240 --perf-interval 0.5
$ love . --preload-radius 128 --refresh-preload-radius 96
$ love . --cache-max-entries 512
$ love . --hydrology-region-chunks 2 --hydrology-halo 8
$ love . --hydrology-basin-chunks 8 --hydrology-basin-stride 4
$ love . --export-map dist/map --export-size 128
$ love . --save-path thoth-save.json --load-save thoth-save.json
$ love . --scope local|region|continent
$ love . --geologic-time 0.5
$ love . --pixel-scale 2 --time-of-day 0.25 --season summer --day-length 60
$ love . --no-async
```

## Nerd stuff

### Terrain generation techniques

`Thoth`'s terrain generation follows an 8-layer deterministic pipeline where every `(seed, geologicTime)` pair creates a unique world.

#### Layer 1: Noise base

[Kurt Spencer's successor](https://en.wikipedia.org/wiki/OpenSimplex_noise) to Perlin and Simplex noise, [OpenSimplex2](https://github.com/KdotJPG/OpenSimplex2) was chosen for `Thoth` given its visual isotropy and lack of directional artefacts.

Aside from OpenSimplex2, other noise functions implemented were fBm, ridge, and domain-warp modulators. Multi-octave sampling also fed the tectonic mask and were used for uplift and continental heightfield when generating the base terrain fold.

#### Layer 2: Plate tectonics

To simulate proper tectonic movement, `Thoth` implemented a plate mosaic layer with [per-plate velocities, age, and boundary flags](./src/worldgen.lua) to drive uplift belts, island arcs and and passive-margin shelves. 

This general approach was taken from [PlaTec / Viitanen (2012) approach to physically based plate-tectonic terrain synthesis](https://www.theseus.fi/bitstream/handle/10024/40422/Viitanen_Lauri_2012_03_30.pdf) and the [large-scale uplift + fluvial model of Cordonnier et al. 2016](https://onlinelibrary.wiley.com/doi/10.1111/cgf.12820).

#### Layer 3: Mountain orometry

`Thoth`'s orometry currently blends 6 archetypes *(alps, appalachians, himalaya, andes, fjordland, basinrange)* with standard techniques that include the below. This reference is supported by the approach taken in [orometry-based terrain analysis + synthesis framework of Argudo et al. 2019](https://dl.acm.org/doi/10.1145/3355089.3356535) and [Kirmse & de Ferranti 2017](https://journals.sagepub.com/doi/abs/10.1177/0309133317738163).

* Peak-amplitude
* Ridge-frequency
* Relief scales
* Orometric descriptors *(prominence, isolation, ridges, saddles)*

#### Layer 4: Hydrology

`Thoth` attempts to implement hydrology via a heap-based system, which is a straight rip-off of [Priority-Flood depression filling pass (Barnes, Lehman & Mulla 2014)](https://rbarnes.org/sci/2014_depressions.pdf) and [D8 downstream routing (O'Callaghan & Mark 1984)](https://www.sciencedirect.com/science/article/pii/0734189X84800110).

***TLDR***, we added flow accumulation *(computed in reverse-topological order)* to allow for natural generation of waterbodies that include basins, watersheds, terminal cells and lake surfaces.

#### Layer 5: Fluvial erosion

To simulate erosion in `Thoth`, I referenced the research in [stream-power incision law (Whipple & Tucker 1999)](http://geosci.uchicago.edu/~kite/doc/Whipple_and_Tucker_1999.pdf) that integrated a debris-flow branch. This branch switches to a critical-slope equilibrium above a sediment-concentration threshold to allow for relatively realistic *(albeit unoptimised)* erosion mechanics.

#### Layer 6: Glacial erosion

Ice-sheet abrasion is roughly driven by the ideas covered in [Shallow Ice Approximation (SIA)](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2021RG000754) to attempt a rudimentary simulation of basal sliding and gradient-driven flow.

#### Layer 7: Hillslopes and periglacial

To add some degree of slopes, `Thoth` implements a non-linear critical-slope diffusion. Geographical difference are simulated via 2 separate regolith and bedrock diffusivities. 

#### Layer 8: Climate and biomes

Given I really wanted `Thoth` to be a somewhat accurate simulation of earth's actual terrain and weather mechanics, I referenced [Smith & Barstad 2004 linear theory of orographic precipitation](https://journals.ametsoc.org/view/journals/atsc/61/12/1520-0469_2004_061_1377_altoop_2.0.co_2.xml) to map temperature against precipitation onto a Whittaker-style grid. 

Furthering this notion of realistic weather, `Thoth` carried over [Köppen-Geiger](https://www.britannica.com/science/Koppen-climate-classification) letters to resolve orographic precipitation with wind-gradient lift. 

Finally, some sembelance of soil realism is implemented via USDA soil orders *(entisol, inceptisol, mollisol, vertisol, aridisol, histosol, spodosol, oxisol, andisol, ultisol)*, which directly ties into the aforementioned erosion mechanics.

### Rendering 

Heightfields are drawn through [GPU-based geometry clipmaps (Losasso & Hoppe 2004)](https://hhoppe.com/proj/gpugcm/) in [`src/clipmap.lua`](./src/clipmap.lua) with persistent streamed meshes and per-cell sun-direction lighting. A low-resolution canvas + 32-colour palette-quantisation shader in [`src/postfx.lua`](./src/postfx.lua) is swapped per active view-scope for the [Proteus](https://store.steampowered.com/app/219680/Proteus/) look. [`src/atmosphere.lua`](./src/atmosphere.lua) drives a four-grade dawn/noon/dusk/night day cycle × four seasons, tinting the palette and the sun vector.

### Performance optimisation

#### Streaming and LOD

`Thoth` implements geometry clipmaps to cache nested regular grids around the camera. This means that only ring-buffer edges are re-uploaded as the player walks to keep the rendering rate steady even at large world sizes. 

As with everything above, this is taken from the [Losasso & Hoppe 2004](https://hhoppe.com/proj/gpugcm/) invariant, and is not an idea that came to me naturally. 

#### Async hydrology worker

Getting into the nitty-gritty, `Thoth`'s worker offloads priority-flood and climate rendering to a background LÖVE2D thread over a job-to-response channel to ensure that the render thread never blocks.

#### Two-tier hydrology resolution

Since water is often the most graphically intensive element of real-world games, especially when it comes to realistic terrain generation, `Thoth` has a dual-workflow system that allows for both fine-grained regions to pass *(on local flows)* while a coarser basin pass simultaneously preserves large river corridors and inter-basin spillovers cheaply. 

### Benchmarks

`Thoth` currently has 2 different benchmarking layers.

1. **Micro-benchmarks**: [`tests/bench.lua`](./tests/bench.lua) generates worlds at scope $\times$ chunk-radius combinations $\times$ region / basin / erosion / climate solves. This also gates against [`tests/bench.baseline.json`](./tests/bench.baseline.json) while `make bench` fails on regressions worse than the tolerance *(50% locally, 10% in CI)*.
2. **Runtime smoke**: `make walk-smoke` runs a headless `love . --walk-smoke --walk-smoke-frames 240 --perf-interval 0.5` traversal. Seperately, streaming perf samples every 0.5 seconds so first-render and walk-hitch regressions surface without a monitor. Finally, `make render-smoke` and `make export-smoke` cover render init + map-export paths respectively.

## Research

`Thoth` heavily drew on the below papers when crafting its [terrain generation](#terrain-generation-techniques).

* [Priority-flood: An optimal depression-filling and watershed-labeling algorithm for digital elevation models](https://rbarnes.org/sci/2014_depressions.pdf) by Richard Barnes, Clarence Lehman and David Mulla
* [Dynamics of the stream-power river incision model: Implications for height limits of mountain ranges, landscape response timescales, and research needs](https://agupubs.onlinelibrary.wiley.com/doi/10.1029/1999JB900120) by Kelin X Whipple and Gregory E Tucker
* [The extraction of drainage networks from digital elevation data](https://www.sciencedirect.com/science/article/pii/0734189X84800110) by John F O'Callaghan and David M Mark
* [The synthesis and rendering of eroded fractal terrains](https://dl.acm.org/doi/10.1145/74334.74337) by F Kenton Musgrave, Craig E Kolb and Robert S Mace
* [A Linear Theory of Orographic Precipitation](https://journals.ametsoc.org/view/journals/atsc/61/12/1520-0469_2004_061_1377_altoop_2.0.co_2.xml) by Ronald B Smith and Idar Barstad
* [Geometry clipmaps: Terrain rendering using nested regular grids](https://hhoppe.com/proj/geomclipmap/) by Frank Losasso and Hugues Hoppe
* [Terrain Rendering Using GPU-Based Geometry Clipmaps](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry) by Arul Asirvatham and Hugues Hoppe
* [Physically Based Terrain Generation: Procedural Heightmap Generation Using Plate Tectonics](https://www.theseus.fi/bitstream/handle/10024/40422/Viitanen_Lauri_2012_03_30.pdf) by Lauri Viitanen
* [Large Scale Terrain Generation from Tectonic Uplift and Fluvial Erosion](https://onlinelibrary.wiley.com/doi/10.1111/cgf.12820) by Guillaume Cordonnier, Jean Braun, Marie-Paule Cani, Bedrich Benes, Éric Galin, Adrien Peytavie and Éric Guérin
* [Authoring Landscapes by Combining Ecosystem and Terrain Erosion Simulation](https://dl.acm.org/doi/10.1145/3072959.3073667) by Guillaume Cordonnier, Éric Galin, James Gain, Bedrich Benes, Éric Guérin, Adrien Peytavie and Marie-Paule Cani
* [Orometry-based Terrain Analysis and Synthesis](https://dl.acm.org/doi/10.1145/3355089.3356535) by Oscar Argudo, Éric Galin, Adrien Peytavie, Axel Paris, James Gain and Éric Guérin
* [Calculating the prominence and isolation of every mountain in the world](https://journals.sagepub.com/doi/abs/10.1177/0309133317738163) by Andrew Kirmse and Jonathan de Ferranti
* [Ice-Dynamical Glacier Evolution Modeling — A Review](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2021RG000754) by Harry Zekollari, Matthias Huss, Daniel Farinotti and Surendra Adhikari
* [Modeling the flow of glaciers in steep terrains: The integrated second-order shallow ice approximation (iSOSIA)](https://ui.adsabs.harvard.edu/abs/2011JGRF..116.2012E/abstract) by David L Egholm, Mads F Knudsen, C D Clark and Jonathan E Lesemann
* [Analytical theory of erosion](https://www.journals.uchicago.edu/doi/10.1086/626606) by W E H Culling
* [Eolian dunes: Computer simulations and attractor interpretation](https://www.semanticscholar.org/paper/Eolian-dunes%3A-Computer-simulations-and-attractor-Werner/f4bcbb6796fd011e2f36d7cff373fc6ec486ea18) by Bradley T Werner
* [Procedural generation of 3D karst caves with speleothems](https://www.sciencedirect.com/science/article/abs/pii/S0097849321002132) by Axel Paris, Éric Guérin, Adrien Peytavie, Pauline Collon and Éric Galin
* [Interactive terrain modeling using hydraulic erosion](https://dl.acm.org/doi/abs/10.5555/1632592.1632622) by Ondrej Št'ava, Bedrich Benes, Matthew Brisbin and Jaroslav Křivánek
* [Methods for Procedural Terrain Generation: A Review](https://link.springer.com/chapter/10.1007/978-3-030-21077-9_6) by Jonas Freiknecht and Wolfgang Effelsberg
* [Terrain simulation using a model of stream erosion](https://dl.acm.org/doi/10.1145/54852.378519) by Alex D Kelley, Michael C Malin and Gregory M Nielson
* [Polygon Map Generation](https://www.redblobgames.com/maps/terrain-from-noise/) by Amit Patel
* [OpenSimplex2](https://github.com/KdotJPG/OpenSimplex2) by Kurt Spencer

## References

Visually, `Thoth` takes a lot of reference from the 2013 game [Proteus](https://store.steampowered.com/app/219680/Proteus/) by [Ed Key and David Kanaga](https://en.wikipedia.org/wiki/Proteus_(video_game)).

<div align="center">
    <img src="./assets/reference/proteus.jpg" width="65%">
</div>
