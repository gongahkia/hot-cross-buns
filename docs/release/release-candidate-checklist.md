# Release Candidate Checklist - Mac v1

Date: 2026-05-22
Result: Not release-ready.

## Summary

Automated unit, typecheck, production build, Electron smoke, performance smoke, bundle review, macOS packaging, and checksum verification all completed. Release/support polish was added on 2026-05-23: GitHub Actions CI, contributor setup docs, unsigned preview support guidance, checksum-verifying install helper, privacy/support summary, and package metadata documentation. The RC is blocked by product and integration gaps rather than failing tests: Google OAuth/Keychain wiring, authenticated Google transport/scheduler wiring, live MCP server lifecycle, performance budget misses, signing/notarization, and native manual verification. A main-process pending-mutation worker now exists, but production OAuth-backed write transports are not wired into the app container yet.

## Command Results

| Command | Status | Evidence |
|---|---|---|
| `pnpm test` | PASS | 2026-05-23 rerun: 27 Vitest files, 149 tests passed in 6.85s. First run failed because the renderer boundary test did not yet allow the pure shared Search DSL parser; the allowlist was narrowed to `@shared/search` and the full suite then passed. |
| `pnpm typecheck` | PASS | 2026-05-23: `tsc --noEmit` completed. |
| `pnpm build` | PASS | 2026-05-23 smoke build: main 465.74 kB, preload 157.88 kB, renderer JS 470.62 kB, sidebar icon asset 4.55 kB. |
| `pnpm test:smoke` | PASS | 2026-05-23: 1 Playwright Electron smoke passed in 13.4s. |
| `pnpm exec vitest run --config vitest.config.ts src/main/native/service.test.ts src/main/services/sqliteDomainServices.test.ts src/renderer/src/App.test.tsx` | PASS | 3 files, 37 tests passed; includes adaptive menu-bar snapshot coverage. |
| `pnpm exec vitest run --config vitest.config.ts src/main/sync/mutationWorker.test.ts src/main/services/serviceContainer.test.ts src/main/services/sqliteDomainServices.test.ts src/main/sync/readSyncService.test.ts src/main/google/calendarClient.test.ts src/main/google/tasksClient.test.ts src/main/native/adapterContract.test.ts src/main/native/service.test.ts` | PASS | 8 files, 39 tests passed; covers mutation status transitions, retry backoff, auth pause diagnostics, renderer/preload exclusion, service-container `sync.runNow` draining, SQLite domain queue behavior, read-sync retry behavior, Google transport mapping, and native/noop adapter contracts. |
| `pnpm test:perf` | PASS | Report-only perf smoke wrote `artifacts/perf/latest.json` and `.md`. |
| `pnpm release:review-bundle` | PASS | No issues; no external main/preload requires; renderer 441.3 KiB. |
| `pnpm release:mac:preview` | PASS | Tests, release build, bundle review, unsigned DMG/zip, and checksums completed. |
| `pnpm pack:mac:preview` | PASS | 2026-05-23: rebuilt unsigned preview package after package author metadata, CI/docs, and install-helper changes; regenerated checksums. |
| `shasum -a 256 -c SHASUMS256.txt` | PASS | 2026-05-23: DMG and zip checksums verified. |
| `scripts/install-mac-preview.sh release/Hot-Cross-Buns-2-0.0.0-mac-arm64.zip release/SHASUMS256.txt /tmp/hcb2-install-helper-smoke` | PASS | Verified SHA-256 and copied the unsigned preview `.app` into a temporary destination without bypassing Gatekeeper. Temporary destination was removed after verification. |
| `bash -n scripts/install-mac-preview.sh`, helper `--help`, and YAML parse for `.github/workflows/ci.yml` | PASS | Install helper shell syntax/help and CI workflow YAML parsed locally. |
| `file assets/brand/... build/icon.icns`, `plutil -p .../Info.plist`, packaged brand asset listing, `codesign -dv --verbose=4 ...` | PASS | App icon 1024 px source, sidebar 64 px, menu-bar 18/36 px, `icon.icns`, packaged brand resources, bundle id `dev.hotcrossbuns.hotcrossbuns2`, version `0.0.0`, `hotcrossbuns` protocol, productivity category, and ad-hoc signature verified. |
| `git diff --check` | PASS | No whitespace errors. |
| `rg` secret-pattern scans over source and diff | PASS | Only fake test fixtures and documentation references found. |
| `git ls-files \| rg` and `git diff \| rg` Swift/Xcode scans | PASS | No Swift source, Xcode project, or runtime dependency found. |
| `rg` renderer/preload privileged-import scans | PASS | Only test-only boundary checks import Node modules; bundle review found no issues. |
| `git status`, `git diff --stat`, and focused `git diff` inspections | PASS | New changes are scoped to menu-bar/app-icon behavior, tests, and related docs; unrelated `prompts-to-run-23-may.md` was left untouched. |
| `plutil -p release/mac-arm64/Hot\ Cross\ Buns\ 2.app/Contents/Info.plist` | PASS | Bundle id, version, `CFBundleIconFile => icon.icns`, and `hotcrossbuns` protocol entry inspected. |
| `codesign -dv --verbose=4 ...` | PASS | Signature metadata inspected; app is ad-hoc/linker-signed with no TeamIdentifier. |
| `.gitignore` audit for report visibility | PASS | Root release artifact ignore is anchored as `/release/` so `docs/release/` reports are trackable. |
| `codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hot\ Cross\ Buns\ 2.app` | FAIL EXPECTED | Unsigned preview/ad-hoc app is not notarization-ready. |
| `spctl --assess --type execute --verbose=4 release/mac-arm64/Hot\ Cross\ Buns\ 2.app` | FAIL EXPECTED | Gatekeeper rejects the unsigned preview app. |

