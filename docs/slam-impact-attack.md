# Slam-impact attack

An eligible slam hit applies a radial horizontal wildlife impulse scaled from 10 at speed 16 to 24 at speed 38. Slam detection uses the higher of planar and vertical player speed, allowing steep impacts to qualify.

Dependencies: `SpeedPlayer` traversal context, `TraversalMelee`, `SlamImpact`, and `WildlifeAgent`. Resolution is constant-time after a qualifying contact.

Out of scope: area damage, terrain shockwaves, player damage, wildlife health, stun, rewards, animation, and collision response.
