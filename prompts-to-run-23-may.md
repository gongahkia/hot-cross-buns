## Improvement Docs For Every Prompt

Before running any prompt below, use the improvement docs as Electron-specific parity guidance:

- `docs/improvements/01-user-facing-feature-parity.md`
- `docs/improvements/02-backend-optimizations.md`
- `docs/improvements/03-database-optimizations.md`
- `docs/improvements/04-test-coverage-parity.md`
- `docs/improvements/05-general-parity-and-release-polish.md`

These docs compare Hot Cross Buns 2 with the legacy Swift app, but they are not instructions to port Swift APIs directly. Preserve the Electron, React, TypeScript, SQLite, and platform-adapter architecture. Treat Swift-only surfaces as reference behavior only, then decide whether each parity item belongs in Electron platform code, shared backend code, docs, tests, manual QA, or explicit backlog.

## Mac V1 Improvement Prompts

Run these before Linux/Windows port work unless the Mac v1 release decision explicitly accepts the remaining blockers. These prompts synthesize the non-platform-specific takeaways from `docs/improvements/`.

### P7A Mac V1 Runtime Readiness

Run first. This prompt assumes P8A may already have been started accidentally, so it stabilizes adapter/capability-report work before touching runtime blockers.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: stabilize any partial P8A platform-adapter audit changes, then close the highest-risk Mac v1 backend/runtime blockers.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/product/prd.md
- docs/product/roadmap.md
- docs/release/release-candidate-checklist.md
- docs/security/privacy-and-threat-model.md
- docs/testing/qa-plan.md
- docs/ports/cross-platform-porting.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/03-database-optimizations.md
- docs/improvements/04-test-coverage-parity.md

Preflight:
- Inspect current git diff first.
- Treat existing NativeCapabilityReport / platform-adapter contract changes as user work.
- Do not revert them unless they are clearly broken and replaced with equivalent working behavior.
- First make current adapter/capability-report changes compile for macOS and noop adapters.
- Keep Linux/Windows implementation out of scope.

Implement after preflight:
- Durable Google pending-mutation worker for task/calendar queued writes.
- Retry/backoff/auth-failure pause behavior with diagnostics.
- Tests for mutation status transitions, retry behavior, auth pause, and no renderer execution.
- Use the existing native capability-report model for diagnostics/status where relevant.
- Add sync scheduler skeleton only if needed by the worker.
- Update release blockers/docs based on actual implemented behavior.

Do not:
- Add Linux/Windows port implementation.
- Add packaging scope.
- Expose secrets to renderer or diagnostics.
- Weaken assertions to hide failing sync behavior.
- Replace the SQLite bridge unless the worker cannot be tested without doing so.

Acceptance checks:
- Run focused sync/domain/native tests.
- Run `pnpm typecheck`.
- Run `pnpm build`.
- Run `git diff --check`.
- Produce a concise status note listing stabilized P8A changes, implemented Mac runtime behavior, and remaining blockers.
```

### P7B SQLite And Performance Foundation

Run after P7A unless runtime work proves the current SQLite bridge is already the dominant blocker.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: remove the biggest local data performance risk by replacing or containing the Python SQLite bridge and adding production SQLite foundations.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/performance/performance-strategy.md
- docs/performance/main-and-data-performance.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md
- docs/improvements/03-database-optimizations.md
- docs/improvements/04-test-coverage-parity.md

Implement:
- Replace the Python subprocess SQLite bridge with a packaged main-process SQLite adapter, or produce a minimal compatibility layer if the chosen binding cannot be safely packaged in this pass.
- Preserve the existing repository-facing `SqliteConnection` contract where practical.
- Apply and test production pragmas: foreign keys, WAL, synchronous normal, temp store memory, cache size, mmap size, and busy timeout.
- Add prepared-statement support or repository-local prepared helpers for the hottest query/write paths.
- Add tests for migrations, transactions, reopened pragmas, FTS queries, rollback on injected failure, and package compatibility where feasible.
- Re-run performance smoke and record before/after SQLite and startup timing.

Do not:
- Change renderer data contracts unless required by the adapter boundary.
- Add derived render tables in the same pass unless the bridge replacement is already complete and stable.
- Commit generated databases or local profiling artifacts.

Acceptance checks:
- Run SQLite/domain tests.
- Run `pnpm test:perf`.
- Run `pnpm typecheck`.
- Run `pnpm build`.
- Update performance docs or the RC checklist with measured timing changes and remaining data-path blockers.
```

