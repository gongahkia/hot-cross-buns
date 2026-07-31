# Megastructure Generation and Streaming Technical Design

Status: implementation proposal  
Related specification: `docs/megastructure-design-spec.md`

## 1. Existing boundaries to preserve

The implementation must preserve:

- deterministic generation from seed, coordinate, and generation version;
- independence from chunk load order;
- worker-side pure descriptor generation;
- main-thread visual, collision, and scene attachment;
- 5×5 active chunk window;
- LRU descriptor cache;
- preload corridor;
- floating-origin rebasing;
- collision handoff during replacement;
- existing render and collision LOD behavior;
- the normal-frame policy that active-chunk construction, collision-LOD
  construction, and far/detail construction are mutually deferred;
- existing smoke, runtime-budget, and traversal-soak tests.

The first version should remain in GDScript. Only measured pure-data hotspots are candidates for a later GDExtension.

## 2. Proposed file layout

This is a target layout. Adapt names to existing repository conventions after inspection.

```text
scripts/
  megastructure/
    megastructure_types.gd
    megastructure_hash.gd
    megastructure_generator.gd
    megastructure_graph.gd
    megastructure_intersection.gd
    megastructure_route_validator.gd
    megastructure_reveal_planner.gd
    megastructure_chunk_compiler.gd
    megastructure_debug_draw.gd
tests or scripts/
  megastructure_determinism_test.gd
  megastructure_boundary_contract_test.gd
  megastructure_route_test.gd
  megastructure_streaming_budget_test.gd
```

Do not create this entire tree before confirming how the repository currently organizes tests and data classes.

## 3. Data model

Use pure data objects or dictionaries that are safe to produce on worker threads. Avoid Node, Resource mutation, RenderingServer calls, and SceneTree access during descriptor generation.

### 3.1 Canonical keys

```gdscript
class_name MegacellKey
extends RefCounted

var coordinate: Vector3i
var generation_version: int
```

Stable identity input:

```text
world seed
generation version
canonical megacell coordinate
archetype version
descriptor schema version
```

Never use runtime object IDs, frame counters, load order, global RNG state, or iteration order from unordered containers as identity inputs.

### 3.2 Megastructure descriptor

```gdscript
class_name MegastructureDescriptor
extends RefCounted

var structure_id: int
var megacell: Vector3i
var origin_world: Vector3
var archetype_id: StringName
var archetype_version: int

var epoch_descriptors: Array
var structural_graph
var circulation_graph
var utility_graph
var sector_graph

var envelope_volumes: Array
var void_volumes: Array
var entry_descriptor
var reveal_descriptors: Array
var landmark_anchors: Array

var world_bounds: AABB
var canonical_hash: String
```

### 3.3 Sector descriptor

```gdscript
class_name MegastructureSectorDescriptor
extends RefCounted

var sector_id: int
var structure_id: int
var function_id: StringName
var epoch_ids: PackedInt32Array

var world_bounds: AABB
var structural_elements: Array
var route_edges: Array
var utility_elements: Array
var voids: Array
var survival_effects: Array

var far_representation
var shell_representation
var detail_representation
```

### 3.4 Entry descriptor

```gdscript
class_name MegastructureEntryDescriptor
extends RefCounted

var entry_id: int
var structure_id: int

var approach_anchor: Vector3
var threshold_volume: AABB
var post_threshold_anchor: Vector3
var initial_reveal_id: int
var first_goal_anchor: Vector3

var entry_type: StringName
var required_route_edges: PackedInt64Array
var foreground_structure_ids: PackedInt64Array
var distant_structure_ids: PackedInt64Array
```

### 3.5 Reveal descriptor

```gdscript
class_name MegastructureRevealDescriptor
extends RefCounted

var reveal_id: int
var structure_id: int
var reveal_type: StringName

var trigger_volume: AABB
var recommended_view_anchor: Vector3
var recommended_view_direction: Vector3

var foreground_bounds: AABB
var focus_bounds: AABB
var background_bounds: AABB

var required_far_structure_ids: PackedInt64Array
var required_route_ids: PackedInt64Array
var minimum_visibility_distance: float
var streaming_priority_bias: int
```

A reveal descriptor is not a camera cut. It describes a deterministic composition and the assets that must be prepared before the player reaches it.

### 3.6 Traversal edge

