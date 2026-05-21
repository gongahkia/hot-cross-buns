# QA Plan

## Test Layers

Hot Cross Buns 2 must rely on fast automated checks before broad manual testing.

Required layers:

- TypeScript unit tests with Vitest.
- Renderer component tests with React Testing Library.
- SQLite integration tests with temporary databases.
- Google transport tests using mocked HTTP/API clients.
- IPC contract tests for every preload method.
- MCP JSON-RPC contract tests.
- Playwright Electron smoke tests.
- Platform manual verification for tray, global shortcuts, notifications, and packaging.

## Unit Tests

Use Vitest for:

- date normalization
- query parsing
- task/event mapping
- local validation
- command palette command registry
- permission decisions
- sync backoff policy
- mutation queue state transitions

Unit tests must not require Electron.

## Renderer Tests

Use React Testing Library for:

- task list rendering
- calendar event rendering
- empty/error/loading states
- form validation
- command palette filtering
- settings controls
- accessibility roles for primary controls

Renderer tests should mock preload APIs.

## SQLite Tests

Use temporary databases for:

- fresh migration
- repeated migration
- migration from previous schema version
- transaction rollback
- task repository CRUD
- event repository CRUD
- note repository CRUD
- settings/checkpoint repository behavior
- pending mutation queue behavior

These tests must not touch a user's real app data path.

## Google Sync Tests

Use mocked Google transport for:

- OAuth status without token leakage
- Tasks initial read sync
- Tasks incremental sync
- Calendar initial read sync
- Calendar incremental sync
- invalid calendar sync token
- rate limit and server error backoff
- queued write success
- queued write failure

Tests should assert local database outcomes, not only mock call counts.

## IPC Contract Tests

Every preload API must have tests for:

- valid request succeeds
- invalid request is rejected before service execution
- service error returns sanitized `HcbResult`
- response shape matches schema
- renderer cannot import or call privileged modules directly

## MCP Contract Tests

Required scenarios:

- missing bearer token
- invalid bearer token
- malformed JSON
- oversized request body
- unexpected origin
- read tool in read-only mode
- dry-run write in confirm-writes mode
- direct write blocked in confirm-writes mode
- destructive write confirmation requirement
- audit log redaction

## Playwright Electron Smoke Tests

Required initial smoke tests:

- app launches
- main window renders app shell
- command palette opens
- navigate to Tasks
- navigate to Calendar
- navigate to Notes
- open Settings
- quick capture opens through UI path

Later smoke tests:

- hotkey opens quick capture on macOS
- tray show/hide works on macOS
- OAuth setup screen renders
- offline cache renders after restart

## Manual Verification

Manual checks are required for platform-specific OS behavior:

- macOS tray/menu bar behavior
- global shortcut registration conflict
- notifications permission prompt
- custom protocol links
- unsigned preview install warning
- signed/notarized install once enabled

Record manual verification notes in release PRs.

## Acceptance Gate

No feature is complete until:

- relevant unit/integration tests pass
- IPC or MCP contract tests are updated if interfaces changed
- Playwright smoke suite still launches
- docs are updated if product or architecture behavior changed

