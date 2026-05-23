## July 2026 Frontend Reference Prompts

Run these before the platform port prompts. Each visual prompt should be run with screenshots attached in the chat or placed under the suggested local folders:

- `artifacts/reference-screenshots/apple-calendar/`
- `artifacts/reference-screenshots/notion-calendar/`
- `artifacts/reference-screenshots/ticktick/`
- `artifacts/reference-screenshots/hcb-before/`

Use Apple Calendar, Notion Calendar, and TickTick as reference products only. Extract layout, density, navigation, interaction, and performance lessons. Do not copy protected branding, exact icons, exact copy, product names in UI, or proprietary artwork.

### P7A Calendar Reference Screenshot Intake

Run first, before editing renderer UI. Attach or point to Apple Calendar, Notion Calendar, TickTick, and current Hot Cross Buns 2 screenshots.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: turn Apple Calendar, Notion Calendar, TickTick, and current Hot Cross Buns 2 screenshots into a scoped frontend implementation plan.

Screenshot inputs:
- Apple Calendar: artifacts/reference-screenshots/apple-calendar/
- Notion Calendar: artifacts/reference-screenshots/notion-calendar/
- TickTick: artifacts/reference-screenshots/ticktick/
- Current Hot Cross Buns 2 before screenshots: artifacts/reference-screenshots/hcb-before/

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/design/design-system.md
- docs/specs/core-app.md
- docs/specs/google-sync.md
- docs/performance/renderer-performance.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md
- src/renderer/src/App.tsx
- src/renderer/src/features/core/CoreScreens.tsx
- src/renderer/src/styles/index.css
- src/renderer/src/components/primitives.tsx

Tasks:
- Inventory each screenshot by product, viewport, surface, and useful UI idea.
- Extract product-agnostic patterns only:
  - Apple Calendar: compact day/week/month density, time grid rhythm, event color treatment, navigation placement, all-day row behavior.
  - Notion Calendar: source visibility, sidebar/context organization, calm visual hierarchy, quick event editing, keyboard-friendly commands.
  - TickTick: task-calendar bridge, scheduled task blocks, due/priority affordances, completion flow, compact filters.
- Compare those patterns with the current Hot Cross Buns 2 renderer.
- Identify a small set of frontend edits that fit the existing React, Tailwind, design-token, typed preload, and local-cache architecture.
- Create or update docs/improvements/07-calendar-reference-frontend-plan.md with:
  - screenshot inventory
  - source-product lesson matrix
  - exact target files
  - implementation order
  - accessibility risks
  - performance risks
  - test and screenshot verification plan

Do not:
- Implement frontend code in this prompt unless the plan file already exists and is obviously stale.
- Copy exact branding, artwork, labels, icons, or layouts.
- Add network calls, privileged renderer access, or filesystem access from the renderer.
- Add a landing page or marketing-style shell.

Acceptance checks:
- The plan names the screenshots actually used.
- The plan separates visual polish, interaction behavior, data/backend needs, tests, and performance work.
- The plan lists blocked items clearly when screenshots are missing.
```

### P7B Apple Calendar Density And Calendar Grid Pass

Run after P7A. Use Apple Calendar screenshots as the primary reference for day, week, and month grid density.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: improve the Hot Cross Buns 2 calendar screen using Apple Calendar screenshots as a density, hierarchy, and time-grid reference while preserving the Hot Cross Buns design system.

Screenshot inputs:
- Apple Calendar: artifacts/reference-screenshots/apple-calendar/
- Current Hot Cross Buns 2 before screenshots: artifacts/reference-screenshots/hcb-before/

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/design/design-system.md
- docs/specs/core-app.md
- docs/performance/renderer-performance.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md
- docs/improvements/07-calendar-reference-frontend-plan.md
- src/renderer/src/features/core/CoreScreens.tsx
- src/renderer/src/features/core/coreViewModels.ts
- src/renderer/src/App.test.tsx

Implement:
- Refine agenda, day, week, and month calendar views for compact density and scanability.
- Improve time-grid rhythm, visible hour rows, all-day/timed event separation, event chip sizing, empty-slot affordances, and selected calendar visibility.
- Keep drag, resize, keyboard activation, event create/edit/delete, availability export, and visible-calendar filtering working.
- Use existing design tokens from docs/design/design-system.md and src/renderer/src/styles/index.css.
- Add or update focused renderer tests in src/renderer/src/App.test.tsx for any changed behavior.
- Capture before/after screenshots if a local browser or Electron smoke path is available.

Do not:
- Copy Apple branding, icons, labels, exact colors, or exact layout.
- Add new backend APIs unless a bug makes existing calendar behavior impossible.
- Put platform-specific logic in renderer components.
- Make the calendar heavier to render; avoid date expansion or sorting inside render.

Acceptance checks:
- Run pnpm typecheck.
- Run pnpm exec vitest run --config vitest.config.ts src/renderer/src/App.test.tsx.
- Run pnpm build.
- Summarize visual changes, preserved behaviors, screenshots reviewed, and any performance risk.
```

