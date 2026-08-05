# Thoth-to-Godot subsystem migration matrix

## Scope and source

This is the implementation map for the Thoth terrain runtime imported in commit `b626d8a4` (Lua/LÖVE2D) and the Godot expedition runtime. “Target” names the owning Godot boundary; it does not claim that the subsystem is already feature-complete. Issue numbers identify the port sequence.

| Legacy subsystem | Legacy source | Godot target boundary | Port sequence | Required compatibility rule |
| --- | --- | --- | --- | --- |
| Deterministic hash, PRNG, fBm, ridge, domain warp | `src/rng.lua`, `src/noise.lua` | `scripts/world_rng.gd` | #71–73 | Coordinate samples retain stable seed/version fixtures. |
| Local/region/continent coordinate scale | `src/worldgen.lua` | `WorldGenerator` scale descriptor | #74 | A coordinate maps to one declared scale hierarchy. |
| Plates, drift, hotspot, crust, elevation | `src/worldgen.lua`, `src/volcano.lua`, `src/bathymetry.lua` | world geology modules called by `WorldGenerator` | #75–81 | Derived fields are coordinate deterministic and serializable. |
| Orometry, lithology, soil | `src/orometry.lua`, `src/soil_production.lua`, `src/soil_classify.lua` | world surface-classification modules | #82–86 | Classification is data-first; render mesh code does not own scientific state. |
| Hydrology and erosion | `src/hydrology.lua`, `src/erosion.lua`, `src/meander.lua`, `src/hillslope.lua` | world hydrology/erosion modules | #87–99 | Local solves declare halos and preserve cross-region routing contracts. |
| Coast, caves, reefs, volcanoes | `src/coast.lua`, `src/karst.lua`, `src/reef.lua`, `src/volcano.lua` | world feature modules | #100–106 | Features derive from terrain fields and cannot change seed identity. |
| Climate, weather, biomes | `src/climate.lua`, `src/weather.lua`, `src/biomes.lua`, `src/atmosphere.lua` | climate/biome samplers plus presentation layer | #108–116, #217 | Simulation fields are separate from visual atmosphere. |
| Diagnostics and fixture suite | `src/diagnostics.lua`, `tests/run.lua` | Godot headless smoke/fixture scripts and diagnostics UI | #118–128 | Fixtures test descriptors and seams without requiring a GPU. |
| Streaming, workers, cache, floating origin | `src/worker.lua`, `src/lru.lua`, `src/clipmap.lua` | `WorldStreamer` and scheduler/cache modules | #130–151 | Main-thread scene ownership; workers exchange plain payloads only. |
| Natural/urban traversal content | `src/worldgen.lua`, `src/render.lua` | region generators and Godot scene builders | #152–181 | Gameplay affordances, collision, and render output share a descriptor. |
| Survival, resources, run resolution | `src/save.lua`, `src/journal.lua`, `src/survey.lua` | `Survival`, `RunData`, inventory/record modules | #182–203 | Run records contain versioned identity and tolerate local recovery. |
| Wildlife and traversal combat | no equivalent Thoth simulation subsystem | dedicated Godot gameplay modules | #204–216 | New design; do not infer legacy behavior. |
| Rendering, photo mode, cards | `src/render.lua`, `src/postfx.lua`, `src/thumbnail.lua`, `src/export.lua` | Godot renderer, photo, export modules | #218–240 | Capture/metadata must not mutate authoritative generation data. |

## Migration rules

1. Port data contracts before visuals. A renderer may sample a Godot descriptor but must not be its only implementation.
2. Preserve the legacy model’s intent only when it is compatible with the traversal-first invariants; do not reproduce Lua/LÖVE2D APIs or FFI storage details.
3. Make each Godot port headless-testable at its contract boundary before making it a streamed runtime dependency.
4. Record intentional behavior changes in an ADR or the relevant issue, including seed compatibility impact.
5. Retire a legacy subsystem from the matrix only after its Godot replacement has deterministic fixtures and a documented owner.

## Dependencies

- The merged Git history rooted at `b626d8a4` for source inspection.
- The Godot-only runtime decision in [ADR 0001](adr/0001-godot-only-runtime-generation.md).
- Seed/version policy, worker payload contract, streaming lifecycle contract, and world-generation fixtures.

## Performance impact

The matrix prevents accidental ports of Lua-specific FFI layouts, LÖVE channels, and clipmap APIs into the frame loop. Equivalent Godot systems need explicit allocation, cache, worker-payload, and active-radius budgets; profiling is required before a legacy scientific subsystem is enabled at streaming scale.

## Out of scope

- A claim that every legacy algorithm is scientifically faithful or should be ported unchanged.
- A line-by-line Lua-to-GDScript translation.
- Porting obsolete LÖVE UI, build, asset, or distribution infrastructure.
- Scheduling or completing the implementation issues listed above.
