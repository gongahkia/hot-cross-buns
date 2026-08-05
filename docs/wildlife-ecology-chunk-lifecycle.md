# Wildlife ecology and chunk lifecycle

`WorldWildlifeEcology` deterministically emits at most one compatible animal record for a non-water chunk. `WorldStreamer` creates a lightweight wildlife node as a child of the active chunk. When a chunk leaves the active window, its existing `queue_free` lifecycle despawns the child; re-entering the same chunk regenerates the same record.

Dependencies: `WildlifeArchetypes`, `WorldRng`, world chunk descriptors, and `WorldStreamer`. Generation is constant work per chunk and active wildlife is bounded by active chunk count.

Out of scope: movement, perception, collision, damage, persistence after a chunk unloads, population simulation, and spawning in water/flooded-city chunks.
