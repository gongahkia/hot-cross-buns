# Style Guide

Code conventions for Hot Cross Buns.

See also: [CONTRIBUTING.md](./CONTRIBUTING.md) for PR process, [ARCHITECTURE.md](./ARCHITECTURE.md) for project structure.

---

## Formatting & Tooling

| Language | Formatter | Config Location | Command |
|---|---|---|---|
| Swift | Xcode / swift-format once configured | `apps/apple/` | `swift-format` or Xcode Format |

### Pre-commit Hooks

- Swift checks should cover formatting, build, and unit tests.

---

## Naming Conventions

| Context | Convention | Example |
|---|---|---|
| Swift types | PascalCase | `TaskSyncService`, `CalendarEventMirror` |
| Swift values / functions | lowerCamelCase | `selectedCalendarID`, `syncNow()` |
| Swift enum cases | lowerCamelCase | `nearRealtime` |
| Swift files | PascalCase by primary type | `TaskSyncService.swift` |
| SQL tables (historical schema) | snake_case, plural | `tasks`, `task_tags`, `sync_log` |
| SQL columns (historical schema) | snake_case | `created_at`, `parent_task_id` |
| Google resource IDs | preserve upstream casing | `taskListID`, `calendarID` |

---

## File Organization

- One SwiftUI screen or component per file when practical.
- Keep Google API adapters, sync scheduling, persistence, and UI in separate modules.
- Group imports: **stdlib → external → internal**, separated by blank lines.

---

## Error Handling

### Swift

- Define domain-specific error types for auth, Google API, cache, and sync failures.
- Preserve underlying errors for diagnostics, but show human-readable messages in UI.
- Use explicit loading, empty, error, and offline states in SwiftUI.
- Never log OAuth access tokens, refresh tokens, authorization codes, or full event/task descriptions.

---

## Comments & Documentation

- Code should be self-documenting; avoid redundant comments
- Add `WHY:` comments for non-obvious decisions (matches PRD style)
- Swift: document public types and non-obvious sync behavior.
- No `TODO` comments in committed code — track in issues instead

---

## Logging

| Layer | Library | Format | Output |
|---|---|---|---|
| Swift app | `Logger` / `OSLog` | structured | Console.app / unified logging |

Rules:
- All logs include: timestamp, level, message, structured fields
- No PII in logs (no emails, no tokens, no passwords)
- Use log levels consistently: `error` (action failed), `warn` (degraded but continuing), `info` (key events), `debug` (dev only)
</content>
