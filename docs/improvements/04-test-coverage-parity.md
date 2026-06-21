# Test Coverage Parity Improvements

## Comparison Basis

Legacy reference repo:

- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests`

Current Electron rebuild:

- `src/**/*.test.ts`
- `src/**/*.test.tsx`
- `tests/smoke/app.spec.ts`
- `scripts/perf/*.test.ts`

Hot Cross Buns 2 already has useful coverage for IPC contracts, preload boundaries, renderer shell behavior, Google read clients, SQLite repositories, shared domain services, MCP server behavior, diagnostics redaction, native service lifecycle scaffolding, and smoke/performance harnesses. The missing tests are mostly deeper product behavior, long-lived background workflows, derived data correctness, native parity, and release operations.

## Improvements To Add

### 1. Search And Filter Logic Tests

Legacy tests include `AdvancedSearchTests`, `QueryDSLTests`, `CustomFilterTests`, `FuzzySearcherTests`, `SettingsSearchIndexTests` behavior through discoverability coverage, and parser edge cases.

Add TypeScript tests for:

- structured search query parsing
- fuzzy ranking and tie-breakers
- saved custom filter matching
- invalid query diagnostics
- settings search index results
- local-only search guarantee with mocked Google transports

Recommended locations:

- `src/shared/search/*.test.ts`
- `src/main/data/localRepositories.test.ts`
- `src/renderer/src/App.test.tsx`

### 2. Calendar Behavior Tests

Legacy tests include calendar grid layout, drag/drop computation, event instance handling, recurrence rules, recurrence-until rewriting, guests, filters, and large-account performance.

Add tests for:

- day/week/month range math
- all-day and timed event overlap placement
- recurring instance display from cached Google rows
- calendar filter inclusion/exclusion
- drag/drop target computation
- guest email normalization
- reminder normalization
- large calendar range query performance fixture

Recommended locations:

- `src/shared/domain/calendar.test.ts`
- `src/main/data/localRepositories.test.ts`
- `src/renderer/src/features/core/*.test.tsx`
- `scripts/perf/*.test.ts`

### 3. Task Workflow Tests

Legacy tests include task drafts, hierarchy, kanban grouping, bulk optimizer, optimistic writer, offline queue payloads, past cleanup, templates, tag extraction, and natural-language parsing.

Add tests for:

- subtask tree construction and cycle prevention
- bulk complete/reopen/delete mutation enqueueing
- task move between lists
- snooze date computation
- template expansion
- tag extraction from title/details
- natural-language quick-add parsing
- optimistic failure rollback and retry affordances

Recommended locations:

- `src/shared/domain/tasks/*.test.ts`
- `src/main/services/sqliteDomainServices.test.ts`
- `src/renderer/src/App.test.tsx`

### 4. Persistence And Database Tests

Legacy tests include cache schema versioning, cache crypto, local cache split behavior, database store rollback, prepared snapshots, large account performance, and tombstone purge.

Add tests for:

- migration ordering and idempotency
- rollback after injected transaction failure
- FTS/render index repair
- content hash unchanged-row skipping
- derived calendar day index rebuild
- WAL/pragmas on reopened database
- pending mutation diagnostics buckets
- tombstone purge after successful sync

Recommended locations:

- `src/main/data/*.test.ts`
- `src/main/sync/*.test.ts`
- `scripts/perf/*.test.ts`

### 5. Backend Worker Tests

Legacy tests cover backoff policy, cloud sync controls, sync scheduler tombstone purge, optimistic writes, local notifications, updater release gates, and MCP controller behavior.

Add tests for:

- mutation worker status transitions
- retry/backoff with jitter bounds
- auth failure queue pause
- sync scheduler mode behavior
- lifecycle-triggered refresh debounce
- notification scheduling limits and cancellation
- updater release parsing and error messages
- MCP start/stop with persisted bearer token state

Recommended locations:

- `src/main/sync/*.test.ts`
- `src/main/native/*.test.ts`
- `src/main/mcp/*.test.ts`

### 6. Native, Accessibility, And Product UX Tests

Legacy tests include accessibility foundations, discoverability, app settings mac surfaces, app intent routing, deep links, Spotlight identifiers/indexing, window restoration, help localization, exporters, ICS importer, diagnostic bundle, and settings transfer.

Add tests for:

- accessible names and keyboard navigation in primary screens
- command palette discoverability for every major action
- deep-link parsing and route dispatch
- window restoration store
- export/import preview behavior
- diagnostics bundle redaction
- settings transfer import/export
- localized help content loading
- tray/hotkey/manual macOS checklist coverage in release docs

Recommended locations:

- `src/renderer/src/App.test.tsx`
- `src/main/native/*.test.ts`
- `src/main/ipc/*.test.ts`
- `tests/smoke/*.spec.ts`
- `docs/testing/manual-macos-native-shell.md`

## Test Execution Policy

For each feature implementation:

- Run `pnpm test:unit` for unit and integration coverage.
- Run `pnpm test:smoke` when renderer flows, preload APIs, or native lifecycle behavior change.
- Run `pnpm test:perf` when startup, IPC payloads, SQLite queries, search, sync, or list rendering changes.
- Update manual macOS QA docs when tray, hotkeys, notifications, protocol links, packaging, or updater behavior changes.

## Recommended Starting Point

Start by adding tests for the durable mutation worker and SQLite adapter changes. Those tests protect the backend and database improvements that should come before broad user-facing parity work.
