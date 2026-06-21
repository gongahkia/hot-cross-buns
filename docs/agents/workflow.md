# Agent Workflow

## Purpose

This document tells future agents how to work in Hot Cross Buns without drifting from the architecture and product decisions.

## Before Starting Work

Read:

1. `docs/README.md`
2. `docs/product/prd.md`
3. `docs/architecture/tech-stack.md`
4. `docs/architecture/system-architecture.md`
5. the subsystem spec for the requested work
6. the relevant `docs/performance/` guide when touching startup, renderer surfaces, IPC, SQLite, sync, search, packaging, or tests
7. the relevant `docs/ports/` guide when touching platform adapters, packaging, tray, shortcuts, notifications, paths, credentials, deep links, or updater behavior
8. `docs/improvements/05-general-parity-and-release-polish.md` when touching CI, contributor setup, preview install, release commands, or support guidance

If the requested work conflicts with these docs, update or propose a doc change before implementing code.

## Repository Boundaries

This repo is the Electron app. The historical Swift implementation is reference material only.

Allowed from historical Swift material:

- product behavior references
- schema concepts
- design tokens and visual direction
- MCP permission model
- Google sync behavior concepts
- release/install lessons

Not allowed without explicit approval:

- copying Swift source code directly
- reviving Swift build infrastructure
- making the Swift implementation a runtime dependency
- implementing new features in the historical Swift implementation when the request targets Hot Cross Buns

## Implementation Rules

- Keep renderer unprivileged.
- Add preload APIs only with TypeScript types, runtime schemas, and tests.
- Put filesystem, SQLite, Google, MCP, tray, shortcuts, notifications, and updater work in main/worker services.
- Use domain services for both UI and MCP mutations.
- Keep Google as the source of truth for synced tasks/events.
- Keep notes task-backed unless a later spec changes that.
- Update docs when behavior or architecture changes.
- Preserve the performance budgets and measurement strategy in `docs/performance/performance-strategy.md`.
- Preserve the port order in `docs/ports/cross-platform-porting.md`: macOS first, Linux second, Windows third.
- Runtime Google sync includes authenticated task/task-list/calendar-event writes by default; keep UI, MCP, and sync worker writes on the shared mutation queue.

## Work Selection

For a new feature:

1. Identify the owning spec.
2. Confirm the feature belongs in current phase.
3. Define the user-visible behavior.
4. Define IPC/service contracts.
5. Add tests at the lowest useful layer.
6. Add Playwright coverage only for critical user flows.
7. Update docs if a contract changed.

## Acceptance Checks

Every change should answer:

- Does renderer remain unprivileged?
- Are new IPC methods validated?
- Are errors sanitized?
- Are SQLite writes transactional where needed?
- Are Google tokens kept out of renderer/logs/SQLite?
- Are MCP writes routed through the same services as UI writes?
- Did relevant tests run?
- Did performance smoke coverage or instrumentation need updates?
- Did docs change when behavior changed?

## Branch And PR Notes

PR descriptions should include:

- subsystem changed
- user-visible behavior
- tests run
- docs updated
- known limitations
- manual platform checks if native behavior changed

Do not claim Windows/Linux support from a Mac-only change unless the platform spec and tests prove it.
