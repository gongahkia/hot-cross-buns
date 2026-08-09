# Hot Cross Buns Documentation

Hot Cross Buns is a keyboard-first native C++20/Qt desktop planner. Older Electron references are historical only.

## Starting Point For Agents

Read these first, in order:

1. [Product PRD](product/prd.md)
2. [Tech Stack ADR](architecture/tech-stack.md)
3. [System Architecture](architecture/system-architecture.md)
4. [Agent Workflow](agents/workflow.md)

Then read the spec for the subsystem you are changing. Do not scaffold app code until the relevant spec and acceptance checks are clear.

## Current Direction

- Product name: Hot Cross Buns
- Release platforms: macOS and Fedora 43 KDE/Wayland; Windows is deferred.
- Default stack: C++20, Qt 6, CMake, SQLite
- Source of truth: Google Tasks and Google Calendar
- Local database role: Google Tasks/Calendar cache, settings, checkpoints, offline mutations, diagnostics
- Agent access: deferred; no local MCP server currently ships

## Implementation Status

- Qt Quick views bind to C++ task, notes, calendar, and navigation models.
- SQLite domain services own local reads and mutations; the app controller applies completed results only on the Qt GUI thread.
- The macOS app and Fedora RPM support a user-supplied Google Desktop OAuth client ID, PKCE loopback authorization, OS-backed credentials, and Google Tasks/Calendar sync.
- Fedora RPM validation includes KDE Wallet Secret Service credential checks and the user reminder daemon; Windows remains deferred.

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
- [Local Hoster Protocol](specs/local-hoster.md)
- [Platform Strategy](specs/platforms.md)
- [Native Parity](specs/native-parity.md)
- [Design System](design/design-system.md)
- [Historical Swift App Context](reference/legacy-hot-cross-buns-context.md)

Performance:

- [Performance Strategy](performance/performance-strategy.md)
- [Qt Quick UI Performance](performance/renderer-performance.md)
- [Main And Data Performance](performance/main-and-data-performance.md)
- [Build And Test Performance](performance/build-and-test-performance.md)

Ports:

- [Cross-Platform Porting](ports/cross-platform-porting.md)
- [Platform Adapter Audit](ports/platform-adapter-audit.md)
- [Linux Port](ports/linux-port.md)
- [Windows Port](ports/windows-port.md)

Operational docs:

- [Contributing](CONTRIBUTING.md)
- [Importing Tasks and events](importing-tasks-and-events.md)
- [Privacy And Threat Model](security/privacy-and-threat-model.md)
- [Local Hoster Threat Model](security/local-hoster-threat-model.md)
- [QA Plan](testing/qa-plan.md)
- [Distribution](release/distribution.md)
- [Mac Preview Support](support/mac-preview-support.md)
- [Linux Preview Support](support/linux-preview-support.md)
- [Windows Preview Support](support/windows-preview-support.md)
- [Manual Linux Native Shell Checklist](testing/manual-linux-native-shell.md)
- [Manual Windows Native Shell Checklist](testing/manual-windows-native-shell.md)
- [Agent Workflow](agents/workflow.md)

## Historical Documentation Notes

- Electron/React/IPC references in release notes and improvement logs describe retired work and are not implementation guidance.
- The current implementation is C++20, Qt 6, CMake, and SQLite.
