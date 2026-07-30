# Original research citation registry

## Purpose and use

This registry is the canonical bibliography for scientific or technical models inherited from Thoth’s terrain design. A citation establishes provenance; it does not validate a simplified game implementation or justify a claim of real-world simulation accuracy. Any new source-derived model must add an entry, declare its approximation, and receive deterministic fixtures before release.

## Verified primary sources

| ID | Model boundary | Citation | Stable source |
| --- | --- | --- | --- |
| R-001 | depression filling and watershed labels | Barnes, R., Lehman, C., & Mulla, D. J. (2014). *Priority-Flood: An optimal depression-filling and watershed-labeling algorithm for digital elevation models*. *Computers & Geosciences*, 62, 117–127. | [doi:10.1016/j.cageo.2013.04.024](https://doi.org/10.1016/j.cageo.2013.04.024) |
| R-002 | D8 drainage routing | O’Callaghan, J. F., & Mark, D. M. (1984). *The extraction of drainage networks from digital elevation data*. *Computer Vision, Graphics, and Image Processing*, 28(3), 323–344. | [doi:10.1016/S0734-189X(84)80011-0](https://doi.org/10.1016/S0734-189X(84)80011-0) |
| R-003 | stream-power incision | Whipple, K. X., & Tucker, G. E. (1999). *Dynamics of the stream-power river incision model*. *Journal of Geophysical Research: Solid Earth*, 104(B8), 17661–17674. | [doi:10.1029/1999JB900120](https://doi.org/10.1029/1999JB900120) |
| R-004 | coupled uplift and fluvial terrain | Cordonnier, G., Braun, J., Cani, M.-P., et al. (2016). *Large Scale Terrain Generation from Tectonic Uplift and Fluvial Erosion*. *Computer Graphics Forum*, 35(2), 165–175. | [doi:10.1111/cgf.12820](https://doi.org/10.1111/cgf.12820) |
| R-005 | plate-tectonic heightmap prototype | Viitanen, L. (2012). *Physically Based Terrain Generation: Procedural Heightmap Generation Using Plate Tectonics* (BEng thesis, Metropolia UAS). | [URN:NBN:fi:amk-201204023993](https://urn.fi/URN:NBN:fi:amk-201204023993) |
| R-006 | orometric terrain analysis | Argudo, O., Galin, E., Peytavie, A., Paris, A., Gain, J., & Guérin, E. (2019). *Orometry-based Terrain Analysis and Synthesis*. *ACM Transactions on Graphics*, 38(6), Article 199. | [doi:10.1145/3355089.3356535](https://doi.org/10.1145/3355089.3356535) |
| R-007 | prominence and isolation | Kirmse, A., & de Ferranti, J. (2017). *Calculating the prominence and isolation of every mountain in the world*. *Progress in Physical Geography*, 41(6), 788–802. | [doi:10.1177/0309133317738163](https://doi.org/10.1177/0309133317738163) |
| R-008 | steep-terrain glacier flow | Egholm, D. L., Knudsen, M. F., Clark, C. D., & Lesemann, J. (2011). *Modeling the flow of glaciers in steep terrains: the integrated second-order shallow ice approximation (iSOSIA)*. *Journal of Geophysical Research: Earth Surface*, 116(F2). | [doi:10.1029/2010JF001900](https://doi.org/10.1029/2010JF001900) |
| R-009 | glacier-model limitations | Zekollari, H., Huss, M., Farinotti, D., & Lhermitte, S. (2022). *Ice-Dynamical Glacier Evolution Modeling—A Review*. *Reviews of Geophysics*, 60(2), e2021RG000754. | [doi:10.1029/2021RG000754](https://doi.org/10.1029/2021RG000754) |
| R-010 | hillslope diffusion theory | Culling, W. E. H. (1960). *Analytical Theory of Erosion*. *The Journal of Geology*, 68(3). | [doi:10.1086/626663](https://doi.org/10.1086/626663) |
| R-011 | orographic precipitation | Smith, R. B., & Barstad, I. (2004). *A Linear Theory of Orographic Precipitation*. *Journal of the Atmospheric Sciences*, 61(12), 1377–1391. | [doi:10.1175/1520-0469(2004)061<1377:ALTOOP>2.0.CO;2](https://doi.org/10.1175/1520-0469(2004)061%3C1377:ALTOOP%3E2.0.CO;2) |
| R-012 | eroded fractal terrains | Musgrave, F. K., Kolb, C. E., & Mace, R. S. (1989). *The synthesis and rendering of eroded fractal terrains*. *ACM SIGGRAPH Computer Graphics*, 23(3), 41–50. | [doi:10.1145/74334.74337](https://doi.org/10.1145/74334.74337) |
| R-013 | coupled ecosystem/erosion authoring | Cordonnier, G., Galin, E., Gain, J., et al. (2017). *Authoring Landscapes by Combining Ecosystem and Terrain Erosion Simulation*. *ACM Transactions on Graphics*, 36(4), Article 134. | [doi:10.1145/3072959.3073667](https://doi.org/10.1145/3072959.3073667) |
| R-014 | terrain clipmaps | Losasso, F., & Hoppe, H. (2004). *Geometry Clipmaps: Terrain Rendering Using Nested Regular Grids*. *ACM Transactions on Graphics*, 23(3), 769–776. | [doi:10.1145/1015706.1015799](https://doi.org/10.1145/1015706.1015799) |
| R-015 | cave-network generation | Paris, A., Guérin, E., Peytavie, A., Collon, P., & Galin, E. (2021). *Synthesizing Geologically Coherent Cave Networks*. *Computer Graphics Forum*. | [doi:10.1111/cgf.14420](https://doi.org/10.1111/cgf.14420) |

## Technical sources

These are implementation references, not empirical research claims:

- Kurt Spencer, [OpenSimplex2](https://github.com/KdotJPG/OpenSimplex2): noise implementation reference.
- Amit Patel, [Polygonal Map Generation](https://www.redblobgames.com/maps/terrain-from-noise/): explanatory terrain-map reference.
- Asirvatham & Hoppe, [Terrain Rendering Using GPU-Based Geometry Clipmaps](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry): implementation adaptation of R-014.

## Corrections and unresolved legacy references

- Thoth’s inherited bibliography attributed *Analytical Theory of Erosion* to 1963 with DOI `10.1086/626606`. The publisher record identifies the article as 1960 with DOI `10.1086/626663`; this registry uses the corrected record.
- The inherited entry “Methods for Procedural Terrain Generation: A Review” is not used as a model source until its author record is reverified. It may inform literature discovery but cannot support a behavior claim.
- The registry omits aesthetic references, game references, and secondary summaries because they are not original model sources.

## Dependencies

- Stable DOI or repository URLs and the migration matrix in [thoth-to-godot-migration-matrix.md](thoth-to-godot-migration-matrix.md).
- Each ported model must link its implementation, approximation notes, fixtures, and benchmark limits back to its registry ID.

## Performance impact

The registry has no runtime cost. It prevents expensive model ports from being justified by an untraceable or incorrect source and provides a review point before scientific modules enter streaming budgets.

## Out of scope

- Reproducing or redistributing papers, datasets, code, or artwork.
- Certifying scientific accuracy, licensing terms, or fitness for research use.
- Treating an unimplemented cited model as a shipped feature.
