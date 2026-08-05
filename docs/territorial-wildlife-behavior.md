# Territorial wildlife behavior

Territorial boars receive a deterministic 12-unit territory radius centered on their streamed spawn. Entering that fixed radius emits one warning state; subsequent perception uses flee behavior. The territory remains fixed even while the boar moves away from the player.

Dependencies: `WildlifeArchetypes`, `WorldWildlifeEcology`, `WildlifeBehavior`, and `WildlifeAgent`. Territory testing is one distance check per active territorial animal per frame.

Out of scope: aggression, damage, pathfinding, visual territory markers, persistence across chunk unload, and multi-animal territories.
