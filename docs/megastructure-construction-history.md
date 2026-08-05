# Megastructure construction history

The infrastructure-spine descriptor carries six ordered epochs as pure data. Geometry, damage, hydrology, and ecology transformations consume this exact order; they must not independently randomize history.

| Order | Epoch | Relation to prior work |
| ---: | --- | --- |
| 1 | planetary infrastructure | origin |
| 2 | attached habitation | attaches to epoch 1 |
| 3 | emergency expansion | cuts through epoch 2 |
| 4 | machine additions | attaches to epoch 1 |
| 5 | salvage adaptation | reuses epochs 2 and 4 |
| 6 | ecological reclamation | overgrows all prior epochs |

Each epoch declares grammar, material, elevation, attachment, function, damage, hydrology, and reclamation data. The list is canonical, introduced in descriptor schema v6, and carried forward by later schemas.

## Structural relationships

Schema v7 adds one canonical construction element per epoch. Later elements name attachment and cut targets from an earlier epoch: habitation brackets to the primary spine; the emergency channel cuts habitation; machine clamps attach to the spine; salvage reuses the breach and cuts a machine clamp; and reclamation roots attach at the breach. These are deterministic structural relationships, not decorative tags.

## Constrained damage

Schema v8 adds deterministic damage records against habitation and machine elements only. Every record carries its target epoch, bounds, type, severity, and an empty affected-route set. Route validation rejects damage that names or intersects a mandatory route.

## Infrastructure hydrology

Schema v9 derives one hydrology record from each broken infrastructure element: a rainwater inflow at breached habitation and a coolant seep at damaged machinery. Effects retain their source damage/element IDs, bounded water level, quality, and route-safe bounds. Hydrology is therefore caused by damage rather than independent prop placement.

## Ecological reclamation

Schema v10 derives ecology from infrastructure hydrology, source-element epoch material, and explicit light/exposure conditions. Breach daylight plus rainwater produces wetland lichen on cladding; reflected utility light plus coolant seep produces moss on machine ceramic. Ecological records cannot name or spatially overlap mandatory routes.

## Utility-derived survival

Schema v11 binds the existing warm-utility refuge detour to the autonomous-machine epoch, its machine-clamp element, and its coolant-seep hydrology. The opportunity repeats the route's warmth recovery value, so utility history is the declared source of survival value rather than a separate random pickup.

## Route validation stages

Schema v12 snapshots the mandatory-route contract after construction epochs, element attachment, damage, hydrology, ecology, and utility-derived survival. Generation reruns mandatory-route preservation validation after each stage; its baseline, recovery, and visibility checks reject a changed mandatory route. The descriptor schema no longer changes the spatial RNG, so metadata migrations preserve the generated layout until an explicit layout version update.

## Historical reveal

Schema v13 adds a cross-section reveal bound to all six construction elements and epochs. Chunk compilation clips the source elements into history layers; normal detail attachment renders their epoch-coded translucent volumes together at the reveal, without adding collision or changing routes.