Packaging artifacts:

| Artifact | Size | Checksum |
|---|---:|---|
| `release/Hot-Cross-Buns-2-0.0.0-mac-arm64.dmg` | 112 MiB | `c506b695e2d54c29a0e7c7c5cd17c98fcb5bbdf5e9dfb1e1c4aa89e868a617cc` |
| `release/Hot-Cross-Buns-2-0.0.0-mac-arm64.zip` | 113 MiB | `1882c8c4a5a1898ef1968b9ae2106958933d75a113546fdd7970efd7e5707e3c` |

Packaging caveats: `electron-builder` skipped signing because `mac.identity: null`, warned that arm64 requires signing, and generated blockmap/latest metadata that must not be uploaded for the unsigned preview flow. The macOS package uses `build/icon.icns` generated from the round bun app icon on a white rounded background, and package metadata now includes author `gongahkia`.

## Performance Smoke

Mode: report-only. Fixture data was generated locally and used a temporary app data path.

| Flow | Target | Cold | Warm | Status |
|---|---:|---:|---:|---|
| Shell visible | cold <1500ms, warm <700ms | 2952ms | 2901ms | BLOCKED |
| Cached data rendered | <300ms after database open | 4469ms total | 4481ms total | BLOCKED |
| Command palette open | <100ms | 16.2ms | 10.52ms | PASS |
| Quick capture open | <150ms | 38.03ms | 40.34ms | PASS |
| Local search service | <100ms | 77.8ms | 76ms | PASS |
| Search UI update | <100ms user-perceived | 270.68ms | 263.84ms | BLOCKED |
| Task scrolling | 16ms target, 32ms sustained max | 14.9ms | 13.87ms | PASS |
| Calendar month navigation | reviewed against frame budget | 37.63ms | 35.15ms | WATCH |
| Task completion optimistic feedback | <100ms | 239.17ms | 251.62ms | BLOCKED |

SQLite query plans were indexed for task, event, note, search, checkpoint, and pending-mutation paths. Slow IPC outliers in the perf report: `diagnostics.summary` around 757ms and `settings.get` around 376ms.

