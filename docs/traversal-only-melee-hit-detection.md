# Traversal-only melee hit detection

`TraversalMelee` permits radial hits only from a slide at 12+ speed or a slam at 16+ speed. Slide range is 2.2 units and slam range is 3.0 units. The result is a pure hit contract for wildlife interactions.

Dependencies: future player/wildlife contact integration supplies state, planar speed, and positions. The comparison is constant-time.

Out of scope: damage, cooldowns, animation, targeting, ordinary melee, rewards, injury, and escape feedback.