### P7C Notion Calendar Source And Context Pass

Run after P7A. Use Notion Calendar screenshots as the primary reference for source organization, contextual editing, and calm hierarchy.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: improve calendar source management, contextual event editing, and workspace hierarchy using Notion Calendar screenshots as product-agnostic reference material.

Screenshot inputs:
- Notion Calendar: artifacts/reference-screenshots/notion-calendar/
- Current Hot Cross Buns 2 before screenshots: artifacts/reference-screenshots/hcb-before/

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/design/design-system.md
- docs/specs/core-app.md
- docs/specs/google-sync.md
- docs/performance/renderer-performance.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md
- docs/improvements/07-calendar-reference-frontend-plan.md
- src/renderer/src/App.tsx
- src/renderer/src/features/core/CoreScreens.tsx
- src/renderer/src/components/Inspector/
- src/renderer/src/components/primitives.tsx

Implement:
- Make selected calendars, source visibility, sync/cache status, and event context easier to scan.
- Improve sidebar, toolbar, inspector, and event-form hierarchy without adding explanatory in-app text.
- Preserve keyboard-first navigation, command palette routes, and typed preload boundaries.
- Prefer icons from lucide-react for compact controls where familiar symbols exist.
- Add focused tests for source filtering, inspector/event-form behavior, and command palette routing if touched.

Do not:
- Copy Notion branding, exact visual design, exact copy, or account/product naming.
- Introduce nested cards or marketing-style panels.
- Hide sync, offline, conflict, or error states.
- Move privileged data or raw Google payloads into the renderer.

Acceptance checks:
- Run pnpm typecheck.
- Run pnpm exec vitest run --config vitest.config.ts src/renderer/src/App.test.tsx.
- Run pnpm build.
- Summarize source/context changes, screenshots reviewed, accessibility checks, and remaining gaps.
```

### P7D TickTick Task Calendar Scheduling Pass

Run after P7A. Use TickTick screenshots as the primary reference for task-calendar integration and completion-oriented workflows.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: improve task scheduling, scheduled task blocks, due/priority cues, and completion flow using TickTick screenshots as product-agnostic reference material.

Screenshot inputs:
- TickTick: artifacts/reference-screenshots/ticktick/
- Current Hot Cross Buns 2 before screenshots: artifacts/reference-screenshots/hcb-before/

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/design/design-system.md
- docs/specs/core-app.md
- docs/specs/local-data.md
- docs/performance/renderer-performance.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md
- docs/improvements/07-calendar-reference-frontend-plan.md
- src/renderer/src/features/core/CoreScreens.tsx
- src/renderer/src/features/core/coreViewModelSource.tsx
- src/renderer/src/features/core/coreViewModels.ts
- src/renderer/src/App.test.tsx

Implement:
- Improve the path from task list to scheduled calendar block and back.
- Make scheduled task blocks, overdue/due-today state, priority, completion, and orphaned scheduled blocks easier to recognize.
- Keep task completion optimistic and local-feeling while preserving existing mutation and preload behavior.
- Improve compact filters or chips only where they reduce friction for task-calendar workflows.
- Add focused renderer tests for scheduling, moving scheduled task blocks, orphan handling, and completion cues if behavior changes.

Do not:
- Copy TickTick branding, exact visual design, exact copy, or proprietary interaction wording.
- Add backend scope unless a missing API blocks a documented core workflow.
- Recompute large task/event groupings inside render.
- Remove visible loading, offline, error, conflict, or retry states.

Acceptance checks:
- Run pnpm typecheck.
- Run pnpm exec vitest run --config vitest.config.ts src/renderer/src/App.test.tsx.
- Run pnpm build.
- Summarize scheduling changes, screenshots reviewed, preserved data behavior, and follow-up backend needs.
```

### P7E Cross-Device Frontend Polish Pass

Run after P7B through P7D. Use all reference screenshots plus current app screenshots at multiple sizes.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: polish the Hot Cross Buns 2 frontend for different desktop and small-screen window sizes without changing platform support claims.

Screenshot inputs:
- Apple Calendar: artifacts/reference-screenshots/apple-calendar/
- Notion Calendar: artifacts/reference-screenshots/notion-calendar/
- TickTick: artifacts/reference-screenshots/ticktick/
- Current Hot Cross Buns 2 before screenshots: artifacts/reference-screenshots/hcb-before/

Target sizes:
- 1440 x 900 desktop
- 1280 x 800 laptop
- 1024 x 768 small desktop
- 768 x 1024 tablet-like narrow window
- 390 x 844 phone-like narrow window for stress testing only

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/design/design-system.md
- docs/performance/renderer-performance.md
- docs/testing/qa-plan.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md
- docs/improvements/07-calendar-reference-frontend-plan.md
- src/renderer/src/App.tsx
- src/renderer/src/features/core/CoreScreens.tsx
- src/renderer/src/styles/index.css

