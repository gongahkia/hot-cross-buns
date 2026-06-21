# Legacy Hot Cross Buns Context

The original Hot Cross Buns repository is local reference material:

```text
/Users/gongahkia/Desktop/coding/projects/hot-cross-buns
```

Hot Cross Buns 2 must not depend on the Swift app at runtime. Use the old repo to understand behavior, UX, schema intent, and edge cases.

## Product Shape To Preserve

The original app is a macOS planner built around:

- Google Tasks task lists and tasks
- Google Calendar calendars and events
- notes
- keyboard-first navigation and command palette
- menu bar/tray surfaces
- global quick capture
- Spotlight and App Shortcuts integration
- local SQLite cache
- offline mutation placeholders
- local notifications
- local MCP server for agent access
- diagnostics and recovery controls

Hot Cross Buns 2 keeps the same product center but implements it with Electron, React, TypeScript, and SQLite.

## Useful Old-Repo References

Architecture and docs:

- `README.md`
- `apps/apple/README.md`
- `reference/architecture/ARCHITECTURE.md`
- `docs/mcp.md`
- `schema/canonical.sql`
- `reference/style/DESIGN_SYSTEM.md`
- `reference/style/STYLE_GUIDE.md`

Feature areas:

- `apps/apple/HotCrossBuns/App`
- `apps/apple/HotCrossBuns/Features/Tasks`
- `apps/apple/HotCrossBuns/Features/Calendar`
- `apps/apple/HotCrossBuns/Features/QuickAdd`
- `apps/apple/HotCrossBuns/Features/Settings`
- `apps/apple/HotCrossBuns/Services/Google`
- `apps/apple/HotCrossBuns/Services/Sync`
- `apps/apple/HotCrossBuns/Services/Persistence`
- `apps/apple/HotCrossBuns/Services/MCP`

Tests worth studying for behavior:

- `apps/apple/HotCrossBunsMacTests/LocalCacheDatabaseStoreTests.swift`
- `apps/apple/HotCrossBunsMacTests/GoogleTasksClientTransportTests.swift`
- `apps/apple/HotCrossBunsMacTests/GoogleCalendarClientTransportTests.swift`
- `apps/apple/HotCrossBunsMacTests/MCPServerControllerTests.swift`
- `apps/apple/HotCrossBunsMacTests/AdvancedSearchTests.swift`
- `apps/apple/HotCrossBunsMacTests/FuzzySearcherTests.swift`
- `apps/apple/HotCrossBunsMacTests/NaturalLanguageTaskParserTests.swift`
- `apps/apple/HotCrossBunsMacTests/CalendarGridLayoutTests.swift`
- `apps/apple/HotCrossBunsMacTests/OptimisticWriterTests.swift`

## Behavior Contracts Already Decided

- Google Tasks and Google Calendar are the synced sources of truth.
- Local SQLite is cache, settings, checkpoints, offline mutation queue, diagnostics metadata, and task-backed note mirrors.
- Google Drive is out of scope.
- Renderer code in Hot Cross Buns 2 never gets direct filesystem, token, SQLite, or Google API access.
- UI writes and MCP writes must use the same domain services.
- MCP uses read-only, confirm-writes, and allow-writes modes.
- Destructive MCP writes always require confirmation.
- Search is local-first and must not call Google on every keystroke.
- Diagnostics must redact tokens, raw credentials, raw Google payloads, and MCP bearer tokens.

## Copying Policy

Allowed:

- Port behavior and tests conceptually.
- Reuse names for product concepts where helpful.
- Copy static visual assets when a task needs them.
- Translate Swift test scenarios into TypeScript tests.

Not allowed without explicit approval:

- Copy Swift source as application code.
- Reintroduce Xcode/XcodeGen as the active build path.
- Make Hot Cross Buns 2 import or shell out to the old Swift app.
- Expand scope to mobile apps before the desktop roadmap is stable.
