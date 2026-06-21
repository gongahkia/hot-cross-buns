# Release Candidate Checklist - Mac v1

Date: 2026-05-23
Result: Not release-ready.

## Summary

Automated unit, typecheck, production build, Electron smoke, performance smoke, macOS packaging, checksum verification, and DMG mount smoke completed on 2026-05-23. The Mac runtime now has BYO Google Desktop OAuth setup, macOS Keychain-backed Google/MCP secret storage, authenticated Google transport construction, deferred sync scheduling, live MCP listener lifecycle wiring, and stable DMG/zip preview aliases. The RC is still not public-release ready because live Google account QA, external MCP client QA, signed/notarized distribution, and clean-machine native-shell verification remain manual blockers.

## Command Results

| Command | Status | Evidence |
|---|---|---|
| `pnpm test` | PASS | 2026-05-23 final rerun: 30 Vitest files, 153 tests passed in 5.72s. |
| `pnpm typecheck` | PASS | 2026-05-23: `tsc --noEmit` completed. |
| `pnpm build` | PASS | 2026-05-23 final release build: main 544.78 kB, preload 160.81 kB, renderer JS 476.99 kB, sidebar icon asset 4.55 kB. |
| `pnpm test:smoke` | PASS | 2026-05-23: 1 Playwright Electron smoke passed in 14.2s. |
| `pnpm exec vitest run --config vitest.config.ts src/main/native/service.test.ts src/main/services/sqliteDomainServices.test.ts src/renderer/src/App.test.tsx` | PASS | 3 files, 37 tests passed; includes adaptive menu-bar snapshot coverage. |
| `pnpm exec vitest run --config vitest.config.ts src/main/sync/mutationWorker.test.ts src/main/services/serviceContainer.test.ts src/main/services/sqliteDomainServices.test.ts src/main/sync/readSyncService.test.ts src/main/google/calendarClient.test.ts src/main/google/tasksClient.test.ts src/main/native/adapterContract.test.ts src/main/native/service.test.ts` | PASS | 8 files, 39 tests passed; covers mutation status transitions, retry backoff, auth pause diagnostics, renderer/preload exclusion, service-container `sync.runNow` draining, SQLite domain queue behavior, read-sync retry behavior, Google transport mapping, and native/noop adapter contracts. |
| `pnpm test:perf` | PASS | 2026-05-23 final report-only perf smoke wrote `artifacts/perf/latest.json` and `.md` after rebuilding local `better-sqlite3` for Electron ABI 130. |
| `pnpm exec vitest run src/main/google/oauth.test.ts src/main/google/oauthLoopback.test.ts src/main/google/runtimeConfig.test.ts src/main/mcp/keychainCredentials.test.ts src/shared/ipc/contracts.test.ts src/main/services/serviceContainer.test.ts --config vitest.config.ts` | PASS | 2026-05-23: 6 files, 17 tests passed; covers OAuth loopback completion, client-secret Keychain separation, MCP token rotation, Google IPC schema redaction, and service-container sync worker behavior. |
| `pnpm release:review-bundle` | PASS | 2026-05-23: no external main/preload requires; built output main 532 KiB, preload 157 KiB, renderer 493.4 KiB. |
| `pnpm release:mac:preview` | PASS | Tests, release build, bundle review, unsigned DMG/zip, and checksums completed. |
| `pnpm pack:mac:preview` | PASS | 2026-05-23: rebuilt unsigned preview package, stable aliases, and checksums with the OAuth/Keychain/MCP/performance changes. |
| `cd release && shasum -a 256 -c SHASUMS256.txt` | PASS | 2026-05-23: all 6 versioned/stable DMG and zip checksums verified. |
| `pnpm release:smoke-dmg` | PASS | 2026-05-23: mounted `release/Hot-Cross-Buns-macOS.dmg` and verified app bundle, executable, Info.plist, and bundle id. |
| `scripts/install-mac-preview.sh release/Hot-Cross-Buns-0.0.0-mac-arm64.zip release/SHASUMS256.txt /tmp/hcb-install-helper-smoke` | PASS | Verified SHA-256 and copied the unsigned preview `.app` into a temporary destination without bypassing Gatekeeper. Temporary destination was removed after verification. |
| `bash -n scripts/install-mac-preview.sh`, helper `--help`, and YAML parse for `.github/workflows/ci.yml` | PASS | Install helper shell syntax/help and CI workflow YAML parsed locally. |
| `file assets/brand/... build/icon.icns`, `plutil -p .../Info.plist`, packaged brand asset listing, `codesign -dv --verbose=4 ...` | PASS | App icon 1024 px source, sidebar 64 px, menu-bar 18/36 px, `icon.icns`, packaged brand resources, bundle id `dev.hotcrossbuns.hotcrossbuns`, version `0.0.0`, `hotcrossbuns` protocol, productivity category, and ad-hoc signature verified. |
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
| `release/Hot-Cross-Buns-0.0.0-mac-arm64.dmg` | 101 MiB | `1212fcb8a5372f2f61f531014cc917cde7f134a473c451c63c85ae164c78251c` |
| `release/Hot-Cross-Buns-0.0.0-mac-arm64.zip` | 97 MiB | `c46f0514079ed30b12b4c539d897e1fd01314455882f1047c4d4f746adce8108` |
| `release/Hot-Cross-Buns-macOS.dmg` | 101 MiB | `1212fcb8a5372f2f61f531014cc917cde7f134a473c451c63c85ae164c78251c` |
| `release/Hot-Cross-Buns-macOS.zip` | 97 MiB | `c46f0514079ed30b12b4c539d897e1fd01314455882f1047c4d4f746adce8108` |

