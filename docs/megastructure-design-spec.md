# Megastructure Expansion Design Specification

Status: proposed implementation specification  
Project: `a-slow-walk`  
Authority: subordinate to `docs/design-pillars.md`; approved invariants from this document should eventually be copied there.  
Primary runtime: Godot 4.7, GDScript, GL Compatibility renderer.

## 1. Purpose

Extend the deterministic reclaimed-Earth world so that expeditions take place inside, across, beneath, and around civilization-scale megastructures.

The feature is not a decorative city generator. It must generate a world whose architecture has:

- civilization-scale continuity;
- local traversability;
- visible construction history;
- survival-relevant infrastructure;
- deterministic identity;
- readable movement affordances;
- occasional views that reveal the structure's true scale.

The intended experience is:

> The player spends most of the expedition in legible local spaces, then periodically reaches an opening, shaft, bridge, roof, breach, transit canyon, or exterior threshold that reveals that the local space is a tiny part of an incomprehensibly larger structure.

## 2. Product thesis

`a-slow-walk` should not generate isolated buildings placed on terrain.

It should generate a layered world in which terrain, buildings, transit, tunnels, reservoirs, supports, utilities, ruins, and ecology are local expressions of larger systems.

The generator should answer:

1. Which megastructure occupies this world location?
2. Which civilization-scale systems cross this location?
3. Which sector, construction epoch, and functional layer does this chunk expose?
4. Which routes must cross the chunk boundary?
5. What can the player infer about the larger structure from this local space?
6. Where will the next scale reveal occur?

## 3. Required scale hierarchy

The world must be understandable at three scales.

### 3.1 Local scale

The space immediately used for traversal and survival:

- ledges;
- corridors;
- rooms;
- roofs;
- shafts;
- platforms;
- grapple anchors;
- water sources;
- shelter;
- hazards;
- pickups.

Local spaces must remain readable at traversal speed.

### 3.2 Sector scale

The surrounding functional district:

- a transit interchange;
- reservoir complex;
- habitation lattice;
- industrial hall;
- cooling system;
- maintenance layer;
- ruined civic volume;
- vertical garden;
- freight spine.

Sector-scale form should explain why local spaces are arranged as they are.

### 3.3 Megastructure scale

The civilization-scale system:

- parallel walls extending beyond visibility;
- a suspended deck crossing several regions;
- towers disappearing into cloud or haze;
- an inhabited structural lattice;
- a planetary transit or utility spine;
- kilometer-scale shafts and voids;
- interlocking construction layers from different eras.

The full megastructure should rarely be visible at once. It should be inferred from repeated systems, distant silhouettes, route continuity, and occasional major reveals.

## 4. Entry contract

Every authored level and every procedural expedition start must begin with entry into a megastructure.

"Entry" does not require a conventional doorway. It requires a clear spatial threshold between an outside or liminal approach and the structure's interior system.

Valid entry forms include:

- walking beneath an enormous elevated deck;
- crossing through a breached perimeter wall;
- descending into a buried service layer;
- entering a transit aperture;
- climbing from wilderness into an exposed structural frame;
- arriving by an exterior maintenance bridge;
- entering through a reservoir spillway;
- moving from ruined surface settlement into older infrastructure.

Every entry sequence must contain four beats:

1. **Orientation**  
   The player can identify the structure as a destination or surrounding mass.

2. **Threshold**  
   The player crosses a visually and spatially legible boundary.

3. **Compression**  
   The world narrows into local traversal, partially hiding the total scale.

4. **Internal reveal**  
   Soon after entry, the player sees an atrium, shaft, bridge network, exterior breach, long transit canyon, or other view confirming that the interior is much larger than the initial route.

The entry sequence must not be a non-interactive cutscene. It should be playable and use the normal movement system.

## 5. Scale-reveal contract

The player should not continuously see the entire megastructure. Constant exposure reduces scale and undermines local navigation.

Instead, the generator must create a cadence of compression and release.

### 5.1 Reveal types

