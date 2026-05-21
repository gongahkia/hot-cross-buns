# Prompts To Run - 22 May

These prompts are optimized for future Codex 5.5 extra-high runs against Hot Cross Buns 2.

Run prompts from:

```text
/Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2
```

Use a fresh branch per prompt or per phase. For prompts marked parallel-safe, keep each agent on its stated write set and merge only after tests pass. After every parallel phase, run the listed integration prompt by itself.

## Required Reading For Every Prompt

Every prompt below tells the agent what to read, but these are the permanent anchors:

- `docs/README.md`
- `docs/agents/workflow.md`
- `docs/architecture/tech-stack.md`
- `docs/architecture/system-architecture.md`
- `docs/product/prd.md`
- `docs/product/roadmap.md`
- `docs/security/privacy-and-threat-model.md`
- `docs/testing/qa-plan.md`
- `docs/design/design-system.md`
- `docs/performance/performance-strategy.md`
- `docs/reference/legacy-hot-cross-buns-context.md`

The legacy Swift repository is reference-only:

```text
/Users/gongahkia/Desktop/coding/projects/hot-cross-buns
```

## Execution Map

| Phase | Run Style | Prompts |
|---|---|---|
| 0 | Run alone | P0 Scaffold |
| 0.5 | Run alone | P0.5 Performance Harness |
| 1 | Parallel-safe | P1A Renderer Shell, P1B IPC Foundation, P1C Local Data Foundation |
| 1 merge | Run alone | P1D Integration Review |
| 2 | Parallel-safe | P2A Google Sync, P2B MCP Server, P2C Core Screens With Mock Data |
| 2 merge | Run alone | P2D Integration Review |
| 3 | Run alone | P3 Real Data Wiring |
| 3 perf | Run alone | P3E Real Data Performance Baseline |
| 4 | Parallel-safe after P3E | P4A Tasks, P4B Calendar, P4C Notes Search Command Palette |
| 4 merge | Run alone | P4D Integration Review |
| 4 perf | Run alone | P4E Interaction Performance Pass |
| 5 | Parallel-safe after P4E | P5A Native Shell, P5B Settings Diagnostics, P5C Security Hardening |
| 5 merge | Run alone | P5D Integration Review |
| 6 | Run alone | P6 Release Packaging |
| 7 | Run alone | P7 Final Product QA |
| 8 | Run alone after Mac v1 | P8A Cross-Platform Adapter Audit |
| 8 Linux | Run alone after P8A | P8B Linux Port Foundation |
| 8 Linux QA | Run alone after P8B | P8C Linux Packaging And Desktop QA |
| 9 Windows | Run alone after Linux preview | P9A Windows Port Foundation |
| 9 Windows QA | Run alone after P9A | P9B Windows Packaging And Signing QA |
| 10 | Run alone after P9B | P10 Cross-Platform Release Hardening |

## Phase 0 - Scaffold

Run this prompt by itself. It creates the baseline app and shared toolchain, so parallel work before it will create conflicts.

### P0 Scaffold

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: create the initial Electron + React + TypeScript + Vite scaffold for Hot Cross Buns 2 without implementing product features yet.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/architecture/tech-stack.md
- docs/architecture/system-architecture.md
- docs/product/prd.md
- docs/security/privacy-and-threat-model.md
- docs/testing/qa-plan.md
- docs/design/design-system.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md

Implement:
- pnpm-based project scaffold unless the repo already uses another package manager.
- Electron main process, preload, and React renderer using TypeScript and Vite.
- Hardened BrowserWindow defaults: contextIsolation true, nodeIntegration false, sandbox true unless there is a documented blocker, navigation/new-window lockdown, preload-only API.
- Minimal app shell that renders the real planner frame with sidebar placeholders for Today, Tasks, Calendar, Notes, Search, Settings. Do not build a landing page.
- Tailwind and global CSS variables from docs/design/design-system.md.
- Initial shared result/error types for preload calls.
- One health-check preload API with runtime validation.
- Vitest setup.
- Playwright Electron smoke setup that verifies app launch and shell render.
- Initial performance smoke command placeholder and artifact directory conventions from docs/performance/build-and-test-performance.md.
- Startup timing spans for app ready, window created, renderer loaded, and shell visible if feasible in the scaffold.
- Basic scripts: dev, build, test, test:unit, test:smoke, lint or typecheck.
- Update docs only if setup decisions differ from the existing specs.

Do not:
- Implement Google OAuth.
- Implement SQLite repositories beyond placeholders needed to compile.
- Implement MCP.
- Copy Swift source code from the old repository.
- Give renderer direct Node, filesystem, SQLite, token, or Google access.

