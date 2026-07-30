# Natural-system gameplay-simplification audit

Natural systems generate readable traversal context, not mandatory simulation chores. This audit applies [design-pillars.md](design-pillars.md) to every ported natural subsystem.

| System group | Gameplay simplification | Required player-facing guardrail |
| --- | --- | --- |
| terrain, tectonics, orometry, erosion | Static coordinate-derived terrain replaces geological time simulation during play. | Landform, slope, water, and route changes remain visible before commitment. |
| hydrology, coasts, lakes, rivers, reefs | Local classifications replace fluid dynamics and dynamic shorelines. | Water boundaries and crossing hazards need collision/route continuity and an intended response. |
| soils, lithology, karst, volcanoes, periglacial, aeolian | Tags and bounded stamps replace material chemistry, eruptions, and moving sediment. | Tags may inform ecology/visuals but cannot create opaque instant failure. |
| climate, Köppen, weather | Bucketed deterministic states replace forecasting and global circulation. | Weather must signal visibility/exposure changes early and preserve a shelter, detour, recovery, or explicit resolution path. |
| biomes and ecology inputs | Discrete biome transitions replace succession and population dynamics. | Biome changes must preserve landmark/resource readability and deterministic revisit identity. |

## Audit decision

Natural generation is permitted to shape route cost, weather presentation, resources, hazards, and discovery. It must not silently alter authoritative terrain identity at runtime, require real-world expertise, or make a required route unrecoverable without warning. New gameplay use of a natural field must identify its player signal, alternate response, persistence rule, and deterministic test in the owning issue.

## Dependencies

- [design-pillars.md](design-pillars.md), [scientific-fidelity-audit.md](scientific-fidelity-audit.md), deterministic world-version policy, and subsystem fixtures.

## Performance impact

No runtime impact. Required reviews use existing deterministic and route/seam test infrastructure.

## Out of scope

- Survival numeric tuning, ecology simulation, visual rendering, and implementation of the future survival/traversal issues.