Implement:
- Fix responsive layout issues, text clipping, overlapping controls, unstable toolbar/sidebar dimensions, and inaccessible focus states.
- Keep the first viewport as the actual planner work surface.
- Make tabs, segmented controls, icon buttons, filters, panels, lists, and inspector surfaces stable across the target sizes.
- Add or update smoke/manual QA notes if screenshot verification reveals size-specific caveats.
- Add tests only where layout changes affect behavior or accessibility semantics.

Do not:
- Claim mobile support just because narrow windows render.
- Add a separate mobile app shell.
- Use viewport-width font scaling.
- Use nested cards, decorative blobs, or marketing hero sections.

Acceptance checks:
- Run pnpm typecheck.
- Run pnpm test.
- Run pnpm build.
- Capture screenshots at the target sizes if a local browser or Electron smoke path is available.
- Summarize size-specific fixes and any remaining blocked screenshot checks.
```

### P7F Renderer Performance Optimization Pass

Run after the frontend visual passes, or earlier if calendar navigation remains slow.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: optimize renderer performance, especially calendar month/week navigation and dense task/event rendering, without changing product behavior.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/performance/performance-strategy.md
- docs/performance/renderer-performance.md
- docs/performance/build-and-test-performance.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/03-database-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md
- scripts/perf-smoke.ts
- src/renderer/src/hooks/useRenderTiming.tsx
- src/renderer/src/components/VirtualizedList.tsx
- src/renderer/src/features/core/CoreScreens.tsx
- src/renderer/src/features/core/coreViewModelSource.tsx
- src/renderer/src/features/core/coreViewModels.ts

Implement:
- Run or inspect the latest pnpm test:perf report and identify renderer hot paths.
- Focus first on calendar month navigation, week/day grid rendering, agenda virtualization, task list rendering, search rendering, command palette open time, and expensive derived view-model work.
- Move expensive grouping, sorting, range materialization, and filtering out of render where possible.
- Use stable selectors, memoized derived models, or small focused component boundaries where measurements justify them.
- Keep virtualization for large lists and avoid adding DOM nodes for off-screen data.
- Add or refine renderer timing labels only behind existing profiling gates.
- Add or update focused tests for any behavior touched by performance changes.

Do not:
- Blanket-wrap every component in memo.
- Add new dependencies unless the repo already has a clear pattern for them.
- Move SQLite, filesystem, Google, or privileged work into renderer code.
- Commit generated artifacts/perf files unless release docs explicitly require a baseline.

Acceptance checks:
- Run pnpm typecheck.
- Run pnpm test.
- Run pnpm build.
- Run pnpm test:perf if the local Electron native module is available for the correct ABI; otherwise explain the blocker.
- Summarize before/after measurements, changed hot paths, and remaining watch items.
```

### P7G Startup, Bundle, And Frontend Payload Pass

Run after P7F if startup, cached render, or bundle size remains above target.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: reduce startup, cached render, and renderer bundle/payload cost without weakening security boundaries or product behavior.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/architecture/tech-stack.md
- docs/performance/performance-strategy.md
- docs/performance/renderer-performance.md
- docs/performance/main-and-data-performance.md
- docs/performance/build-and-test-performance.md
- docs/release/release-candidate-checklist.md
- scripts/perf-smoke.ts
- scripts/review-bundle.ts
- src/renderer/src/App.tsx
- src/renderer/src/features/core/CoreScreens.tsx
- src/preload/bridge.ts
- src/main/startupTiming.ts

Implement:
- Review latest startup timing, cached-render timing, and bundle review output.
- Split or lazy-load renderer code only where it clearly reduces initial work without making core planner flows feel delayed.
- Keep command palette, quick capture, sidebar, and current section cheap to mount.
- Avoid loading settings, diagnostics, search-heavy, or inspector-heavy surfaces before they are needed unless current architecture requires it.
- Trim accidental renderer imports, large constants, unused icons, or test-only data from production paths.
- Preserve preload security boundaries and typed IPC contracts.
- Update performance docs if thresholds, measurement notes, or accepted caveats change.

Do not:
- Hide slow work behind arbitrary timeouts.
- Remove diagnostics, security redaction, or offline/error states to improve numbers.
- Claim performance improvement without measurement evidence.
- Commit generated performance artifacts unless release docs explicitly require a baseline.

Acceptance checks:
- Run pnpm typecheck.
- Run pnpm test.
- Run pnpm build.
- Run pnpm release:review-bundle.
- Run pnpm test:perf if the local Electron native module is available for the correct ABI; otherwise explain the blocker.
- Summarize before/after startup, cached render, bundle, and remaining bottlenecks.
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
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md

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
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md

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
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md

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
