# Roadmap

## Phase 0: Documentation Foundation

Goal: make the rebuild agent-ready before source code exists.

Deliverables:

- Product, architecture, security, testing, release, and subsystem specs.
- Explicit interface decisions for renderer, preload, main, workers, SQLite, Google sync, and MCP.
- Clear boundaries with the old Swift repository.

Exit criteria:

- All docs in this spec set exist.
- Future agents can identify where to add a feature and what checks are required.
- No app code has been created during this phase.

## Phase 1: Mac Core Scaffold

Goal: create a minimal Electron app that proves the stack and boundaries.

Deliverables:

- Electron + React + TypeScript + Vite scaffold.
- Hardened BrowserWindow defaults.
- Preload bridge with one health-check API.
- Basic app shell matching design-token direction.
- Vitest and Playwright Electron smoke test.
- Local structured logging.

Exit criteria:

- App launches on macOS.
- Renderer has no direct Node access.
- First IPC contract test passes.

## Phase 2: Local Data Foundation

Goal: establish durable local state before Google writes.

Deliverables:

- SQLite migration runner.
- Canonical local schema based on the previous Hot Cross Buns SQLite schema.
- Repository layer for tasks, lists, calendar mirrors, notes, settings, checkpoints, and pending mutations.
- Temporary-database migration tests.
- Diagnostics view data source.

Exit criteria:

- Fresh database migrates successfully.
- Repeated migration is idempotent.
- Repository tests pass against temporary SQLite databases.

## Phase 3: Google Read Sync

Goal: safely mirror Google Tasks and Calendar into the local cache.

Deliverables:

- Desktop OAuth flow.
- Keychain-backed token storage.
- Google Tasks list/task read sync.
- Google Calendar calendar/event read sync.
- Checkpoint storage.
- Backoff and retry behavior.
- Mocked Google transport tests.

Exit criteria:

- User can connect Google and see cached tasks/events after sync.
- App can restart and render from cache without immediate Google access.

## Phase 4: Core UI And Writes

Goal: rebuild the daily planner workflow.

Deliverables:

- Tasks, Calendar, Notes, Search, Settings views.
- Command palette.
- Quick capture.
- Task and event write flows.
- Offline mutation queue.
- Conflict and error banners.
- Focused keyboard navigation.

Exit criteria:

- Core create/edit/delete flows work online.
- Offline writes queue locally and retry.
- Playwright smoke tests cover primary navigation and quick capture.

## Phase 5: MCP And Native Mac Shell

Goal: expose controlled local agent access and Mac desktop affordances.

Deliverables:

- Local MCP server on `127.0.0.1`.
- Bearer-token auth stored in Keychain.
- Read-only, confirm writes, allow writes modes.
- Dry-run/confirmation model.
- Tray/menu bar entry.
- Global quick capture hotkey.
- Notifications and deep links.

Exit criteria:

- MCP contract tests pass.
- Destructive MCP writes require confirmation.
- Tray and hotkey flows are manually verified on macOS.

## Phase 6: Preview Distribution

Goal: make Mac builds installable for preview use.

Deliverables:

- DMG or zip packaging.
- GitHub Releases upload flow.
- Checksum generation.
- Basic updater/check-for-new-version UX.
- Signing/notarization path documented, even if not enabled.

Exit criteria:

- A user can install a preview build on macOS with documented warnings.

## Phase 7: Linux Technical Preview

Goal: prove the Mac-first app works outside macOS through a Linux technical preview.

Deliverables:

- Shared platform adapter audit.
- Linux adapters for paths, credentials, tray, hotkeys, notifications, protocol links, updater metadata, diagnostics, and capability reporting.
- Linux packaging plan and AppImage target.
- Linux manual QA checklist for GNOME, KDE, Wayland, X11, OAuth, MCP, notifications, tray, shortcuts, protocol links, and performance.

Exit criteria:

- Core planner flows pass on macOS and Linux technical preview.
- Unsupported Linux desktop features are visible in Settings/Diagnostics rather than silently failing.

## Phase 8: Windows Technical Preview

Goal: add Windows after Linux adapter lessons are incorporated.

Deliverables:

- Windows adapters for paths, credential storage, tray, global shortcuts, notifications, protocol links, autostart, updater metadata, diagnostics, and capability reporting.
- NSIS installer target unless another target is explicitly chosen.
- AppUserModelID and installer identity.
- Code signing and SmartScreen plan.
- Windows manual QA checklist for installer, Start Menu, taskbar grouping, tray, shortcuts, notifications, OAuth, MCP, protocol links, uninstall, and performance.

Exit criteria:

- Core planner flows pass on macOS, Linux technical preview, and Windows technical preview.
- Public Windows distribution blockers are documented separately from internal preview blockers.
