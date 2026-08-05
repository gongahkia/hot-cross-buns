# World-generation contract tests

`world_generation_contract_test.gd` complements exact golden fixtures with invariant coverage: seeded repeatability, negative/positive region boundaries, local scale metadata, climate bounds, water classification, chunk center/ID mapping, chunk-to-region agreement, family coverage, and descriptor copy isolation.

The fixture scans only a bounded 17×17 region grid and five sample/chunk points. It does not replace the versioned exact-output fixtures, exhaustive coordinate testing, streamed mesh/collision checks, or hardware rendering validation.
