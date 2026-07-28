# ADR 0028: Optional headless validation execution

## Status

Accepted

## Context

Godot compatibility metadata can establish declared compatibility but cannot
prove that a project opens successfully. A project check must not weaken the
rule that normal package operations never execute package-defined scripts, and
diagnostics may contain project paths unsuitable for shared CI reports.

## Decision

Provide a separate `wukong validate` command. It discovers a user-selected
Godot executable and invokes only:

```text
--headless --path <project> --editor --quit --recovery-mode
```

It does not run as a consequence of dependency installation, locking, or
synchronisation. The process has a default 60-second timeout and a command-line
maximum of 600 seconds. The direct process is stopped on timeout. Result data
records success, exit status or timeout, elapsed time, and bounded captured
output. Canonical project-path occurrences are redacted before output leaves
the core library.

## Consequences

The command checks editor startup without running the project game and does not
accept package-defined commands. Godot recovery mode reduces editor-startup
execution, but Wukong does not claim that executing a user-selected engine is
free of all untrusted-code risk. On platforms where a terminated process leaves
unassociated children, manual cleanup can still be necessary.

## Alternatives considered

- Run validation during `sync`: rejected because installation must not require
  Godot or execute an external engine.
- Run a package-provided validation command: rejected because package scripts
  are never executed.
- Omit diagnostic capture: rejected because Godot startup errors need useful,
  shareable failure context.

## Migration and compatibility impact

No manifest, lockfile, cache, or installed-state format changes. The command
is opt-in and does not affect existing installation behaviour.
