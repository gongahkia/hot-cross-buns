# Hot Cross Buns 2 Documentation

Hot Cross Buns 2 is the Electron-first rebuild of Hot Cross Buns. The repository started with specs first, and now includes the initial Electron, React, TypeScript, IPC, renderer shell, performance harness, and local SQLite connection foundations.

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
- Phase 2 renderer screens still use local mock data, but the mock rows are isolated behind a `coreViewModelSource` adapter so Phase 3 can replace the source with preload-backed calls without rewriting screen components.
- Phase 2 IPC contracts are versioned under `src/shared/ipc/`, with core planner, sync, settings, MCP, and native handlers now returning bounded placeholder DTOs instead of broad not-implemented stubs.
- Main-side placeholder domain services are shared by IPC handlers and MCP tool handlers; the implementation is intentionally in-memory until SQLite repositories and Google-backed mutation services are wired.
- Local data currently provides connection factories and temporary-database test coverage. Full migrations and repositories remain planned before real sync/data wiring.
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