SQLite adapter follow-up on 2026-05-22: the direct medium-fixture data path moved from the Python bridge to the native adapter and improved materially (`fixtures.seed-medium-sqlite` 2768.22ms -> 81.65ms, `sqlite.task-lists.medium` 275.86ms -> 0.9ms, `search.medium-local` 277.82ms -> 3.58ms). The latest unpackaged Electron startup measurements were cold shell visible 6270ms, cold cached render 10733ms, warm shell visible 6799ms, and warm cached render 13293ms because Electron used the Python compatibility fallback for the local native ABI mismatch. Package-level native adapter verification remains required.

Search DSL follow-up on 2026-05-23: the local structured parser/filter slice keeps direct medium-fixture `search.medium-local` within budget at 13.94ms, but the warm Electron Search UI update was 467.51ms and remains BLOCKED against the <100ms user-perceived target. The cold app-shell perf capture timed out in the same run. The perf harness now seeds setup completion in its temporary profile so onboarding does not block planner measurements, and it tolerates slower first-window capture for local report-only runs.

## PRD Success Criteria

| Criterion | RC status | Owner |
|---|---|---|
| User can connect Google through desktop OAuth. | BLOCKED: OAuth service classes exist, but production IPC/UI/client config and Keychain-backed token storage are not wired. | Google Sync / Settings |
| User can view selected task lists and calendars from local cache after sync. | PARTIAL: local SQLite cache renders in tests; selected resource setup and real account sync wiring are not complete. | Google Sync / Local Data |
| User can create, edit, complete/reopen, move, and delete tasks. | PARTIAL: local optimistic SQLite flows work; the main-process mutation worker can replay queued task/task-list writes when authenticated write transports are supplied, but production OAuth transport wiring is incomplete. | Core UI / Sync |
| User can create, edit, and delete calendar events. | PARTIAL: local optimistic SQLite flows work; the main-process mutation worker can replay queued event writes when authenticated write transports are supplied, but production OAuth transport wiring is incomplete. | Core UI / Sync |
| User can create and search local notes. | IMPLEMENTED. | Core UI / Local Data |
| User can open command palette and quick capture without leaving the keyboard. | IMPLEMENTED for in-app keyboard path; global hotkey path still needs manual verification. | Renderer / Native Shell |
| Tray/menu bar and global hotkey flows work on macOS. | BLOCKED pending installed-app manual verification; code paths exist. | Native Shell |
| Local MCP read tools work behind bearer-token authentication. | BLOCKED: MCP server contracts pass, but live listener and Keychain-backed token lifecycle are not wired into app startup. | MCP / Native Shell |
| MCP write tools support dry-run and confirmation. | BLOCKED for release use because the live server is not wired; contract tests cover the tool behavior. | MCP |
| Tests cover domain logic, SQLite migrations, IPC contracts, Google transport mocks, MCP contracts, and launch smoke flows. | IMPLEMENTED for current covered surfaces. | QA |

## Blockers

| Owner | Blocker | Required resolution |
|---|---|---|
| Google Sync / Settings | No user-facing desktop OAuth flow or Keychain-backed Google credential adapter is wired into production IPC/UI. | Add OAuth IPC/UI, bring-your-own-client configuration, OS credential storage, and sanitized status persistence. |
| Sync / Data | Authenticated Google transport construction, account selection, and real sync scheduling remain deferred; the mutation worker is implemented and tested but production app startup still uses noop Google transports unless explicit transports are injected. | Wire OAuth/Keychain-backed transport factories, account selection, scheduler triggers, conflict recovery UX, and manual diagnostics actions. |
| MCP / Native Shell | MCP status/settings are stateful, but no live local listener starts from app settings, and MCP bearer token storage is not Keychain-backed. | Start/stop `LocalMcpServer` safely after app interactive, persist bearer token in OS credentials, and expose usable connection details. |
| Performance / Main / Renderer | Startup shell-visible, cached render, search UI, and task-complete feedback miss `docs/performance/performance-strategy.md` budgets. | Profile startup staging and renderer/data IPC paths; record accepted baseline or fix before RC sign-off. |
| Data Runtime / Packaging | The primary SQLite path now uses `better-sqlite3`, but the latest unpackaged Electron perf run used the Python compatibility fallback because local `better-sqlite3` was built for host Node ABI 141 while Electron expected ABI 130. | Run packaged preview smoke after `electron-builder` native rebuild/unpack and verify Electron uses the native SQLite adapter instead of fallback. |
| Native Shell / Release QA | Tray/menu bar, global hotkey, notifications, and `hotcrossbuns://` protocol behavior were not manually verified on the packaged app. | Run `docs/testing/manual-macos-native-shell.md` against the packaged app and record results. |
| Release Packaging | Unsigned preview artifacts build and package author metadata is present, but the app remains ad-hoc signed, unsigned for distribution, and not notarization-ready. | Add Developer ID signing, hardened runtime, notarization, and clean-machine Gatekeeper verification before broad distribution. |

