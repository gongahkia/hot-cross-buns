# Hot Cross Buns 2 Documentation

Hot Cross Buns 2 is the Electron-first rebuild of Hot Cross Buns. This repository starts with specs before application code so future implementation agents can work from shared product, architecture, security, and test decisions.

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

Operational docs:

- [Privacy And Threat Model](security/privacy-and-threat-model.md)
- [QA Plan](testing/qa-plan.md)
- [Distribution](release/distribution.md)
- [Agent Workflow](agents/workflow.md)

## Non-Goals For This Documentation Pass

- No Electron scaffold yet.
- No package manager lockfile yet.
- No source code copied from the Swift app.
- No product decisions that contradict Google Tasks and Calendar as the primary synced sources.
