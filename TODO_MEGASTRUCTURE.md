# Megastructure Integration Backlog

Project: `a-slow-walk`

This backlog is intentionally staged. Do not attempt all milestones in one agent run.

## Global rules

- [x] Read `docs/design-pillars.md` before making changes.
- [x] Read `docs/megastructure-design-spec.md`.
- [x] Read `docs/megastructure-technical-design.md`.
- [ ] Preserve deterministic, load-order-independent generation.
- [ ] Preserve the current normal-frame mutual deferral of heavyweight streaming work.
- [ ] Keep worker generation pure-data and main-thread attachment explicit.
- [ ] Do not remove pixelation to solve readability.
- [ ] Do not introduce Rust/GDExtension without a measured hotspot and an owner decision.
- [ ] Keep each commit limited to one coherent task.
- [ ] Run relevant validation before every commit.
- [ ] Record owner decisions and meaningful architecture changes in docs.

# Milestone 0 — Repository audit and contracts

Goal: establish exact integration points without changing world appearance.

- [x] M0.1 Run and record the three existing headless validation commands.
- [x] M0.2 Inspect `scripts/world_generator.gd` and document descriptor boundaries.
- [x] M0.3 Inspect `scripts/world_streamer.gd` and document all normal-frame queue arbitration.
- [x] M0.4 Identify the current stable hashing and seeded-random utilities.
- [x] M0.5 Identify the current test organization and naming convention.
- [x] M0.6 Identify unused or safely extendable debug input bindings.
- [x] M0.7 Copy approved `MEGA-*` invariants into `docs/design-pillars.md`.
- [x] M0.8 Add a short architecture note showing the chosen file layout and why.
- [x] M0.9 Add empty or minimal test entry points only where consistent with the repository.
- [x] M0.10 Re-run all baseline tests and commit the documentation/scaffolding.

Exit criteria:

- No intended runtime visual change.
- Baseline tests pass.
- Queue-arbitration behavior is explicitly documented.
- The next milestone has known file-level integration points.

# Milestone 1 — Deterministic vertical slice descriptor

Goal: represent one infrastructure-spine megastructure and one entry sequence as pure deterministic data.

- [x] M1.1 Define canonical megacell and structure identity inputs.
- [x] M1.2 Add minimal pure-data types for structure, sector, route, entry, and reveal descriptors.
- [x] M1.3 Implement deterministic generation for one fixed archetype version.
- [x] M1.4 Generate one playable entry descriptor with approach, threshold, post-threshold anchor, and initial reveal.
- [x] M1.5 Generate one baseline route through the opening sector.
- [x] M1.6 Generate one optional traversal shortcut using an existing movement ability.
- [x] M1.7 Generate one survival detour tied to water, warmth, shelter, or exposure.
- [x] M1.8 Add canonical serialization or hashing for descriptor comparison.
- [x] M1.9 Add forward/reverse/shuffled determinism tests.
- [x] M1.10 Commit only after deterministic tests and baseline tests pass.

Exit criteria:

- Same seed and version produce byte- or hash-equivalent descriptors.
- Descriptor results do not depend on generation order.
- Entry and initial reveal exist as data.
- No full visual implementation is required yet.

# Milestone 2 — Debug visualization and entry prototype

Goal: make the first structure understandable in a controlled test scene or fixed seed.

- [x] M2.1 Add debug visualization for structure bounds, sectors, routes, entry threshold, and reveal focus.
- [x] M2.2 Compile coarse structure masses for the first archetype.
- [x] M2.3 Place the player outside or at a liminal approach.
- [x] M2.4 Make the player cross the generated threshold through normal movement.
- [x] M2.5 Create the compressed opening route.
- [x] M2.6 Create the first internal scale reveal.
- [x] M2.7 Ensure the reveal includes a readable foreground route and distant structure continuation.
- [x] M2.8 Add a temporary deterministic signature sector or landmark.
- [x] M2.9 Validate the sequence manually through `./script/build_and_run.sh`.
- [x] M2.10 Re-run headless tests and commit.

Exit criteria:

- The first minutes demonstrate approach, entry, compression, and internal reveal.
- The player can infer that the local route belongs to a much larger structure.
- The prototype remains deterministic.

# Milestone 3 — Chunk intersection and boundary contracts

Goal: compile the macrostructure into existing streamed chunks.

