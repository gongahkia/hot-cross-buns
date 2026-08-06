# ADR 0046: native CLI progress and installed Godot workflows

## Status

Accepted

## Context

Wukong needs configurable, consistent human progress feedback beyond sync and
a safe project workflow around an already installed Godot executable. The prior
CLI renderer delegated presentation to `indicatif`, which could not expose the
complete Rattles preset catalogue or Wukong-owned bar themes.

## Decision

`wukong-cli` owns terminal rendering. It uses Rattles 0.2.2 only for immutable
spinner-frame definitions and a narrow cross-platform terminal-control backend
for cursor movement and line clearing. The CLI implements refresh timing,
determinate-bar formatting, ETA calculation, and cleanup itself; core remains
terminal-independent.

Rendering is limited to interactive stderr, starts after a short delay, and is
disabled for JSON, non-terminal, `--no-progress`, and `WUKONG_NO_PROGRESS=1`
invocations. `--progress-spinner`, `WUKONG_PROGRESS_SPINNER`, and global
settings select one of every Rattles preset; `simple-dots` is the portable
default. Wukong-owned bars provide `classic`, `legacy`, `shades-classic`,
`shades-grey`, and `rect` themes.

User preferences live in a schema-one platform configuration file, never in a
project manifest or lockfile. Godot selection precedence is explicit command
path, `WUKONG_GODOT_EXECUTABLE`, persisted user selection, `PATH`, then known
platform locations. Wukong orchestrates installed engines only; it does not
download or manage Godot releases.

`run`, `editor`, and `export` launch the selected executable for an explicit
project. They forward only user arguments placed after `--`; package metadata
cannot supply executable arguments or scripts.

## Consequences and alternatives

The CLI replaces `indicatif` with Rattles plus terminal control and carries the
small rendering implementation itself. Raw ANSI control was rejected: the
backend handles Windows and standard terminal differences without moving
terminal concerns into core. Managed Godot downloads, a hosted registry, and
package scripts remain out of scope.

## Migration and compatibility impact

No manifest, lockfile, cache, installed-state, or JSON protocol format changes
are introduced. Existing `sync --no-progress` remains valid. The settings file
is local, additive, and safely recreated from defaults when absent.