Acceptance checks:
- Install dependencies.
- Run typecheck/build if configured.
- Run Vitest.
- Run the Playwright launch smoke test if the environment supports it.
- Summarize changed files, commands run, and any blockers.
```

### P0.5 Performance Harness

Run this prompt by itself after P0 and before Phase 1 parallel work. It establishes measurement conventions before feature agents start adding UI, IPC, and data paths.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: add the initial performance measurement harness for Hot Cross Buns 2 without optimizing non-existent product features.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md
- docs/architecture/system-architecture.md

Implement:
- A `test:perf` script or equivalent placeholder that can run once product flows exist.
- Deterministic fixture generation utilities for small, medium, and large local datasets, using generated data only.
- Performance artifact conventions under `artifacts/perf/`, with generated artifacts ignored unless docs explicitly request a baseline sample.
- Startup timing capture for app ready, main window created, renderer loaded, shell visible, database ready if the scaffold already has database initialization.
- A small markdown or JSON performance report writer.
- Documentation updates only where commands or artifact paths differ from docs/performance/build-and-test-performance.md.

Do not:
- Add real Google calls.
- Read a user's real app data.
- Invent hard failure thresholds before baselines exist.
- Weaken Electron security settings to make measurement easier.

Acceptance checks:
- Run typecheck/build if available.
- Run unit tests if available.
- Run the performance harness in report-only mode if possible.
- Summarize generated fixture sizes, artifact paths, and remaining hooks future phases must fill in.
```

## Phase 1 - Foundations

After P0 lands, P1A, P1B, and P1C can run in parallel because their write sets are separate. Avoid package dependency edits unless unavoidable; if a dependency is missing, add it and call that out clearly.

### P1A Renderer Shell

Parallel-safe with P1B and P1C.

Write ownership:

- `src/renderer/**`
- `src/styles/**`
- renderer-only tests
- design docs only if needed

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: build the renderer app shell and design-system foundation without wiring real data.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/core-app.md
- docs/design/design-system.md
- docs/performance/renderer-performance.md
- docs/performance/performance-strategy.md
- docs/architecture/system-architecture.md
- docs/testing/qa-plan.md