- [x] M3.1 Implement pure chunk intersection for macro and sector descriptors.
- [x] M3.2 Define canonical shared-boundary keys.
- [x] M3.3 Generate matching traversal ports for neighboring chunks.
- [x] M3.4 Generate matching structural continuation ports.
- [x] M3.5 Add boundary-contract tests.
- [x] M3.6 Integrate megastructure intersection data into existing chunk descriptors.
- [x] M3.7 Confirm cache eviction does not alter results.
- [x] M3.8 Confirm worker completion order does not alter results.
- [x] M3.9 Add debug display for boundary ownership.
- [x] M3.10 Commit after determinism, boundary, and baseline tests pass.

Exit criteria:

- Neighboring chunks agree independently.
- No visible seam invalidates mandatory traversal.
- Generation remains load-order independent.

# Milestone 4 — Streaming LOD integration

Goal: stream the structure without regressing frame pacing.

- [x] M4.1 Add macro/far silhouette descriptor compilation.
- [x] M4.2 Add sector-shell descriptor compilation.
- [x] M4.3 Add active collision descriptor compilation.
- [x] M4.4 Add traversal-detail descriptor compilation.
- [x] M4.5 Integrate logical queues without bypassing heavyweight mutual exclusion.
- [ ] M4.6 Add reveal-aware priority bias.
- [ ] M4.7 Ensure reveal priority remains subordinate to frame budgets.
- [ ] M4.8 Add phase timings to F3 diagnostics.
- [ ] M4.9 Add phase timings to JSON profile export without silently breaking its schema.
- [ ] M4.10 Extend the streaming-budget test with entry and first-reveal cases.
- [ ] M4.11 Run a fresh L-profile traversal and inspect all hitches.
- [ ] M4.12 Commit only after no unexplained regression.

Exit criteria:

- The first megastructure can be approached, entered, and revealed through normal streaming.
- Heavy construction categories remain mutually deferred in normal frames.
- No unexplained hitch regression is accepted.

# Milestone 5 — Traversal validation

Goal: make routes derive from the existing player movement vocabulary.

- [ ] M5.1 Encode conservative movement envelopes for walk, jump, double jump, dash, slide, wall-run, grapple, glide, and drop.
- [ ] M5.2 Validate the baseline entry route.
- [ ] M5.3 Validate the optional expressive route.
- [ ] M5.4 Validate recovery volumes where required.
- [ ] M5.5 Validate affordance visibility before commitment.
- [ ] M5.6 Add route-preservation checks after damage.
- [ ] M5.7 Add a generated cross-chunk route test.
- [ ] M5.8 Add a rapid traversal soak through the opening sector.
- [ ] M5.9 Commit after all route and baseline tests pass.

Exit criteria:

- Every tested opening sector has a baseline route.
- Advanced routes fit conservative movement limits.
- Mandatory affordances are visible from their commitment points.

# Milestone 6 — Construction history, damage, hydrology, and ecology

Goal: make the megastructure feel accumulated and reclaimed.

- [ ] M6.1 Add ordered construction epochs.
- [ ] M6.2 Make later epochs attach to or cut through prior systems.
- [ ] M6.3 Add constrained damage.
- [ ] M6.4 Add hydrology effects tied to broken infrastructure.
- [ ] M6.5 Add ecological reclamation tied to light, water, material, and exposure.
- [ ] M6.6 Derive at least one survival opportunity from utility history.
- [ ] M6.7 Revalidate mandatory routes after every transformation stage.
- [ ] M6.8 Add a historical reveal showing multiple epochs at once.
- [ ] M6.9 Commit after route preservation and baseline tests pass.

Exit criteria:

- Visible layers communicate ordered history.
- Ecology responds to structure rather than random prop density.
- Survival systems are connected to infrastructure.

# Milestone 7 — Generalization

Goal: prove the system can support more than one structure family.

Do not begin until the infrastructure-spine vertical slice is convincing and stable.

- [ ] M7.1 Extract only the abstractions demonstrated by the first archetype.
- [ ] M7.2 Add one second archetype with meaningfully different topology.
- [ ] M7.3 Reuse entry, reveal, route, boundary, and streaming contracts.
- [ ] M7.4 Add cross-archetype determinism tests.
- [ ] M7.5 Document which concepts remain archetype-specific.
- [ ] M7.6 Decide whether a declarative grammar is now justified.

Possible second archetypes:

- reservoir megastructure;
- vertical habitation lattice;
- buried machine complex;
- suspended transport web.

Exit criteria:

- Two archetypes share infrastructure without being superficial parameter variants.
- No speculative general-purpose grammar is added without demonstrated need.

# Explicitly deferred

- [ ] Automatic extraction of grammars from media or screenshots.
- [ ] General-purpose standalone megastructure editor.
- [ ] Non-Euclidean world topology.
- [ ] Engineering-grade structural simulation.
- [ ] Fully procedural interiors for every distant module.
- [ ] Custom rendering engine.
- [ ] Rust rewrite.