### P7C First-Run Onboarding And Setup

Run after P7A, and after P7B if startup/data performance remains a blocker.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: add a coherent first-run Mac v1 setup flow using the existing Electron/React/IPC architecture.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/product/prd.md
- docs/specs/core-app.md
- docs/specs/native-parity.md
- docs/security/privacy-and-threat-model.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Implement:
- Add a first-run onboarding route or modal that appears when local settings show setup has not completed.
- Include setup steps for Google runtime-client/OAuth readiness, selected task lists, selected calendars, sync mode, notification preference, and optional MCP access.
- Persist setup completion timestamp in local settings.
- Add a Settings action to reset onboarding without deleting planner data.
- Keep local notes and settings usable when Google setup is skipped.
- Add renderer and IPC tests for fresh database onboarding, completion, skip behavior, and reset.

Do not:
- Store OAuth client secrets in the repo.
- Block local-only usage behind Google sign-in.
- Add new Google transport behavior beyond what the current runtime services can actually support.
- Use onboarding copy to promise Windows/Linux support.

Acceptance checks:
- Run focused renderer/settings tests.
- Run `pnpm typecheck`.
- Run `pnpm build`.
- Run `pnpm test:smoke` if app startup or first-route behavior changes.
- Update docs to distinguish implemented setup behavior from remaining Google sync blockers.
```

### P7D Search And Planner Power Slice

Run after P7A/P7B. Keep this to one user-facing slice, not the whole legacy planner.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: add a local-first search/planner parity slice that improves daily use without expanding scope into full legacy calendar/task parity.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/core-app.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/03-database-optimizations.md
- docs/improvements/04-test-coverage-parity.md

Implement:
- Add structured local search parsing for a small initial DSL: domain/source, task status, due/start date windows, priority, list/calendar title, and notes/body presence.
- Surface parsed filters as chips in Search with inline invalid-query feedback.
- Add saved local custom filters only if the parser and matching logic are stable.
- Add tests for parser edge cases, matcher behavior, invalid syntax, local-only guarantee, and command palette discoverability.
- Profile search UI update timing against the RC performance budget.

Do not:
- Call Google per keystroke.
- Add full fuzzy ranking, tag extraction, kanban, day/week grids, or recurrence editing in this pass.
- Store filters in a second source of truth outside settings/local database.

Acceptance checks:
- Run search/shared-domain tests.
- Run renderer tests for Search.
- Run `pnpm test:perf` if search UI/data paths changed.
- Run `pnpm typecheck`.
- Run `pnpm build`.
- Document implemented query syntax and known deferred planner parity.
```

### P7E Release Polish, CI, And Support Readiness

Run after the main Mac v1 runtime blockers are stable enough that release evidence is worth automating.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: add release/support polish that catches regressions and gives Mac preview users accurate install, privacy, and diagnostic guidance.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/release/distribution.md
- docs/release/release-candidate-checklist.md
- docs/security/privacy-and-threat-model.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md
- docs/improvements/05-general-parity-and-release-polish.md

Implement:
- Add GitHub Actions CI for pnpm install, typecheck, unit tests, and Electron smoke where the runner supports it.
- Upload useful test reports/artifacts for failed smoke/performance runs.
- Add or update contributor setup docs, release command docs, unsigned preview install guidance, privacy summary, and diagnostics/support instructions.
- Add a checksum-verifying install helper only if it can be implemented without claiming signed/notarized distribution.
- Verify brand assets and package metadata docs match the current macOS package.

Do not:
- Commit signing certificates, tokens, passwords, OAuth credentials, or notarization secrets.
- Claim public distribution readiness while artifacts are unsigned.
- Enable updater behavior before update checks and release metadata are implemented and tested.
- Add Linux/Windows release claims.

