# Hot Cross Buns 2 Documentation

Hot Cross Buns 2 is the Electron-first rebuild of Hot Cross Buns. The repository started with specs first, and now includes the initial Electron, React, TypeScript, IPC, renderer shell, performance harness, local SQLite connection foundations, and cache-backed core product workflows.

## Starting Point For Agents

Read these first, in order:

1. [Product PRD](product/prd.md)
2. [Tech Stack ADR](architecture/tech-stack.md)
3. [System Architecture](architecture/system-architecture.md)
4. [Agent Workflow](agents/workflow.md)

Then read the spec for the subsystem you are changing. Do not scaffold app code until the relevant spec and acceptance checks are clear.

## Current Direction

- Product name: Hot Cross Buns 2
- Initial platform: macOS
- Future platforms: Windows and Linux
- Default stack: Electron, React, TypeScript, Vite, Tailwind, SQLite
- Source of truth: Google Tasks and Google Calendar
- Local database role: cache, settings, checkpoints, offline mutations, local notes
- Agent access: opt-in local MCP server on `127.0.0.1`

## Implementation Status

- Electron/Vite/React scaffold exists with hardened renderer settings and a typed preload bridge.
- Renderer screens read bounded task, calendar, note, settings, sync, diagnostics, and search view models through the typed preload bridge. Local mock data remains only as fixture fallback for isolated renderer tests and command metadata.
- Core IPC contracts are versioned under `src/shared/ipc/`, with read and write routes for tasks, task lists, calendar events, notes, local search, sync, settings, MCP, native capabilities, and diagnostics.
- Main-side SQLite domain services are shared by UI IPC handlers and MCP tool handlers. Task and calendar writes update optimistic local mirror rows and enqueue Google-backed pending mutations; notes stay local-only.
- Local data now includes migrations, repositories, temporary-database integration tests, search over current task/event/note state, pending mutation tracking, and sanitized performance timing storage.
- Performance smoke runs in report-only mode with generated local fixtures and temporary app data paths.

## Documentation Map

Architecture:

- [Tech Stack ADR](architecture/tech-stack.md)
- [System Architecture](architecture/system-architecture.md)

Product:

- [Product PRD](product/prd.md)
- [Roadmap](product/roadmap.md)

Subsystem specs:

- [Core App](specs/core-app.md)
- [Google Sync](specs/google-sync.md)
- [Local Data](specs/local-data.md)
- [MCP Agent Access](specs/mcp-agent-access.md)
- [Platform Strategy](specs/platforms.md)
- [Native Parity](specs/native-parity.md)
- [Design System](design/design-system.md)
- [Legacy Hot Cross Buns Context](reference/legacy-hot-cross-buns-context.md)

Performance:

- [Performance Strategy](performance/performance-strategy.md)
- [Renderer Performance](performance/renderer-performance.md)
- [Main, IPC, And Data Performance](performance/main-and-data-performance.md)
- [Build And Test Performance](performance/build-and-test-performance.md)

Ports:

- [Cross-Platform Porting](ports/cross-platform-porting.md)
- [Platform Adapter Audit](ports/platform-adapter-audit.md)
- [Linux Port](ports/linux-port.md)
- [Windows Port](ports/windows-port.md)

Operational docs:

- [Privacy And Threat Model](security/privacy-and-threat-model.md)
- [QA Plan](testing/qa-plan.md)
- [Distribution](release/distribution.md)
- [Agent Workflow](agents/workflow.md)

## Historical Non-Goals For The Initial Documentation Pass

- No Electron scaffold yet.
- No package manager lockfile yet.
- No source code copied from the Swift app.
- No product decisions that contradict Google Tasks and Calendar as the primary synced sources.
