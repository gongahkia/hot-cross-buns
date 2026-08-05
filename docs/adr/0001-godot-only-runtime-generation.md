# ADR 0001: Godot-only runtime generation

- Status: accepted
- Date: 2026-07-30

## Context

The expedition world must generate deterministically during a playable Godot session, stream terrain around the player, and export as a normal Godot project. The repository also contains editor, validation, and MCP tooling, but those tools are not available to a released game process.

## Decision

Authoritative runtime world generation is implemented in Godot resources and GDScript. A runtime build may use Godot engine APIs and project assets, but must not require Python, Node, a native extension, an external process, network service, editor-only API, or the level MCP server to generate, stream, save, or validate live world data.

Generation inputs and outputs must use Godot-owned serializable values: scalar values, strings, arrays, dictionaries, packed arrays, Godot math types, and resources represented by stable project paths. Code that produces a runtime descriptor must be callable in a headless Godot process.

External tools may create fixtures, inspect content, or run CI. Their output is advisory unless it is committed as a versioned project resource and consumed through the normal Godot runtime path.

## Consequences

- Exported builds retain one executable runtime path and do not need a separately installed generation service.
- Determinism can be verified by invoking the same generation code in headless Godot.
- Python-based level tooling cannot become an implicit runtime dependency; it must either export a static resource or be ported to GDScript before it drives expeditions.
- Complex algorithms may need profiling and bounded representations because GDScript is the runtime language.

## Dependencies

- A supported Godot editor/export-template version and the project input/render configuration.
- Versioned GDScript generation modules, seed/version policy, and headless regression fixtures.
- Export presets must include required runtime scripts/resources and exclude development-only tools without excluding generated runtime assets.

## Performance impact

This decision avoids process startup, IPC, and network latency during play. It moves CPU and allocation pressure into Godot’s frame and worker budgets; generation code therefore needs coordinate-local inputs, bounded caches, cancellation, and profiling before its active radius or detail is increased.

## Out of scope

- Rewriting editor, CI, or content-authoring utilities in GDScript.
- Choosing a specific threading, cache, mesh, or serialization implementation.
- Networked authoritative simulation or multiplayer replication.
- Claims that every offline authoring tool must be removed from the repository.