Acceptance checks:
- Run `pnpm typecheck`.
- Run `pnpm test`.
- Run `pnpm test:smoke` if CI/smoke config changed.
- Run `pnpm pack:mac:preview` if release packaging docs/config changed.
- Update the RC checklist with commands run, pass/fail status, and remaining owned blockers.
```

## Future Platform Prompts

Run these only after Mac v1 is stable. Do not run Linux and Windows port work in parallel for the first pass. Linux is the first non-Mac port; Windows follows after the Linux adapter lessons are incorporated.

### P8A Cross-Platform Adapter Audit

Run alone after Mac v1.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: audit and prepare the shared platform adapter layer before Linux and Windows port work begins.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/ports/cross-platform-porting.md
- docs/ports/linux-port.md
- docs/ports/windows-port.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/03-database-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Implement:
- Identify current Mac-only assumptions in platform paths, credentials, tray, menu, shortcuts, notifications, custom protocol, autostart, updater, diagnostics, OAuth, MCP, packaging, and tests.
- Create or refine shared adapter interfaces for the platform capabilities listed in docs/ports/cross-platform-porting.md.
- Add capability-report DTOs exposed through preload/settings where appropriate.
- Add adapter contract tests that can run without Linux or Windows.
- Use docs/improvements/ to classify parity items as platform implementation, shared backend/database work, tests, release docs, manual QA, or backlog.
- Update docs if the adapter contract changes.

Do not:
- Break macOS behavior.
- Implement Linux or Windows packaging in this prompt.
- Claim non-Mac platform support.
- Put platform-specific logic directly into renderer components.

Acceptance checks:
- Run shared tests.
- Run typecheck/build.
- Summarize Mac-only assumptions found, adapter contracts added, and blockers for Linux.
```

### P8B Linux Port Foundation

Run alone after P8A.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement the Linux platform foundation without claiming broad Linux release readiness.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/ports/cross-platform-porting.md
- docs/ports/linux-port.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Implement:
- Linux adapter implementations or stubs for app paths, credentials, tray/status area, global shortcuts, notifications, custom protocol, autostart, updater metadata, external open behavior, and diagnostics.
- Capability detection for Secret Service/libsecret availability, tray support, X11 vs Wayland, portal global shortcut availability where feasible, notification support, and protocol registration status.
- Linux settings/diagnostics surfaces that show capability status and caveats.
- Linux-specific automated tests that can run on non-Linux via adapter mocks, plus Linux-only tests where appropriate.
- Use the improvement docs to keep feature parity Electron-native and to separate platform blockers from shared backend blockers.
- Documentation updates for any implementation choices that differ from docs/ports/linux-port.md.

Do not:
- Break macOS behavior.
- Claim universal Linux parity.
- Enable plaintext credential fallback.
- Enable in-place auto-update before package behavior is verified.

Acceptance checks:
- Run shared tests.
- Run typecheck/build.
- Run Linux adapter tests.
- Summarize Linux capabilities, unsupported features, manual checks required, and remaining packaging blockers.
```

### P8C Linux Packaging And Desktop QA

Run alone after P8B. Run on Linux if possible; otherwise produce config/docs and mark runtime checks as blocked.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: create and verify the Linux technical preview packaging path, starting with AppImage.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/ports/linux-port.md
- docs/ports/cross-platform-porting.md
- docs/release/distribution.md
- docs/performance/build-and-test-performance.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Implement:
- electron-builder Linux config for AppImage first.
- Desktop file metadata, icon configuration, categories, keywords, and StartupWMClass where needed.
- Custom protocol registration configuration if supported by the chosen package target.
- Linux install/run/uninstall notes in release docs.
- Linux manual QA checklist document under docs/release or docs/ports if it does not already exist.
- Linux performance smoke instructions for AppImage and installed package paths.
- Reference the improvement docs when adding release, updater, native lifecycle, test, or manual QA instructions.
- Optional DEB/RPM docs only if AppImage baseline is already clear.

Do not:
- Claim automatic Linux updates unless package/update behavior is implemented and tested.
- Claim GNOME/KDE/Wayland/X11 parity without manual evidence.
- Store signing or release secrets in the repo.

Acceptance checks:
- Run typecheck/build.
- Run Linux package command if on a suitable Linux environment.
- Run Playwright launch smoke on Linux if possible.
- Run performance smoke report on Linux if possible.
- Record pass/fail/manual-blocked status for tray, global shortcut, notifications, OAuth, MCP, protocol links, desktop integration, and AppImage launch.
```

### P9A Windows Port Foundation