```gdscript
class_name MegastructureTraversalEdge
extends RefCounted

enum RouteType {
    WALK,
    JUMP,
    DOUBLE_JUMP,
    DASH_GAP,
    SLIDE_PASSAGE,
    WALL_RUN,
    GRAPPLE,
    GLIDE,
    DROP,
    TEMPORARY_CONSTRUCTION,
}

var edge_id: int
var from_port_id: int
var to_port_id: int
var route_type: RouteType

var start_world: Vector3
var end_world: Vector3
var landing_bounds: AABB
var recovery_bounds: AABB

var horizontal_distance: float
var vertical_delta: float
var required_speed: float
var exposure_cost: float
var fatigue_cost: float
var affordance_visibility_distance: float

var mandatory: bool
var boundary_contract_id: int
```

The route validator should initially use conservative analytic envelopes. It does not need to run full player physics for every generated edge.

## 4. Deterministic generation pipeline

```text
1. Resolve canonical megacell key.
2. Select archetype deterministically.
3. Generate structure envelope and primary axes.
4. Generate structural graph.
5. Generate sector graph.
6. Generate circulation and mandatory routes.
7. Generate optional, survival, and discovery routes.
8. Validate route topology.
9. Generate utility graph.
10. Generate construction epochs.
11. Generate void volumes.
12. Select entry anchor and threshold.
13. Select reveal candidates and score them.
14. Apply constrained damage.
15. Apply hydrology and ecological reclamation.
16. Revalidate routes and entry.
17. Compute canonical descriptor hash.
18. Cache macro descriptor.
19. Intersect descriptor with requested chunks.
20. Compile chunk-local far, shell, collision, and detail descriptors.
```

Random streams should be split by stable labels:

```text
structure-envelope
structural-graph
sector-graph
mandatory-routes
optional-routes
utilities
entry
reveals
epoch-<id>
damage-<id>
hydrology
ecology
chunk-intersection-<coordinate>
```

Changing one stage should not unnecessarily perturb all later random decisions.

## 5. Boundary contracts

Cross-chunk features must be owned by a canonical shared key.

```gdscript
func canonical_boundary_key(a: Vector3i, b: Vector3i, layer: StringName) -> String:
    var first := _lexicographic_min(a, b)
    var second := _lexicographic_max(a, b)
    return "%s|%s|%s|%s|%s" % [
        world_seed,
        generation_version,
        first,
        second,
        layer,
    ]
```

The actual implementation should use the repository's stable hash utility, not string hashing if a stronger canonical encoding already exists.

Boundary contracts cover:

- route ports;
- bridge endpoints;
- tunnel apertures;
- wall openings;
- structural continuations;
- utility conduits;
- water flow;
- collision overlap or handoff regions.

Both chunks independently compile the same boundary result.

## 6. Chunk compilation

A chunk should not regenerate the full megastructure.

Recommended cache hierarchy:

```text
Megastructure descriptor cache
  key: seed + generation version + megacell + archetype version

Sector-intersection cache
  key: structure id + sector id + chunk coordinate + compiler version

Existing chunk descriptor cache
  includes compiled local megastructure intersections
```

Each chunk-local result should separate:

- macro/far silhouette;
- sector shell;
- active collision;
- traversal detail;
- decorative detail;
- occluder volumes;
- debug geometry.

## 7. Streaming integration

### 7.1 Worker side

Worker tasks may:

- generate or retrieve megastructure descriptors;
- intersect structures with chunks;
- compile pure mesh buffers if current repository practice allows it safely;
- produce transform lists for repeated modules;
- produce collision shape descriptors;
- compute reveal prerequisites;
- compute canonical hashes.

Worker tasks must not:

- add nodes;
- mutate the SceneTree;
- create or mutate runtime scene instances;
- issue rendering calls;
- assume neighboring chunks are loaded.

### 7.2 Main-thread queues

Possible logical queues:

```text
active terrain/chunk
active megastructure shell
collision replacement
far terrain/megastructure silhouette
feature and traversal detail
occluder attachment
```

These do not imply independent heavy work in the same frame.

### 7.3 Heavyweight mutual exclusion

Normal frames may attach only one heavyweight category:

```text
active chunk
OR active megastructure shell
OR collision replacement
OR far construction
OR detail construction
```

If existing code currently allows two lightweight categories, preserve that behavior only where profiling confirms it remains safe.

The recent fix that prevented active, collision, and far/detail construction from occurring in the same normal frame is an invariant. Do not bypass it through a new megastructure queue.

### 7.4 Reveal-aware preloading

When the player approaches a reveal trigger:

