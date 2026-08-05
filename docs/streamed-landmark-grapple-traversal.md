# Streamed-landmark grapple traversal

Every streamed landmark receives a child `grapple_anchor` above its deterministic landmark geometry. The existing player grapple candidate query already uses that group, so anchors participate only while their owning chunk is loaded and follow origin rebases with the landmark.

Dependencies: `WorldLandmarks`, `WorldLandmarkGrapple`, `WorldStreamer`, and `SpeedPlayer`'s grouped-anchor query. This adds one node and one small torus mesh per active landmark; no per-frame landmark traversal query was added.

Out of scope: changing grapple physics, pathfinding to landmarks, anchors for unloaded chunks, and replacing the ordinary deterministic chunk anchors.