Run alone after the Linux technical preview work has landed.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement the Windows platform foundation without claiming broad Windows release readiness.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/ports/cross-platform-porting.md
- docs/ports/windows-port.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Implement:
- Windows adapter implementations or stubs for app paths, credential storage, tray, global shortcuts, notifications, custom protocol, autostart, updater metadata, external open behavior, and diagnostics.
- Stable AppUserModelID/app identity wiring early in startup.
- Windows settings/diagnostics surfaces that show tray, shortcut, notifications, protocol, updater, signing, and SmartScreen status where known.
- Windows-specific automated tests that can run on non-Windows via adapter mocks, plus Windows-only tests where appropriate.
- Use the improvement docs to keep feature parity Electron-native and to separate platform blockers from shared backend blockers.
- Documentation updates for any implementation choices that differ from docs/ports/windows-port.md.

Do not:
- Break macOS or Linux behavior.
- Claim Windows release readiness until installer, notification, protocol, OAuth, MCP, and performance checks run on Windows.
- Enable automatic updates before installer identity, signing, and release metadata are tested.
- Store certificates or signing secrets in the repo.

Acceptance checks:
- Run shared tests.
- Run typecheck/build.
- Run Windows adapter tests.
- Summarize Windows capabilities, unsupported features, manual checks required, signing blockers, and packaging blockers.
```

### P9B Windows Packaging And Signing QA

Run alone after P9A. Run on Windows if possible; otherwise produce config/docs and mark runtime checks as blocked.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: create and verify the Windows technical preview packaging path, starting with NSIS, and document signing/SmartScreen expectations.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/ports/windows-port.md
- docs/ports/cross-platform-porting.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/build-and-test-performance.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Implement:
- electron-builder Windows config for NSIS first.
- AppUserModelID, executable name, installer display name, Start Menu shortcut, protocol registration, and icon metadata.
- Windows install/run/uninstall notes in release docs.
- Signing plan documentation covering unsigned internal preview, Microsoft Store MSIX option, Azure Artifact Signing/Trusted Signing, OV certificate, and self-signed dev-only behavior.
- Windows manual QA checklist document under docs/release or docs/ports if it does not already exist.
- Windows performance smoke instructions for installed NSIS builds.
- Reference the improvement docs when adding release, updater, native lifecycle, test, or manual QA instructions.

Do not:
- Commit certificates, passwords, tokens, or signing secrets.
- Claim public Windows distribution readiness without a signing plan.
- Claim SmartScreen will not warn unless the chosen distribution path proves that.
- Enable in-place auto-update before signed installer/update metadata are verified.

Acceptance checks:
- Run typecheck/build.
- Run Windows package command if on a suitable Windows environment.
- Run Playwright launch smoke on Windows if possible.
- Run performance smoke report on Windows if possible.
- Record pass/fail/manual-blocked status for installer, Start Menu launch, taskbar grouping, tray, global shortcut, notifications, OAuth, MCP, protocol links, uninstall, and SmartScreen/signing expectations.
```

### P10 Cross-Platform Release Hardening

Run alone after Linux and Windows technical preview work has landed.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: harden the cross-platform release story after macOS, Linux, and Windows preview paths exist.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/ports/cross-platform-porting.md
- docs/ports/linux-port.md
- docs/ports/windows-port.md
- docs/specs/platforms.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Tasks:
- Audit platform adapters for duplicated logic, drift, unsafe fallbacks, and renderer platform branching.
- Verify all platform capability reports are exposed consistently in Settings and Diagnostics.
- Verify install/update/uninstall docs match actual package behavior.
- Verify performance smoke reports exist or are explicitly blocked per platform.
- Verify manual QA checklists exist for macOS, Linux, and Windows.
- Use the improvement docs to classify unresolved parity work as shared backend, tests, release polish, platform caveat, or explicit backlog.
- Update roadmap/docs to distinguish supported, technical preview, and unsupported features by platform.

Do not:
- Add new platform scope.
- Claim parity where platform caveats remain unresolved.
- Weaken security, credential storage, or MCP local-only guarantees to simplify a port.

Acceptance checks:
- Run full available test suite.
- Run typecheck/build.
- Run packaging checks available on the current host.
- Produce or update a cross-platform release readiness report with blockers per platform.
```