1. raise priority for required far silhouettes;
2. raise priority for the focus sector shell;
3. avoid attaching nonessential decorative detail;
4. confirm required descriptors are ready before the reveal route commits;
5. never pause movement or use a blocking loading screen.

Reveal priority should be advisory. It must still obey frame budgets.

## 8. Far representation

Use three generated representations.

### Macro silhouette

- primary masses;
- towers;
- walls;
- arches;
- suspended decks;
- major voids;
- transit spines.

No windows, rails, props, or dense module detail.

### Sector shell

- floors and decks;
- primary supports;
- bridge geometry;
- large facade divisions;
- major vegetation masses;
- major damage.

### Traversal detail

- ledges;
- openings;
- grapple anchors;
- rails;
- local vegetation;
- pickups;
- route markings;
- small hazards.

Repeated modules should use MultiMesh or equivalent batched instancing where compatible with the existing renderer and culling model.

## 9. Occlusion and interiors

Megastructure interiors require coarse occlusion volumes.

Generate occluders from:

- major walls;
- floor slabs;
- structural masses;
- sealed sector boundaries.

Do not generate occluders from:

- railings;
- pipes;
- small props;
- fine facade modules;
- vegetation.

Interior-to-exterior transitions are explicit test cases because they can expose both culling and streaming failures.

## 10. Floating origin

All immutable descriptors should use canonical world coordinates.

Runtime instances should derive local coordinates from:

```text
canonical world position - current floating-origin offset
```

A rebase must not alter:

- descriptor identity;
- reveal identity;
- route IDs;
- boundary contracts;
- cache keys;
- canonical hashes.

## 11. Debugging

Add a debug overlay or draw mode capable of showing:

- megacell boundaries;
- structure IDs;
- sector bounds and function;
- construction epochs;
- mandatory routes;
- optional routes;
- boundary ports;
- entry threshold;
- reveal trigger and focus volumes;
- far/shell/detail LOD state;
- queue depths;
- descriptor hashes.

Use an available debug key only after checking `scripts/main.gd` and existing bindings.

## 12. Profiling

Add phase timings to existing diagnostics and JSON profile exports:

```text
mega_descriptor_lookup
mega_descriptor_generate
mega_chunk_intersection
mega_route_validate
mega_far_compile
mega_shell_compile
mega_collision_compile
mega_detail_compile
mega_far_attach
mega_shell_attach
mega_collision_attach
mega_detail_attach
mega_occluder_attach
```

The existing hitch threshold and profile format are authoritative unless deliberately versioned.

Do not silently change the telemetry contract.

## 13. Validation

### 13.1 Baseline

Before code changes:

```bash
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/smoke_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_streaming_runtime_budget_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_traversal_soak_test.gd
```

The known DummyShader RID leak diagnostic may remain if all existing assertions pass.

### 13.2 New tests

#### Determinism test

Generate the same megacells and chunk intersections:

- forward;
- reverse;
- shuffled;
- after cache eviction;
- with different worker completion orders.

Compare canonical hashes.

#### Boundary contract test

For neighboring chunks, assert:

- matching route ports;
- matching bridge and tunnel endpoints;
- matching structure continuations;
- matching utility connections;
- compatible collision handoff bounds.

#### Entry contract test

For each tested seed:

- entry descriptor exists;
- approach reaches threshold;
- threshold reaches post-threshold anchor;
- opening route reaches internal reveal;
- required far assets are declared;
- baseline movement envelope is valid.

#### Reveal contract test

Assert:

- focus bounds are beyond local foreground;
- required silhouettes exist;
- reveal trigger lies on a reachable route;
- foreground route remains readable;
- reveal dependencies are preloadable without violating queue policy.

#### Damage preservation test

After all damage, hydrology, and ecology passes:

- mandatory routes remain valid;
- landing volumes remain clear;
- no route port is embedded in collision;
- required supports remain;
- recovery routes remain where required.

#### Streaming-budget test

Cover:

- first entry into the megastructure;
- first internal reveal;
- rapid roof traversal;
- grapple across a chunk boundary;
- exterior-to-interior transition;
- interior-to-exterior transition;
- floating-origin rebase inside the structure;
- a dense far silhouette becoming visible.

## 14. Implementation rule

The first vertical slice should produce one convincing, deterministic entry-and-reveal sequence before generalizing the grammar.

A successful slice is more valuable than a broad framework that cannot yet demonstrate:

- entry;
- local readability;
- large-scale continuity;
- deterministic streaming;
- stable frame pacing.
