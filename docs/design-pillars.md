# Merged-game design pillars

## Purpose

`a-slow-walk` is a first-person, deterministic survival-traversal game set in an infinite reclaimed Earth. This document defines the product invariants used to evaluate runtime systems, content, and future ports. It is normative for new expedition-world work; the creative editor is governed separately by [creative-levels.md](creative-levels.md).

## Pillars

1. **Traversal creates the decisions.** Movement is the primary way players explore, recover, escape, and express skill. Terrain, structures, resources, hazards, and encounters must present readable routes and movement choices rather than require a separate traversal mode.
2. **A hostile world rewards observation.** Hunger, thirst, temperature, weather, fatigue, injury, and visibility should turn route selection, preparation, and local knowledge into meaningful choices. They must not require opaque bookkeeping or punish players without a viable response.
3. **The world is continuous and shareable.** A seed and compatible generation version identify an expedition world. Crossing a chunk or region boundary must preserve the expected terrain, biome, landmark, and resource context for that identity.
4. **Procedural scale preserves place.** Generated regions need distinct silhouettes, ecology, landmarks, and traversal affordances. Infinite extent is not an excuse for interchangeable terrain.
5. **Records are the enduring progression.** A completed, failed, or extracted run produces a legible local record. Discovery, photography, and run summaries document the journey without granting a competitive power advantage.
6. **Presentation supports legibility.** The low-poly, pixel-forward image, sound, weather, and HUD make route state, player state, and threats readable at traversal speed. Visual novelty cannot conceal collision, hazards, collectibles, or paths.

## Traversal-first invariants

The following must hold for expedition content and runtime changes:

| ID | Invariant | Observable requirement |
| --- | --- | --- |
| T1 | Every required objective has a movement-led route. | Reaching resources, shelter, landmarks, extraction, and safety relies on the player movement kit; it is not gated solely by menus, timers, or combat damage. |
| T2 | Movement retains agency under survival pressure. | Survival states may alter route costs and movement effectiveness, but retain at least one recoverable route or clearly signal run failure. |
| T3 | Generated collision matches visible traversal space. | A visible traversable surface, ledge, anchor, or hazard has matching collision and remains continuous across active chunk seams. |
| T4 | Routes are readable before commitment. | Changes in elevation, water, weather, hazards, landmarks, and traversal aids are signaled in time for a player to choose a route. |
| T5 | Deterministic data is independent of load order. | For a compatible seed/version, a coordinate yields the same generation descriptor whether loaded directly, revisited, or reached from another chunk. |
| T6 | Transient systems do not corrupt world identity. | Streaming, photo mode, HUD state, audio, and visual LOD may change presentation but must not change generated terrain, resources, landmarks, or the authoritative run record. |
| T7 | Traversal challenges have an alternate response. | A route can reward mastery, but failure cannot create an unwarned, inescapable state when a lower-skill detour, recovery resource, reset, or explicit run resolution is intended. |

## Megastructure invariants

| ID | Invariant |
| --- | --- |
| MEGA-EXPERIENCE-001 | Most traversal occurs in local, readable spaces, but deterministic reveal points must periodically expose civilization-scale continuity. |
| MEGA-ENTRY-001 | Every authored level and procedural expedition begins with a playable entry sequence that establishes, crosses into, and internally reveals a megastructure. |
| MEGA-SCALE-001 | A megastructure is defined above chunk and region scale. Chunks only compile local intersections of a persistent macrostructure. |
| MEGA-DET-001 | Megastructure identity and macrographs depend only on world seed, generation version, and canonical coordinates. |
| MEGA-DET-002 | Sector and chunk descriptors must not depend on chunk load order, loaded neighbors, frame timing, or cache state. |
| MEGA-SEAM-001 | Every cross-chunk structural and traversal connection is defined by a canonical shared-boundary contract. |
| MEGA-ROUTE-001 | Every active sector has at least one validated baseline route connected to the expedition network. |
| MEGA-ROUTE-002 | Damage, flooding, and reclamation may not remove a mandatory route without providing and validating a replacement. |
| MEGA-VIS-001 | Every mandatory movement affordance is recognizable at the distance and speed from which the player must commit. |
| MEGA-HISTORY-001 | Visible architectural layers derive from ordered construction epochs rather than independent decorative randomization. |
| MEGA-STREAM-001 | Megastructure attachment must preserve the normal-frame mutual deferral of active-chunk, collision-LOD, far/detail, and other heavyweight construction. |

## Decision order

When requirements conflict, prioritize them in this order:

1. Preserve player control, safety, and clear failure resolution.
2. Preserve deterministic world and run identity.
3. Preserve collision and route continuity.
4. Preserve readable survival and traversal decisions.
5. Preserve visual detail and content density.

## Dependencies

- Godot 4 runtime and the project movement input map.
- `WorldGenerator`, `WorldStreamer`, `RunData`, and `Survival` must expose stable data sufficient to enforce the invariants they own.
- Deterministic content changes require seed/version compatibility policy and regression fixtures before release.
- Content systems that add combat, crafting, weather, or photography must obey these invariants instead of creating parallel progression paths.

## Performance impact

This policy has no frame-time cost by itself. Its verification drives bounded generation fixtures, seam checks, and survival-route checks; their budgets belong to the world-generation and generated-content performance documents. Runtime implementations must prefer deterministic, coordinate-derived data over unbounded history scans.

## Out of scope

- Exact movement tuning, damage values, resource yields, and art direction.
- A promise that every optional landmark is accessible without skill expression.
- Multiplayer synchronization, network authority, or cloud saves.
- Replacing the creative-editor contract or defining individual biome-generation algorithms.
