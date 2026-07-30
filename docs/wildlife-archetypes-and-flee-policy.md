# Wildlife archetypes and flee-first policy

The wildlife foundation defines swift deer, ruin foxes, and territorial boars. All are ground movers with finite awareness and escape distances. Encounter decisions are idle outside awareness or line of sight, flee when the player is nearby, and give territorial boars one non-attacking warning before fleeing from a territory intrusion.

Dependencies: no runtime scene dependency. `WildlifeArchetypes` supplies immutable descriptors and `WildlifeEncounterPolicy` is a pure decision function for future streamed spawning and behavior. The lookup and decision are constant-time.

Out of scope: spawning, meshes, animation, navigation, damage, aggression, player rewards, or an assertion that real animal behavior is simulated.
