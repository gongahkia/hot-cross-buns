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

## Expressive grapple contract

`validate_expressive_route` requires one non-mandatory grapple route, with a matching declared ability and a unique actionable segment. Its horizontal, rise, drop, and endpoint-to-anchor distances must fit the conservative envelope. The compiled traversal segment carries the same anchor used by runtime attachment. Descriptor schema v3 records this changed route topology, so v2 identities and canonical hashes remain incompatible by design.

## Recovery-volume contract

Every route marked `recovery_required` must provide an explicit volume around its landing. It must contain the landing, leave at least two horizontal units on every side, start on the known flat floor, and provide two units of headroom. The grapple shortcut is currently the sole recovery-required route. These volumes are pure route data for later damage and hydrology revalidation; they do not add a separate runtime recovery system.

## Affordance-visibility contract

`validate_affordance_visibility` requires the entry threshold to be geometrically exposed at least 96 units before crossing, and requires the grapple anchor to be at least 12 units from its commitment point while remaining inside its 26-unit acquisition range. This is a deterministic geometric check over descriptors; occlusion and final rendering legibility remain runtime/playtest concerns.

## Post-damage preservation contract

`validate_route_preservation(before, after)` compares a descriptor with its transformed result. It requires every mandatory route ID, movement mode, anchors, and waypoints to remain unchanged; then reruns baseline, recovery, and visibility validation on the result. M6 damage, hydrology, and ecology transforms must run this pure check before publishing a descriptor. A future validated replacement-route policy must extend this contract explicitly rather than silently changing a mandatory path.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_route_validator_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_cross_chunk_route_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_rapid_traversal_test.gd
```
