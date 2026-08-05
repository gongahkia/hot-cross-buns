# Scientific-fidelity audit

This is a boundary audit, not a certification. Deterministic fixtures prove port repeatability and source-rule equivalence only; they do not validate real-world prediction, calibration, or scientific fitness.

| Subsystem | Evidence | Fidelity status | Explicit simplification |
| --- | --- | --- | --- |
| RNG/noise, scale, plates, drift, hotspots, ocean, continents, tectonics | source-port fixtures; R-005 | procedural approximation | no geodynamic solver or calibrated plate history |
| orometry, prominence, lithology, soils | source fixtures; R-006/R-007 | classification/synthesis approximation | prominence/isolation are bounded-grid descriptors; no field survey calibration |
| priority flood, D8, accumulation, basin, lakes, rivers | source fixtures; R-001/R-002 | algorithmically grounded local routing | finite local grids, no continental drainage continuity |
| stream power, hillslope, debris, glaciers, periglacial, aeolian, karst | source fixtures; R-003/R-008/R-010/R-012/R-015 | stylized parameterizations | no coupled time-stepping, mass conservation, or calibrated material properties |
| volcanoes, coasts, bathymetry, reefs | source fixtures | morphology heuristics | no eruption, wave, sediment, ocean-current, or coral-growth simulation |
| climate bands, orographic climate, Köppen, weather, biomes | source fixtures; R-011 | deterministic climate/gameplay heuristic | no circulation model, reanalysis calibration, or forecast skill claim |

## Audit decision

All listed ports are acceptable as deterministic world-generation approximations. They must not be described as scientific simulations. Any change to a cited subsystem requires: source/parameter provenance in [research-citation-registry.md](research-citation-registry.md), a deterministic fixture, an approximation statement, and a performance review.

## Dependencies

- [research-citation-registry.md](research-citation-registry.md), source-port tests, and individual subsystem documents.

## Performance impact

No runtime impact.

## Out of scope

- Empirical validation, parameter calibration, uncertainty quantification, and research-use certification.
