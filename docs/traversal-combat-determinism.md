# Traversal-combat determinism

The combined headless contract verifies deterministic wildlife spawning, slide/slam/grapple hit qualification, and stable impact-vector calculation at each action threshold.

Dependencies: wildlife ecology, traversal-melee qualification, and all three impact resolvers. The test is pure and does not create a scene or wait for physics.

Out of scope: collision broadphase, animation, runtime frame ordering, damage, and balance success rates.
