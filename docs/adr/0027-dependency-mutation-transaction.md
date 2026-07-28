# ADR 0027: Dependency mutation transaction

## Status

Accepted

## Context

`wukong add` and later dependency-mutation commands alter three user-visible
states: `wukong.toml`, `wukong.lock`, and the installed project files. Existing
manifest edits and project sync each have a transaction, but independently
committing them can leave a new manifest or lockfile after resolution or
materialisation fails. Package preparation and source fetching must complete
before project mutation, and package scripts must never execute.

## Decision

For a dependency mutation:

1. Read and retain exact prior manifest and lockfile bytes, including absence.
2. Publish the validated manifest edit through the existing manifest
   transaction.
3. Resolve and prepare the complete candidate lockfile without writing it.
4. Publish the deterministic lockfile through an atomic sibling replacement.
5. Run transactional project synchronisation from that lockfile value.
6. If steps 2–5 fail, restore the original manifest and lockfile bytes through
   atomic sibling replacement; project sync owns recovery of its own journal.

This retains the prior manifest and lockfile on resolution, source, ownership,
or sync errors. A failure restoring either file is reported explicitly. The
project state never depends on package-script execution.

## Consequences

Mutation code must stage the deterministic lockfile before it is needed for
sync, then remove it again on failure. Lockfile writing uses the same
deterministic serialization as `wukong lock`. This is a multi-file best-effort
transaction rather than a filesystem-wide atomic commit; a process crash
between successful steps still requires recovery work from W092/W091.

## Alternatives considered

- Write the lockfile before sync: rejected because a failed sync would expose a
  lockfile that does not describe the installed project.
- Mutate the project before resolving: rejected because source and constraint
  failures could leave partial installation state.
- Execute package-provided hooks to repair failures: rejected because Wukong
  never executes arbitrary package scripts.

## Migration and compatibility impact

No manifest or lockfile schema change is introduced. This record extends the
manifest-edit transaction choreography and will be superseded if a durable
cross-file transaction protocol is introduced.
