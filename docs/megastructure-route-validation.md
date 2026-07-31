# Megastructure route validation

## Movement-envelope policy

`WorldMegastructureRouteValidator` provides pure, JSON-safe limits used before geometry is attached. Limits apply to one movement commitment between authored/generated anchors; they do not model player-physics simulation.

| Mode | Horizontal | Rise | Drop | Additional condition |
| --- | ---: | ---: | ---: | --- |
| walk | unbounded | 0 | 0 | grounded slope ≤35° |
| jump | 6 | 1.1 | 3 | — |
| double jump | 10 | 2.1 | 3 | — |
| dash | 3 | 0 | 3 | — |
| slide | unbounded | 0 | 0 | grounded slope ≤25° |
| wall run | 24 | 0 | 3 | — |
| grapple | 20 | 16 | 18 | anchor ≤26 away |
| glide | 60 | 0 | 18 | — |
| drop | 0 | 0 | 2.5 | — |

All values are world units. Grounded modes require an explicit continuous floor; `unbounded` does not permit a gap. The landing limit is below the no-injury threshold in `SpeedPlayer`. Air-mode limits exclude combinations with other abilities, boosts, moving geometry, or survival-speed penalties. This preserves a margin below the current player constants and makes a failed analytic check reject a route rather than infer a permissive exception.

## Baseline entry contract

`validate_baseline_entry` requires the entry's sole required route to be mandatory, walking, and baseline-class. It proves that the approach, post-threshold, first-goal, threshold volume, and initial reveal are connected in order; confirms every route anchor has flat-interior ground support; and returns stable issue codes for invalid descriptors. The generator asserts this pure-data contract before returning a descriptor, so a seed/version regression fails at generation rather than after attachment.