## Diff Audit

Git diff audit covered the current tracked changes and the packaging/bundle-review changes observed at the start of QA:

- No accidental secret exposure found in the diff.
- No old Swift/Xcode runtime dependency found.
- No renderer privilege leak found; renderer source remains covered by static boundary tests and bundle review.
- No unrelated churn identified.

Docs updated during this QA pass:

- `.github/workflows/ci.yml`: added install/typecheck/unit-test CI, macOS Electron smoke, scheduled/manual performance smoke, concurrency cancellation, pinned pnpm, and failure artifact uploads.
- `.gitignore`: anchored generated release artifacts as `/release/` so `docs/release/` reports are not ignored.
- `package.json`: added author metadata used by the macOS package.
- `README.md`, `docs/README.md`, `docs/CONTRIBUTING.md`, and `docs/agents/workflow.md`: documented contributor setup, pinned pnpm, daily commands, release commands, CI expectations, and release-polish workflow entry points.
- `scripts/install-mac-preview.sh`: added checksum-verifying unsigned preview install helper.
- `docs/support/mac-preview-support.md`: added unsigned install, Gatekeeper, privacy, diagnostics/support, and rollback guidance.
- `docs/security/privacy-and-threat-model.md`: added a short preview support privacy summary.
- `docs/performance/build-and-test-performance.md` and `docs/testing/qa-plan.md`: documented current CI smoke/performance artifact behavior.
- `docs/improvements/05-general-parity-and-release-polish.md`: recorded implemented CI, install helper, contributor, support, and release metadata polish.
- `src/renderer/src/renderer-boundary.test.ts`: allowed the pure `@shared/search` parser namespace while keeping renderer privileged-import assertions intact.
- `assets/brand/` and `build/icon.icns`: copied legacy logo/icon assets and generated the macOS package icon from the round bun mark on a white rounded background.
- `electron-builder.yml`: wired the macOS package icon and copied brand assets into packaged resources.
- `electron-builder.yml`: externalizes and rebuilds the packaged `better-sqlite3` native module, with `better_sqlite3.node` unpacked from ASAR.
- `electron.vite.config.ts` and `scripts/review-bundle.ts`: keep the native SQLite dependency external while allowing the documented main-process native require.
- `src/main/data/sqliteConnection.ts`: replaced the primary Python SQLite bridge with a `better-sqlite3` adapter, production pragmas, prepared statement caching, and a Python compatibility fallback for native ABI mismatch.
- `src/main/data/sqliteConnection.test.ts`: added pragma, reopen, migration, FTS, prepared-statement, rollback, and package-compatibility coverage.
- `src/main/index.ts`: applies the copied app icon to the Electron browser window.
- `src/main/native/electronMacAdapter.ts`: uses the copied menu bar icon/app icon assets and exposes left-click panel plus right-click utility menu behavior.
- `src/main/native/service.ts`: provides menu-bar agenda snapshots from cached tasks/events.
- `src/renderer/src/App.tsx`: uses the copied app icon in the sidebar header.
- `docs/design/design-system.md`: records the copied asset locations and usage.
- `docs/release/distribution.md`: clarified generated `app-update.yml` does not mean updater support.
- `docs/specs/native-parity.md`: documented current Keychain/MCP listener blockers.
- `docs/release/release-candidate-checklist.md`: added this RC report.
