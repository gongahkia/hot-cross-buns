# Encounter escape-rate balance

The deterministic balance harness evaluates 64 evenly spaced player distances across each archetype’s awareness range. After a territorial warning is acknowledged, every sampled aware encounter must select flee, producing an escape decision rate of 1.0.

Dependencies: `WildlifeArchetypes` and `WildlifeEncounterPolicy`. The test is constant-size and pure.

Out of scope: measured player catch rates, pathfinding, terrain obstruction, damage, rewards, and a claim of real-world behavior.
