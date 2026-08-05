# Slide-impact attack

An eligible slide hit now applies a forward wildlife impulse scaled from 6 at speed 12 to 16 at speed 28. Wildlife dissipates the impulse at 18 units per second while retaining its flee-first behavior.

Dependencies: `SpeedPlayer` traversal context, `TraversalMelee`, `SlideImpact`, and `WildlifeAgent`. The impact resolution is constant-time and runs only after a qualifying contact.

Out of scope: slam impact, player damage, wildlife health, stun, animation, rewards, and collision response.
