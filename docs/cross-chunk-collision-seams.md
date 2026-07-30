# Cross-chunk collision seams

`world_collision_seam_test.gd` validates equal absolute boundary heights for adjacent terrain collision heightmaps at matching and mixed LOD grids, then raycasts active streamed terrain across both origin-adjacent chunk seams. It compares physics hit height to the authoritative world sample at collision vertices.

The fixture is bounded to four seams and four rays. It does not prove arbitrary player traversal trajectories, urban-feature connector seams, every LOD transition while moving, or GPU mesh appearance.