Write only in the renderer/design write set unless a tiny shared type is absolutely required:
- src/renderer/**
- src/styles/**
- renderer component tests

Implement:
- A compact planner shell with sidebar, top toolbar/status area, and main content.
- Sections for Today, Tasks, Calendar, Notes, Search, and Settings using local mock data only.
- Keyboard-accessible navigation and visible focus states.
- Command palette UI shell with mock command list.
- Loading, empty, offline, and error state components.
- Reusable compact components for buttons, icon buttons, inputs, badges, status banners, list rows, panels, and dialogs/popovers if the scaffold supports them.
- Initial virtualized list wrapper or adapter for future task/event/search surfaces.
- Lightweight render timing hooks for performance builds only, if the scaffold supports this cleanly.
- Tailwind/CSS variables matching docs/design/design-system.md.
- Renderer tests for shell render, navigation, command palette open/filter, and key empty/error states.

Do not:
- Add real SQLite, Google, MCP, or filesystem access.
- Modify main/preload behavior except for already-existing mock APIs.
- Use oversized marketing/landing page layouts.

Acceptance checks:
- Run renderer/unit tests.
- Run typecheck/build if available.
- Summarize changed files, tests run, and any missing shared contracts needed from P1B.
```

### P1B IPC Foundation

Parallel-safe with P1A and P1C.

Write ownership:

- `src/main/ipc/**`
- `src/preload/**`
- `src/shared/ipc/**`
- IPC tests

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement the typed preload and IPC foundation that all future features must use.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/architecture/system-architecture.md
- docs/security/privacy-and-threat-model.md
- docs/performance/main-and-data-performance.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md

Write only in the IPC write set unless a tiny main registration hook is needed:
- src/main/ipc/**
- src/preload/**
- src/shared/ipc/**
- tests for IPC/preload contracts

Implement:
- A stable preload API namespace, preferably window.hcb.
- Shared HcbResult and HcbError types matching docs/architecture/system-architecture.md.
- Runtime schemas for requests and responses, using the validation library already chosen by P0.
- Domain namespaces for tasks, calendar, notes, search, sync, settings, mcp, native, and diagnostics, even if most methods are stubs.
- IPC handler registration helpers that validate input before service execution and sanitize thrown errors.
- IPC timing/logging hooks for development diagnostics that do not expose payload contents or secrets.
- Bounded payload conventions for list/range APIs.
- Tests proving valid requests succeed, invalid requests are rejected, errors are sanitized, and renderer-facing APIs expose no broad Node primitives.

Do not:
- Implement product services.
- Add direct database or Google code here.
- Create a generic execute-command or arbitrary-file IPC method.

Acceptance checks:
- Run IPC/preload tests.
- Run typecheck/build if available.
- Summarize public preload methods and any contracts P1A/P1C should consume.
```

### P1C Local Data Foundation

Parallel-safe with P1A and P1B.

Write ownership:

- `src/main/data/**`
- `src/main/migrations/**`
- `src/shared/domain/**` if needed for data DTOs
- SQLite tests

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: create the SQLite migration and repository foundation for Hot Cross Buns 2.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/local-data.md
- docs/specs/google-sync.md
- docs/architecture/system-architecture.md
- docs/security/privacy-and-threat-model.md
- docs/performance/main-and-data-performance.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/reference/legacy-hot-cross-buns-context.md

Also inspect the legacy schema for behavior, not runtime dependency:
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/schema/canonical.sql

Write only in the local data write set:
- src/main/data/**
- src/main/migrations/**
- src/shared/domain/** if needed
- data and migration tests

Implement:
- SQLite connection factory for app paths and temporary test databases.
- Numbered migration runner.
- Initial schema covering accounts metadata, task lists/tasks, calendar lists/events, notes, settings, sync checkpoints, pending mutations, and diagnostics metadata.
- Repository interfaces and initial implementations for notes, settings, checkpoints, and pending mutations.
- Task/event mirror repository skeletons with enough CRUD to support later sync tests.
- Transaction helper.
- Indexes for core read paths described in docs/performance/main-and-data-performance.md.
- Query-plan tests or helpers for representative core queries.
- Tests for fresh migration, repeated migration, rollback on failed transaction, and basic repository CRUD.

Do not:
- Store Google tokens, MCP bearer tokens, or encryption keys in SQLite.
- Expose database access to renderer code.
- Implement Google sync logic.

Acceptance checks:
- Run SQLite/migration tests.
- Run typecheck/build if available.
- Summarize schema tables, migration version, and repository contracts.
```

### P1D Integration Review

Run alone after merging P1A, P1B, and P1C.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: integrate and review Phase 1 outputs from renderer shell, IPC foundation, and local data foundation.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/architecture/system-architecture.md
- docs/specs/core-app.md
- docs/specs/local-data.md
- docs/performance/performance-strategy.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md

Tasks:
- Resolve merge conflicts or contract mismatches between renderer, preload, main, shared types, and data code.
- Ensure renderer code uses preload contracts only and does not import main/data modules.
- Ensure local data tests use temporary databases only.
- Ensure shell, IPC, and data foundations preserve the performance budgets and startup staging in docs/performance/performance-strategy.md.
- Ensure any performance instrumentation is opt-in, local, and redacted.
- Ensure docs remain accurate if implementation choices changed.
- Add or fix minimal tests required to prove Phase 1 boundaries.

Acceptance checks:
- Run full available test suite.
- Run typecheck/build.
- Run Playwright launch smoke if available.
- Report any remaining architectural risks before Phase 2.
```

## Phase 2 - Services And Core Screens

After P1D lands, P2A, P2B, and P2C can run in parallel. They should not rewrite the Phase 1 foundations.

### P2A Google Sync

Parallel-safe with P2B and P2C.

Write ownership:

- `src/main/google/**`
- `src/main/sync/**`
- Google/sync tests
- small shared domain types if needed

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement the Google OAuth and read-sync service foundation.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/google-sync.md
- docs/specs/local-data.md
- docs/security/privacy-and-threat-model.md
- docs/performance/main-and-data-performance.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/reference/legacy-hot-cross-buns-context.md

Legacy references to inspect for behavior:
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Services/Google
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Services/Sync
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/GoogleTasksClientTransportTests.swift
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/GoogleCalendarClientTransportTests.swift

Write only in the Google/sync write set unless a tiny repository method is required:
- src/main/google/**
- src/main/sync/**
- tests for Google/sync behavior

Implement:
- Desktop OAuth service boundary with token storage delegated to a credential adapter.
- Sanitized account connection status DTOs.
- Google Tasks and Calendar transport adapters with mockable interfaces.
- Initial read-sync orchestration for task lists/tasks and calendar lists/events.
- Checkpoint handling for Tasks watermarks and Calendar nextSyncToken.
- Backoff policy with jitter for 429 and 5xx.
- Batched SQLite writes and progress/status events so initial sync does not block cached UI.
- Sync duration timing fields for sanitized diagnostics.
- Tests with mocked transport for success, 401, 403, invalid Calendar sync token, 429, and 5xx.

Do not:
- Put tokens in renderer, SQLite, logs, or diagnostics.
- Implement UI beyond any existing sync status contract.
- Implement write sync yet except interfaces needed for future mutation queue.

Acceptance checks:
- Run Google/sync tests.
- Run typecheck/build if available.
- Summarize OAuth/token boundaries and sync checkpoints.
```

### P2B MCP Server

Parallel-safe with P2A and P2C.

Write ownership:

- `src/main/mcp/**`
- `src/main/security/**` if needed for auth helpers
- MCP tests

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement the local MCP server foundation with test doubles for domain services.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/mcp-agent-access.md
- docs/security/privacy-and-threat-model.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md
- docs/reference/legacy-hot-cross-buns-context.md

Legacy references to inspect for behavior:
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/docs/mcp.md
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Services/MCP
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/MCPServerControllerTests.swift

Write only in the MCP/security write set:
- src/main/mcp/**
- src/main/security/** if needed
- tests for MCP contracts

Implement:
- MCP HTTP JSON-RPC endpoint bound to 127.0.0.1.
- Bearer-token auth boundary with credential adapter interface.
- Permission modes: read-only, confirm writes, allow writes.
- Required read/write tool registry with handlers backed by test-domain service doubles for now.
- dryRun and confirmationId flow.
- Destructive writes requiring confirmation even in allow-writes mode.
- Header/body caps, malformed JSON rejection, unexpected origin rejection, rate limiting, sanitized audit event interface.
- Lightweight request timing and count metrics for diagnostics without recording tool argument values.
- Contract tests for unauthorized/missing token, malformed JSON, oversized body, unexpected origin, read tool success, dry-run write, blocked direct write, destructive confirmation requirement, and audit redaction.

Do not:
- Start MCP by default unless settings later enables it.
- Return raw tokens, Google payloads, or full tool arguments in logs/audit.
- Create a separate MCP-only mutation service that bypasses the UI domain service model.

Acceptance checks:
- Run MCP tests.
- Run typecheck/build if available.
- Summarize exposed tools and security controls.
```

### P2C Core Screens With Mock Data

Parallel-safe with P2A and P2B.

Write ownership:

- `src/renderer/features/**`
- renderer tests
- mock preload fixtures

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: build the main core screens against mock preload data so the product shape is ready before real data wiring.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/core-app.md
- docs/design/design-system.md
- docs/performance/renderer-performance.md
- docs/performance/performance-strategy.md
- docs/product/prd.md
- docs/testing/qa-plan.md

Write only in the renderer feature write set:
- src/renderer/features/**
- src/renderer/components/** if the component does not exist
- renderer tests and mock fixtures

Implement:
- Today view with tasks and calendar agenda mock data.
- Tasks view with list grouping, completion state, subtasks, filters, and empty/error states.
- Calendar agenda/day/week/month view shells with mock events.
- Notes view with create/edit/delete UI state backed by local mock state.
- Search view over mock tasks/events/notes.
- Settings view sections for Google, sync, appearance, hotkeys, tray, notifications, MCP, diagnostics.
- Keep layouts compact and keyboard-accessible.
- Use virtualization or virtualized placeholders for large task/event/search lists.
- Avoid render-time grouping, sorting, recurrence expansion, and search ranking for large collections; use mock precomputed view models where needed.
- Renderer tests for each screen's main states.

Do not:
- Wire real SQLite or Google.
- Put real secrets or tokens in fixtures.
- Add large decorative hero/landing-page UI.

Acceptance checks:
- Run renderer tests.
- Run typecheck/build if available.
- Summarize screen coverage and any missing preload contracts.
```

### P2D Integration Review

Run alone after merging P2A, P2B, and P2C.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: integrate Phase 2 service and screen work.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/architecture/system-architecture.md
- docs/specs/google-sync.md
- docs/specs/mcp-agent-access.md
- docs/specs/core-app.md
- docs/performance/performance-strategy.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md

Tasks:
- Resolve shared type, service, or test conflicts from Google sync, MCP, and renderer screen work.
- Ensure service code remains outside renderer imports.
- Ensure MCP handlers call shared domain service interfaces or test doubles that can later be replaced.
- Ensure screen mock data can be swapped for preload calls in Phase 3.
- Ensure sync and MCP instrumentation is redacted and does not block startup.
- Ensure renderer screens are prepared for large datasets via virtualized or paginated surfaces.
- Update docs for any intentional contract changes.

Acceptance checks:
- Run full available test suite.
- Run typecheck/build.
- Run Playwright launch smoke if available.
- Report what remains before real data wiring.
```

## Phase 3 - Real Data Wiring

Run this by itself. It crosses renderer, preload, main services, SQLite, and sync boundaries.

### P3 Real Data Wiring

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: wire the renderer, preload, domain services, SQLite repositories, and Google read-sync foundation into a coherent local-first app flow.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/architecture/system-architecture.md
- docs/specs/core-app.md
- docs/specs/local-data.md
- docs/specs/google-sync.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md

Implement:
- Real preload APIs for reading task lists/tasks, calendars/events, notes, search results, sync status, settings, and diagnostics.
- Main service composition that connects IPC handlers to repositories and sync services.
- Renderer data hooks that call preload APIs and handle loading, empty, error, offline, and stale states.
- App startup flow that initializes migrations and renders cached data before fresh sync completes.
- Sync status events/subscriptions if supported by the established IPC pattern.
- Search backed by local SQLite, not Google per keystroke.
- Bounded list/range preload APIs for large tasks, events, notes, and search result sets.
- Local performance timings for startup, cached render, IPC latency, SQLite query duration, and search latency.
- Tests covering renderer-to-preload contracts and service integration with temporary DBs.

Do not:
- Implement all write flows yet beyond notes if already local and low risk.
- Expose tokens or raw Google errors to renderer.
- Allow renderer to import main/data modules.

Acceptance checks:
- Run full test suite.
- Run typecheck/build.
- Run Playwright launch smoke.
- Run performance harness in report-only mode if available.
- Manually note whether app can render from empty/fresh SQLite and from seeded local data.
```

### P3E Real Data Performance Baseline

Run alone after P3. This prompt should measure and tune the real data path before feature agents add more workflows on top.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: create the first real-data performance baseline for startup, local cache rendering, search, IPC, and SQLite query behavior.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/performance/performance-strategy.md
- docs/performance/main-and-data-performance.md
- docs/performance/renderer-performance.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md
- docs/architecture/system-architecture.md

Implement:
- Performance smoke coverage for cold launch, warm launch, cached shell render, command palette open, local search against medium fixture, and representative SQLite core queries.
- Generated small, medium, and large fixtures if P0.5 did not fully implement them.
- `EXPLAIN QUERY PLAN` assertions or reports for core task, event, note, search, checkpoint, and pending mutation queries.
- Report-only performance artifact generation under the established artifacts path.
- Targeted fixes for obvious full scans, unbounded IPC payloads, or render-time large-data transforms discovered by the baseline.

Do not:
- Hit Google APIs.
- Use real user app data.
- Turn unstable local timings into hard CI failures.
- Weaken security or renderer isolation for measurement.

Acceptance checks:
- Run performance smoke in report-only mode.
- Run SQLite tests.
- Run IPC/preload tests.
- Run typecheck/build.
- Summarize measured timings, query-plan findings, changes made, and remaining risks.
```

## Phase 4 - Core Product Workflows

After P3E lands, P4A, P4B, and P4C can run in parallel if they keep to their write sets. They may share mutation interfaces but should not rewrite each other's UI.

### P4A Tasks

Parallel-safe with P4B and P4C.

Write ownership:

- task domain services
- task renderer features
- task tests

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement task workflows end to end.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/core-app.md
- docs/specs/google-sync.md
- docs/specs/local-data.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md
- docs/reference/legacy-hot-cross-buns-context.md

Legacy references to inspect for behavior:
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Features/Tasks
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Features/QuickAdd/NaturalLanguageTaskParser.swift
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/TaskDraftTests.swift
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/NaturalLanguageTaskParserTests.swift

Implement:
- Task create, edit, complete, reopen, move, delete.
- Task list create/rename/delete if the Google service supports the necessary API shape; otherwise implement local UI with disabled/explicit unavailable state.
- Subtask display and parent/child operations where supported.
- Offline mutation queue integration for task writes.
- Optimistic UI and recoverable error states.
- Task-focused command palette actions and quick capture integration.
- Virtualized task lists and stable row view models so single-task changes do not re-render the full surface.
- Task query/index checks for list, status, due date, parent, and sort-order paths.
- Tests for task mutations, optimistic state, offline queue behavior, and renderer interactions.

Do not:
- Add time-specific task due times as Google Task fields.
- Touch calendar write UI except through shared mutation infrastructure if required.
- Store Google tokens in task code.

Acceptance checks:
- Run task/domain tests.
- Run relevant renderer tests.
- Run full typecheck/build.
- Summarize remaining Google Tasks API limitations.
```

### P4B Calendar

Parallel-safe with P4A and P4C.

Write ownership:

- calendar domain services
- calendar renderer features
- calendar tests

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement calendar workflows end to end.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/core-app.md
- docs/specs/google-sync.md
- docs/specs/local-data.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md
- docs/reference/legacy-hot-cross-buns-context.md

Legacy references to inspect for behavior:
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Features/Calendar
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/CalendarGridLayoutTests.swift
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/CalendarEventInstanceTests.swift
- /Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/GuestsSectionEmailTests.swift

Implement:
- Event create, edit, delete for timed and all-day events.
- Calendar agenda/day/week/month interactions.
- Event form fields for title, calendar, start/end, all-day, location, notes/description, guests, reminders where supported.
- Offline mutation queue integration for event writes.
- Recurring event instance display from mirrored Google data.
- Calendar-focused command palette actions.
- Visible-range event queries and cached/materialized recurrence expansion so calendar grids do not expand all account history in render.
- Calendar query/index checks for calendar id and visible start/end range paths.
- Tests for event mapping, all-day/timed behavior, mutation queue behavior, and renderer interactions.

Do not:
- Build a custom recurrence editor unless the existing specs have been updated for it.
- Touch task write UI except through shared mutation infrastructure if required.
- Return raw Google event payloads to renderer errors.

Acceptance checks:
- Run calendar/domain tests.
- Run relevant renderer tests.
- Run full typecheck/build.
- Summarize remaining Calendar API limitations.
```

### P4C Notes Search Command Palette

Parallel-safe with P4A and P4B.

Write ownership:

- notes domain/services/UI
- search services/UI
- command palette
- related tests

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: complete local notes, local-first search, and command palette workflows.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/core-app.md
- docs/specs/local-data.md
- docs/design/design-system.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md

Implement:
- Local-only note create, edit, delete, and restore/soft-delete behavior if supported by schema.
- Local search across tasks, events, and notes without calling Google per keystroke.
- Search result deep links into app routes.
- Command palette commands for navigation, new task, new event, new note, quick capture, refresh, force full resync, settings, diagnostics.
- Keyboard shortcuts and focus management for palette use.
- Capped local search result sets with ranking done outside render.
- Palette open path that does not wait on network, sync, migration, or heavy settings/search modules.
- Tests for note repository/service behavior, search ranking/filtering, palette commands, and renderer interactions.

Do not:
- Sync notes to Google or any cloud provider.
- Implement task/calendar write behavior beyond invoking their existing command contracts.
- Add in-app text explaining keyboard shortcuts as a substitute for actual shortcuts.

Acceptance checks:
- Run notes/search/palette tests.
- Run relevant renderer tests.
- Run full typecheck/build.
- Summarize search behavior and known ranking limitations.
```

### P4D Integration Review

Run alone after merging P4A, P4B, and P4C.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: integrate the core product workflows into one coherent app.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/core-app.md
- docs/specs/google-sync.md
- docs/specs/local-data.md
- docs/specs/mcp-agent-access.md
- docs/performance/performance-strategy.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md

Tasks:
- Resolve conflicts across task, calendar, notes, search, command palette, mutation queue, and shared domain code.
- Ensure UI writes and MCP writes can share domain services.
- Ensure offline queue behavior is consistent across task and event writes.
- Ensure local search indexes current task/event/note state.
- Ensure task, calendar, notes, search, and command palette paths respect performance budgets and avoid unbounded render/IPC/data work.
- Update docs for any changed feature behavior.

Acceptance checks:
- Run full test suite.
- Run typecheck/build.
- Run Playwright smoke tests for launch, navigation, command palette, quick capture, and basic create flows where possible.
- Run performance smoke in report-only mode if available.
- Report remaining v1 blockers.
```

### P4E Interaction Performance Pass

Run alone after P4D. This pass is where agents should tune actual user interactions after the core task/calendar/notes/search workflows exist.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: make the implemented core workflows feel snappy under medium and large local datasets.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/performance/performance-strategy.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md
- docs/specs/core-app.md

Tasks:
- Profile or instrument command palette open, quick capture open, task completion, task list scrolling, calendar navigation, note editing, and local search.
- Fix obvious render churn, unbounded list rendering, repeated grouping/sorting, slow local search, unnecessary IPC payload size, and missing indexes.
- Add or refine virtualized surfaces for long task, event, note, and search result lists.
- Add focused regression tests or performance smoke coverage for the slow paths fixed.
- Keep performance instrumentation local, opt-in, and redacted.

Do not:
- Rewrite product behavior for benchmark convenience.
- Add broad memoization without a measured or structurally obvious reason.
- Use real Google data or user app data in performance tests.
- Break accessibility or keyboard navigation while optimizing.

Acceptance checks:
- Run performance smoke in report-only mode.
- Run relevant renderer/domain tests.
- Run typecheck/build.
- Summarize before/after timings or qualitative profiling evidence and any remaining hotspots.
```

## Phase 5 - Native Shell, Settings, Security

After P4E lands, P5A, P5B, and P5C can run in parallel if they respect write ownership.

### P5A Native Shell

Parallel-safe with P5B and P5C.

Write ownership:

- native adapters
- main lifecycle
- native tests/manual checklist

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement macOS native shell behavior for the core app.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/specs/native-parity.md
- docs/specs/core-app.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md

Implement:
- macOS tray/menu bar icon and menu actions.
- Global quick capture hotkey registration with conflict/error reporting.
- Custom protocol deep-link handling.
- Basic local notification scheduling for due tasks and upcoming events.
- Native adapter interfaces that leave room for Windows/Linux implementations later.
- Deferred native startup so tray, hotkey, notifications, updater checks, and MCP startup do not block first interactive render.
- Manual verification checklist for tray, hotkey, notifications, and deep links.

Do not:
- Implement deferred Spotlight, App Intents, or Share Extension unless a separate spec update is approved.
- Put native calls in renderer code.
- Start background sync mechanisms beyond the current sync settings model.

Acceptance checks:
- Run native adapter tests where possible.
- Run typecheck/build.
- Perform or document manual macOS checks.
- Summarize platform caveats.
```

### P5B Settings Diagnostics

Parallel-safe with P5A and P5C.

Write ownership:

- settings UI/services
- diagnostics UI/services
- related tests

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: complete Settings and Diagnostics for v1.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/core-app.md
- docs/specs/google-sync.md
- docs/specs/mcp-agent-access.md
- docs/specs/local-data.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md

Implement:
- Settings sections for Google account, selected task lists/calendars, sync mode, appearance, hotkeys, tray, notifications, local data, MCP, diagnostics.
- Diagnostics summary with account status, sync status, cache status, selected resources, checkpoint state, pending mutation state, MCP status, and app version/build metadata.
- Sanitized performance diagnostics for startup timings, migration duration, sync duration, slow query samples, pending mutation counts, and MCP request counts.
- Recovery actions: refresh, force full resync, clear local Google cache before reload, reset MCP token.
- Confirmation UI for destructive data controls.
- Redaction for tokens, secrets, raw Google payloads, MCP bearer tokens, and sensitive note/event/task bodies where appropriate.
- Tests for settings persistence, diagnostics redaction, and destructive confirmation behavior.

Do not:
- Expose raw credentials.
- Add analytics or cloud crash reporting.
- Let settings bypass domain services.

Acceptance checks:
- Run settings/diagnostics tests.
- Run typecheck/build.
- Summarize diagnostics fields and redaction guarantees.
```

### P5C Security Hardening

Parallel-safe with P5A and P5B.

Write ownership:

- security config/tests
- Electron hardening tests
- redaction helpers
- docs/security updates

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: harden Electron, IPC, secrets, diagnostics, and MCP behavior before release packaging.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/security/privacy-and-threat-model.md
- docs/architecture/system-architecture.md
- docs/specs/mcp-agent-access.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md

Implement:
- Production Content Security Policy.
- Navigation and new-window allowlist enforcement.
- Central redaction utilities for logs, diagnostics, IPC errors, Google errors, and MCP audit events.
- Tests proving renderer cannot import privileged modules.
- Tests proving OAuth status excludes tokens.
- Tests proving representative logs/errors do not contain fake token fixtures.
- Review and tighten MCP auth, body limits, origin checks, and rate limiting if gaps remain.
- Verify performance instrumentation and reports do not include secrets, raw personal content, or raw Google payloads.
- Update docs/security/privacy-and-threat-model.md for any final security decisions.

Do not:
- Relax BrowserWindow hardening without documenting a blocker.
- Add a generic local command execution capability.
- Store credentials outside the OS credential adapter.

Acceptance checks:
- Run security tests.
- Run full test suite if feasible.
- Run typecheck/build.
- Summarize security posture and residual risks.
```

### P5D Integration Review

Run alone after merging P5A, P5B, and P5C.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: integrate native shell, settings, diagnostics, and security hardening into the Mac v1 app.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/specs/native-parity.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md

Tasks:
- Resolve conflicts across native adapters, settings, diagnostics, MCP, and security utilities.
- Confirm settings drive tray, hotkey, notifications, sync, and MCP behavior.
- Confirm diagnostics are useful and redacted.
- Confirm renderer remains unprivileged.
- Confirm native shell and diagnostics additions did not regress startup and command-palette/quick-capture responsiveness.
- Update docs if behavior changed.

Acceptance checks:
- Run full test suite.
- Run typecheck/build.
- Run Playwright smoke tests.
- Run performance smoke in report-only mode if available.
- Complete or update manual macOS checklist for tray, hotkey, notifications, and deep links.
- Report remaining release blockers.
```

## Phase 6 - Release Packaging

Run by itself because packaging touches app metadata, scripts, build config, and release docs.

### P6 Release Packaging

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement Mac preview packaging and release documentation.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/release/distribution.md
- docs/specs/platforms.md
- docs/security/privacy-and-threat-model.md
- docs/performance/build-and-test-performance.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md

Implement:
- Electron packaging config for macOS preview artifact, using the package tool chosen by the scaffold.
- GitHub Releases oriented release scripts or documented commands.
- Checksum generation.
- Version metadata available in app diagnostics.
- Bundle/dependency review for renderer/main separation and avoidable runtime bloat.
- Clear unsigned-preview install notes if signing/notarization is not configured.
- Future signing/notarization placeholders documented but not falsely enabled.
- Update docs/release/distribution.md with exact commands.

Do not:
- Claim auto-update is enabled unless signed updater metadata is actually configured and tested.
- Store signing secrets in the repository.
- Break local dev/test scripts.

Acceptance checks:
- Run full test suite.
- Run typecheck/build.
- Run packaging command if the local environment supports it.
- Run bundle/dependency review command if configured.
- Verify artifact path/checksum behavior.
- Summarize release steps and any signing gaps.
```

## Phase 7 - Final Product QA

Run by itself after Mac v1 feature and packaging work is merged.

### P7 Final Product QA

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: perform a release-candidate QA pass for Mac v1.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/product/prd.md
- docs/product/roadmap.md
- docs/testing/qa-plan.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/performance/build-and-test-performance.md

Tasks:
- Run the full automated suite.
- Run typecheck/build.
- Run Playwright Electron smoke tests.
- Run performance smoke tests and include timing output in the release-readiness report.
- Run packaging if available.
- Audit docs against implemented behavior and update mismatches.
- Check that v1 success criteria in docs/product/prd.md are either implemented or explicitly listed as remaining blockers.
- Review git diff for accidental secret exposure, old Swift dependency, renderer privilege leaks, and unrelated churn.
- Review startup, command palette, quick capture, search, task scrolling, and calendar navigation against docs/performance/performance-strategy.md budgets.
- Produce a concise release-readiness report in docs/release/release-candidate-checklist.md.

Do not:
- Add new feature scope during QA unless needed to fix a release blocker.
- Hide failing tests by weakening assertions.
- Claim Windows/Linux support.

Acceptance checks:
- Release-readiness report exists.
- All commands run are listed with pass/fail status.
- Remaining blockers are concrete and owned by subsystem.
```

## Future Platform Prompts

Run these only after Mac v1 is stable. They can run in parallel because they should create platform adapters/docs/tests without rewriting Mac behavior.

### P8A Windows Prep

Parallel-safe with P8B after Mac v1.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: prepare Hot Cross Buns 2 for Windows without claiming full Windows support yet.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md

Implement:
- Windows platform adapter stubs/tests for credentials, tray, global shortcuts, notifications, custom protocol, app paths, and updater metadata.
- Windows packaging documentation and installer recommendation.
- Windows manual QA checklist.
- Windows performance smoke checklist for startup, tray/hotkey, search, and large-list rendering.
- Any safe code changes needed to remove Mac-only assumptions from shared services.

Do not:
- Break macOS behavior.
- Claim Windows release readiness unless launch/package tests actually pass on Windows.

Acceptance checks:
- Run shared tests.
- Run typecheck/build.
- Summarize Windows blockers and required manual checks.
```

### P8B Linux Prep

Parallel-safe with P8A after Mac v1.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: prepare Hot Cross Buns 2 for Linux without claiming full Linux support yet.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md

Implement:
- Linux platform adapter stubs/tests for credentials, tray, global shortcuts, notifications, custom protocol, app paths, and updater metadata.
- Linux packaging documentation, starting with AppImage unless the docs justify another target.
- Linux manual QA checklist with Wayland/X11 tray and global shortcut caveats.
- Linux performance smoke checklist for startup, tray/hotkey caveats, search, and large-list rendering.
- Any safe code changes needed to remove Mac-only assumptions from shared services.

Do not:
- Break macOS behavior.
- Claim universal Linux parity.

Acceptance checks:
- Run shared tests.
- Run typecheck/build.
- Summarize Linux blockers and required manual checks.
```
