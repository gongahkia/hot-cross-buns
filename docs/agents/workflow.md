# Agent Workflow

## Purpose

This document tells future agents how to work in Hot Cross Buns 2 without drifting from the architecture and product decisions.

## Before Starting Work

Read:

1. `docs/README.md`
2. `docs/product/prd.md`
3. `docs/architecture/tech-stack.md`
4. `docs/architecture/system-architecture.md`
5. the subsystem spec for the requested work

If the requested work conflicts with these docs, update or propose a doc change before implementing code.

## Repository Boundaries

This repo is the Electron-first rebuild. The old Swift repo is reference material only.

Allowed from the old repo:

- product behavior references
- schema concepts
- design tokens and visual direction
- MCP permission model
- Google sync behavior concepts
- release/install lessons

Not allowed without explicit approval:

- copying Swift source code directly
- reviving Swift build infrastructure
- making the Swift repo a runtime dependency
- implementing new features in the old Swift repo when the request targets Hot Cross Buns 2

## Implementation Rules

- Keep renderer unprivileged.
- Add preload APIs only with TypeScript types, runtime schemas, and tests.
- Put filesystem, SQLite, Google, MCP, tray, shortcuts, notifications, and updater work in main/worker services.
- Use domain services for both UI and MCP mutations.
- Keep Google as the source of truth for synced tasks/events.
- Keep notes local-only unless a later spec changes that.
- Update docs when behavior or architecture changes.

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