- **Entry reveal**: establishes the destination before crossing the threshold.
- **Internal void reveal**: opens onto a vast shaft, atrium, canyon, or machine chamber.
- **Exterior breach reveal**: exposes distant parts of the same structure through damage.
- **Elevation reveal**: roof, tower, lift shaft, or climbing route reveals the surrounding system.
- **Transit reveal**: a bridge or corridor aligns with a distant continuation.
- **Cross-region reveal**: the player sees the structure pass through a different biome or region family.
- **Historical reveal**: several construction epochs become visible in one composition.
- **Impossible-scale reveal**: a rare recursive or geometrically disorienting vista used as an authored exception.

### 5.2 Reveal requirements

Every major reveal must:

- show at least one structure component far beyond the active local sector;
- preserve a readable foreground route;
- contain a strong silhouette or negative-space shape;
- include a visual scale reference such as platforms, windows, transit lines, trees, water, birds, or repeated modules;
- be reachable through normal gameplay;
- remain deterministic for the same seed and generation version;
- avoid requiring dense detail at extreme distance;
- avoid creating a streaming hitch when it becomes visible.

### 5.3 Reveal placement

Reveal candidates should be derived from the generated structure rather than scattered randomly.

Good candidates include:

- sector-graph articulation points;
- intersections of major circulation trunks;
- boundaries between construction epochs;
- intersections with the exterior envelope;
- large void volumes;
- high-centrality transit hubs;
- hydrology breaches;
- collapsed support spans;
- transitions between region families;
- authored landmark ports.

A generated expedition should always have:

- one entry reveal;
- one internal reveal during the opening route;
- later reveals at major route or sector transitions;
- at least one reveal associated with a survival decision or landmark.

Exact frequency should be tuned through playtesting rather than fixed to a time interval.

## 6. Spatial rhythm

The desired rhythm is:

```text
approach
→ macro read
→ threshold
→ compressed local route
→ internal scale reveal
→ local traversal and survival
→ partial exterior or vertical reveal
→ deeper functional layer
→ landmark or extraction-scale reveal
```

Large vistas are punctuation. Most gameplay remains local and mechanically legible.

## 7. Generation hierarchy

Recommended deterministic hierarchy:

```text
world seed + generation version
  → canonical megacell coordinate
    → megastructure field descriptor
      → megastructure descriptor
        → construction epochs
        → structural graph
        → circulation graph
        → utility graph
        → void volumes
        → sector graph
        → reveal anchors
        → entry anchor
          → chunk intersections
            → terrain descriptor
            → sector shell descriptor
            → traversal detail descriptor
            → collision descriptor
            → far-silhouette descriptor
```

Suggested initial megacell size: 4096 world units. This is a starting value, not an invariant. It must be large enough to define structure identity above the existing 512-unit region scale.

## 8. First archetype

The first implementation should use one archetype:

> A ruined transcontinental infrastructure spine crossing wilderness, reclaimed-city, flooded-city, and industrial-ruin regions.

Required components:

- two or more primary load-bearing walls or cores;
- an elevated transit and utility corridor;
- later habitation attached to older infrastructure;
- roof and exterior maintenance routes;
- flooded lower service levels;
- broken spans;
- ecological reclamation where water and light accumulate;
- warm machinery or utility refuges;
- one authored signature sector;
- a visible continuation beyond the active region.

This archetype is compatible with the existing horizontal chunk streamer while introducing controlled verticality.

## 9. Construction history

Every megastructure should derive visible form from ordered construction epochs.

Initial epoch model:

1. planetary-scale infrastructure;
2. habitation attached to the original system;
3. emergency expansion during ecological collapse;
4. autonomous-machine additions;
5. salvage and temporary human adaptation;
6. long abandonment and ecological reclamation.

Each epoch defines:

- grammar or module family;
- materials;
- preferred elevation;
- attachment policy;
- intended functions;
- relationship with prior epochs;
- damage profile;
- hydrology interaction;
- vegetation susceptibility;
- route types it tends to create.

Damage and ecology must operate on this history. They must not be independent decoration.

## 10. Traversal contract

Generation order:

```text
macrostructure
→ sector topology
→ mandatory routes
→ optional and advanced routes
→ route validation
→ structural geometry
→ construction epochs
→ damage
→ hydrology and ecology
→ route revalidation
→ chunk compilation
```

