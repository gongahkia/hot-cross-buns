# Wildlife perception and avoidance

Active wildlife checks player distance each frame. Outside its archetype awareness range it idles; inside range it moves directly away at a fixed flee speed. Territorial boars emit one state-only warning within their inner territory, then use the same flee behavior. The current state is stored in `wildlife_state` metadata.

Dependencies: `WildlifeArchetypes`, `WildlifeEncounterPolicy`, `WildlifeBehavior`, `WildlifeAgent`, and chunk-owned wildlife nodes. Work is linear in active wildlife, which is capped by active chunks.

Out of scope: occlusion raycasts, navigation, terrain following, animation, collision, damage, audio, and long-lived behavior outside active chunks.
