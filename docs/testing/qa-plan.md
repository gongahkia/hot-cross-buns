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
- Local performance smoke tests with deterministic generated data.
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

CI smoke artifact policy:

- The tracked GitHub Actions smoke job runs on `macos-14`.
- The manual `Linux AppImage Preview Validation` workflow runs on
  `ubuntu-latest` and uploads Linux AppImage, checksum, bundle-review,
  performance, and Playwright artifacts. Its AppImage launch smoke uses an
  explicit CI-only `--no-sandbox` gate for hosted-runner sandbox limitations,
  and its packaged MCP smoke uses a hosted DBus GNOME/libsecret keyring session.
- The manual `Windows Preview Validation` workflow runs on `windows-2022` and
  uploads Windows installer, checksum, bundle-review, performance, and
  Playwright artifacts.
- On failure or cancellation it uploads Playwright traces, screenshots, and any release diagnostics under `output/playwright/`, `test-results/`, `playwright-report/`, and `artifacts/release/`.
- Successful Linux/Windows preview runs also upload manual QA evidence templates under `artifacts/manual-qa/`.
- Smoke artifacts may contain screenshots of local fixture data. Do not upload real user app data paths or private databases.

## Performance Smoke Tests

Performance smoke tests must use generated local data and temporary app/database paths. They must not call Google or read a user's real application data. Linux and Windows preview workflows set `HCB_PERF_REQUIRE_ELECTRON=1` so skipped Electron launch timings fail platform validation instead of producing only report artifacts.

Required measured flows before Mac v1:

- cold launch shell-visible timing
- warm launch shell-visible timing
- cached Today/Tasks/Calendar render timing
- command palette open latency
- quick capture open latency
- local search latency against a medium fixture
- Tasks list scrolling against a large fixture
- Calendar month navigation against a large fixture
- representative SQLite query plans for core task, event, note, search, sync, and mutation queries

Performance tests should initially report timings without failing the build. Convert stable budgets into hard gates only after baseline data exists on target machines.

## Manual Verification

Manual checks are required for platform-specific OS behavior:

- macOS tray/menu bar behavior
- Linux AppImage launch behavior
- Linux Secret Service availability, locked, and missing states
- Windows NSIS install, launch, and uninstall behavior
- Windows AppUserModelID, Start Menu identity, and taskbar grouping
- global shortcut registration conflict
- notifications permission prompt
- custom protocol links
- unsigned preview install warning
- signed/notarized install once enabled

Use [Manual macOS Native Shell Checklist](manual-macos-native-shell.md) for tray/menu bar, global quick capture hotkey, local notification, and `hotcrossbuns://` deep-link verification.

Use [Mac Preview Support](../support/mac-preview-support.md) for unsigned preview install, checksum verification, support diagnostics, and rollback guidance.

Use [Manual Linux Native Shell Checklist](manual-linux-native-shell.md) for AppImage launch, OAuth, Secret Service, MCP, notification, shortcut, and unsupported-feature verification across the Linux technical preview matrix.

Use [Linux Preview Support](../support/linux-preview-support.md) for AppImage install, known limitations, diagnostics, rollback, and clean-removal guidance.

Use [Manual Windows Native Shell Checklist](manual-windows-native-shell.md) for NSIS install, Start Menu/taskbar identity, tray, global shortcut, notification, OAuth, MCP, protocol, autostart, uninstall, and performance validation.

Record manual verification notes in release PRs.

## Acceptance Gate

No feature is complete until:

- relevant unit/integration tests pass
- IPC or MCP contract tests are updated if interfaces changed
- Playwright smoke suite still launches
- performance smoke coverage is updated when a change touches startup, IPC payload shape, database queries, list rendering, search, sync, or native lifecycle behavior
- docs are updated if product or architecture behavior changed
