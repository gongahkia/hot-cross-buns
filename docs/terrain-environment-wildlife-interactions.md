# Terrain and environmental wildlife interactions

Ground wildlife cannot move on water and scales flee speed from 1.0 on level terrain to 0.45 at slope 1.0. The streamer supplies the deterministic spawn-surface sample to each active animal.

Dependencies: world surface samples, `WildlifeEnvironment`, and `WildlifeAgent`. Evaluation is constant-time per active animal frame.

Out of scope: water traversal, swimming, dynamic weather, terrain following after movement, navigation, hazards, damage, and animation.