Mandatory routes must be protected from destructive operations unless a validated replacement exists.

Each route edge should record:

- route type;
- start and end anchors;
- movement envelope;
- horizontal and vertical distance;
- required speed or ability;
- landing volume;
- recovery route;
- exposure cost;
- fatigue cost;
- affordance-visibility requirement;
- chunk-boundary ports.

Route classes:

- baseline expedition route;
- expressive traversal route;
- survival detour;
- discovery route.

## 11. Survival integration

Infrastructure should produce survival opportunities and hazards.

Examples:

- failed water mains create flooded sectors and contaminated water;
- functioning heat exchangers create warm refuges;
- ventilation towers create sheltered routes or toxic exhaust;
- broken power systems illuminate, energize, or block routes;
- drainage systems collect water and vegetation;
- exposed exterior maintenance routes increase wetness and exposure;
- enclosed machine layers increase warmth but reduce water access;
- utility hubs provide crafting resources;
- damaged habitation layers provide food remnants and temporary shelter.

Resources should therefore be partially derived from function and history rather than distributed independently.

## 12. Authored-content contract

The internal creative editor remains part of the system.

Authored content should provide signature sectors, not complete worlds.

An authored sector should expose:

- traversal entry and exit ports;
- utility ports;
- structural attachment ports;
- required clearances;
- supported transformations;
- damage variants;
- far-silhouette representation;
- active scene;
- deterministic placement constraints.

The procedural generator may place, rotate, partially bury, flood, damage, reclaim, or connect an authored sector only within its declared contract.

## 13. Visual direction

Preserve the low-poly, pixel-forward presentation.

Do not solve readability by removing pixelation.

Scale should be communicated through:

- silhouette;
- repetition;
- negative space;
- atmospheric depth;
- layered lighting;
- module rhythm;
- visible transit and utility lines;
- water and vegetation;
- small repeated scale references;
- foreground-to-background composition.

Overcast and shadowed rendering remain a separate concern. Megastructure interiors should include large openings, atmospheric shafts, bright exterior breaches, functioning lights, reflective water, and strong value separation. Uniform darkness is not an acceptable substitute for scale.

## 14. Non-goals for the first implementation

Do not initially build:

- a general-purpose external megastructure product;
- automatic analysis of films, manga, or game screenshots;
- engineering-grade structural simulation;
- a custom renderer;
- complete interiors for every visible module;
- non-Euclidean world topology;
- unrestricted procedural destruction;
- a large grammar language;
- many archetypes at once;
- Rust/GDExtension code without measured need.

## 15. Authoritative invariants to merge into `docs/design-pillars.md`

```text
MEGA-EXPERIENCE-001
Most traversal occurs in local, readable spaces, but deterministic reveal
points must periodically expose civilization-scale continuity.

MEGA-ENTRY-001
Every authored level and procedural expedition begins with a playable entry
sequence that establishes, crosses into, and internally reveals a megastructure.

MEGA-SCALE-001
A megastructure is defined above chunk and region scale. Chunks only compile
local intersections of a persistent macrostructure.

MEGA-DET-001
Megastructure identity and macrographs depend only on world seed, generation
version, and canonical coordinates.

MEGA-DET-002
Sector and chunk descriptors must not depend on chunk load order, loaded
neighbors, frame timing, or cache state.

MEGA-SEAM-001
Every cross-chunk structural and traversal connection is defined by a canonical
shared-boundary contract.

MEGA-ROUTE-001
Every active sector has at least one validated baseline route connected to the
expedition network.

MEGA-ROUTE-002
Damage, flooding, and reclamation may not remove a mandatory route without
providing and validating a replacement.

MEGA-VIS-001
Every mandatory movement affordance is recognizable at the distance and speed
from which the player must commit.

MEGA-HISTORY-001
Visible architectural layers derive from ordered construction epochs rather
than independent decorative randomization.

MEGA-STREAM-001
Megastructure attachment must preserve the normal-frame mutual deferral of
active-chunk, collision-LOD, far/detail, and other heavyweight construction.