Packaging caveats: `electron-builder` skipped signing because `mac.identity: null`, warned that arm64 requires signing, and generated blockmap/latest metadata that must not be uploaded for the unsigned preview flow. The macOS package uses `build/icon.icns` generated from the round bun app icon on a white rounded background, and package metadata now includes author `gongahkia`.

## Performance Smoke

Mode: report-only. Fixture data was generated locally and used a temporary app data path.

| Flow | Target | Cold | Warm | Status |
|---|---:|---:|---:|---|
| Shell visible | cold <1500ms, warm <700ms | 435ms | 256ms | PASS |
| Cached data rendered | <300ms after database open | 486ms total / 375ms after DB | 339ms total / 289ms after DB | WATCH |
| Command palette open | <100ms | 17.79ms | 19.42ms | PASS |
| Quick capture open | <150ms | 49.61ms | 48.5ms | PASS |
| Local search service | <100ms | 14.9ms | 3.5ms | PASS |
| Search UI update | <100ms user-perceived | 38.97ms | 34.07ms | PASS |
| Task scrolling | 16ms target, 32ms sustained max | 25.6ms | 14.11ms | PASS |
| Calendar month navigation | reviewed against frame budget | 37.6ms | 40.59ms | WATCH |
| Task completion optimistic feedback | <100ms | 69.86ms | 53.16ms | PASS |

SQLite query plans were indexed for task, event, note, search, checkpoint, and pending-mutation paths. The final perf run rebuilt the local `better-sqlite3` module for Electron ABI 130 before launch, so app IPC routes used native SQLite (`settings.get` ~0.1ms, task list reads ~1ms, calendar range reads ~2-3ms, local search ~3ms). Node-side direct SQLite measurements in that same run used the Python compatibility fallback because Node ABI 141 could no longer load the Electron binary; those direct measurements are not the app runtime budget.

SQLite adapter follow-up on 2026-05-22: the direct medium-fixture data path moved from the Python bridge to the native adapter and improved materially (`fixtures.seed-medium-sqlite` 2768.22ms -> 81.65ms, `sqlite.task-lists.medium` 275.86ms -> 0.9ms, `search.medium-local` 277.82ms -> 3.58ms). The adapter now lazy-loads `better-sqlite3`, so ABI mismatches are contained by the compatibility layer instead of crashing module import.

Search DSL follow-up on 2026-05-23: the local structured parser/filter slice remains local-only, the renderer debounce was tightened for interactive search, and the Electron Search UI measurement now meets the <100ms user-perceived budget.

## PRD Success Criteria

| Criterion | RC status | Owner |
|---|---|---|
| User can connect Google through desktop OAuth. | IMPLEMENTED for macOS preview code path: Settings accepts BYO Desktop client ID/optional secret, opens PKCE loopback OAuth, stores tokens in Keychain, and returns sanitized status. Live account QA remains required. | Google Sync / Settings |
| User can view selected task lists and calendars from local cache after sync. | PARTIAL: authenticated transport construction and scheduler are wired; live account sync QA and resource-selection polish remain. | Google Sync / Local Data |
| User can create, edit, complete/reopen, move, and delete tasks. | WIRED: local optimistic SQLite flows, authenticated Google write transports, and mutation worker reconciliation are enabled by default; live account QA still required before release signoff. | Core UI / Sync |
| User can create, edit, and delete calendar events. | WIRED: local optimistic SQLite flows, authenticated Google write transports, and mutation worker reconciliation are enabled by default; live account QA still required before release signoff. | Core UI / Sync |
| User can create and search task-backed notes. | IMPLEMENTED. | Core UI / Local Data |
| User can open command palette and quick capture without leaving the keyboard. | IMPLEMENTED for in-app keyboard path; global hotkey path still needs manual verification. | Renderer / Native Shell |
| Tray/menu bar and global hotkey flows work on macOS. | BLOCKED pending installed-app manual verification; code paths exist. | Native Shell |
| Local MCP read tools work behind bearer-token authentication. | IMPLEMENTED in code: live listener starts after the shell is interactive when enabled, binds loopback only, and uses Keychain-backed bearer token storage. External MCP client QA remains required. | MCP / Native Shell |
| MCP write tools support dry-run and confirmation. | IMPLEMENTED in code through the live server and existing tool registry; external MCP client QA remains required. | MCP |
| Tests cover domain logic, SQLite migrations, IPC contracts, Google transport mocks, MCP contracts, and launch smoke flows. | IMPLEMENTED for current covered surfaces. | QA |

## Blockers

| Owner | Blocker | Required resolution |
|---|---|---|
| Google Sync / Settings | Runtime OAuth/Keychain/transport wiring is implemented but not live-account verified. | User-owned live Google QA: connect BYO Desktop client, run manual/balanced sync, create/update/delete tasks/events, verify auth-pause behavior. |
| Sync / Data | Conflict recovery UX and account identity display remain basic. | Add user-facing conflict recovery and improve connected-account display after live OAuth scope behavior is confirmed. |
| MCP / Native Shell | Live MCP listener is wired but not external-client verified. | User-owned MCP QA: enable server, retrieve/configure token through support path, verify read/write tools and confirmation behavior from a real MCP client. |
| Performance / Main / Renderer | Shell startup, task feedback, and Search UI now pass local report-only smoke when the local native module is rebuilt for Electron ABI; cold cached-render-after-DB is still slightly above the soft target. | Keep cold cached render and calendar month navigation on watch, and preserve the Electron-ABI perf step so Python fallback regressions are visible. |
| Data Runtime / Packaging | Native SQLite is primary and package config unpacks `better_sqlite3.node`; clean packaged native-adapter verification remains required. | Run packaged preview smoke on a clean profile and verify no Python compatibility fallback is used. |
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
