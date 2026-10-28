# Browser migration checkpoint

Branch: `migration/browser-indexeddb`. The original foundation is preserved in commit `cd369c3`; this completion pass continues from it. See [deployment](deployment.md), [Google setup](google-browser-setup.md), [backups/recovery](workspace-backups.md), and [performance evidence](performance/browser-workspace.md).

## Architecture and durability

Vite builds the existing React planner. `src/browser/bridge.ts` installs `window.hcb` and hydrates preferences before React renders, preserving validated result envelopes and the real rich bootstrap. The shared `CoreStore` retains its SQL/domain behavior behind a small synchronous database interface. Official `@sqlite.org/sqlite-wasm@3.54.1-build1` runs SQL, FTS5 and serialization inside a dedicated worker. Native SQLite remains development regression tooling; the browser build rejects native/Node/Electron runtime imports.

IndexedDB holds a complete SQLite snapshot and a small revision record in the **same strict transaction**. Successful mutations resolve only after transaction completion. SQL/domain, outbox, undo and persistence metadata commit together. Failure replaces the active connection and statement cache with the last durable snapshot. Initialization/migration failures preserve bytes; there is no destructive reset fallback. Recovery controls work even after failed initialization.

An exclusive Web Lock grants one request writer authority across tabs. Each worker queues requests, checks the small durable revision, and reloads stale state before SQL; the write transaction also performs compare-and-swap. The lock releases on request completion or worker/tab termination, allowing takeover. IndexedDB **version 2** closes version-1 connections and rejects old-version reopening, fencing earlier builds which did not maintain revision metadata. An upgrade blocked by an old tab reports an actionable error. No OPFS, localStorage, server DB or memory-only substitute holds the durable workspace.

Google uses a GIS Web OAuth token popup invoked with user activation, verified userinfo `sub`, account-scoped memory tokens and explicit reconnection. The portable original sync engine preserves paging, incremental tokens, recurrence, ETags, conflicts and outbox order. Async sync holds the same request lock; checkpoints complete before remote writes and after receipts. Interrupted Tasks creations are quarantined instead of duplicated; Calendar creation uses deterministic IDs; Drive uses durable Google-generated IDs and reconciles exact receipts. Retryable outbox writes stop after eight attempts. HTTP headers/body have a 30-second deadline; uploads honor acknowledged ranges and stop after three stalled responses. Failed checkpoint persistence pauses automatic sync until explicit retry.

Google tokens never enter SQL, exports, logs, URLs or app-shell caches. Partial grants enable only granted services. Imported queues remain conflicts until individually reviewed; accounts are disconnected on import. Full-workspace replacements use a separately validated connection, integrity/relationship checks, a ten-minute revision-bound review and explicit confirmation. WAL-mode files require a consistent self-contained backup rather than header-byte modification.

Production builds deliberately cache only app assets (including lazy chunks, worker and WASM). First load needs network. Later reloads and local edits work offline after the shell download succeeds. Updates wait for all existing tabs to close; failed installs retain the active cache and IndexedDB. Notifications and Google sync run only while the app is open, subject to browser suspension.

## Capability matrix

| Classification | Capabilities and disposition |
| --- | --- |
| Previously implemented, preserved in browser | Tasks/subtasks/lists, moves/completion, notes/note lists/autosave, events/recurrence/occurrence edits, scheduled task blocks, smart scheduling, FTS/internal references, tags CRUD, settings, history, undo/redo. Existing pagination, virtualization, bounded caches, calendar gestures, inspectors, drafts, keyboard navigation and reduced motion remain. Local Inbox/calendar/Notes onboarding needs no Google. |
| Previously implemented, migrated in this pass | Tasks/Calendar sync, free/busy, multi-account copies, Drive search/upload/attachment references, Gmail search/capture, conflict review. Deterministic transport and browser consent tests run; live authorization remains an external verification item. |
| Desktop behavior with browser equivalent | Clipboard API; synchronous popup/external links with blocked-popup errors; file picker and Blob downloads; sanitized diagnostics export; full workspace export/reviewed import; storage persistence/quota controls; tab-lifetime notifications. Native tray/Dock/login/global hotkeys/updater/folder controls are hidden or explicitly unsupported. |
| Pre-existing placeholders, still unsupported | Tag merge/bulk analytics/reapply; semantic model management; entity/broken-link APIs; agent actions/duplicates; customization/extensions/snippets; generic local attachment/vault/ICS/pointer APIs; fake imported-sound counter. These are not reported as implemented. Existing Drive reference workflows are distinct from generic attachment placeholders. |

External-tab refresh defers while editors or gestures are active. Regression fixes preserve task drafts, durable rapid navigation, legacy pane normalization and stable initial pane IDs. Pane preferences/layout/stars persist in IndexedDB; legacy localStorage fallback applies only to harnesses without the browser bridge.

## Independent review

Separate agents reviewed storage/import and remote side effects after implementation. Fixed: postcommit import bookkeeping on a closed connection; stale active-revision advancement after failed replacement; compensation continuing after failed sync checkpoint; mixed-version writers bypassing revision metadata; recovery requests hanging after a worker crash. Import validation now preserves intentional deleted-note tombstones after their list was removed while rejecting broken live-note relationships. Added regressions for recovery after failed initialization, stale failed import, legacy protocol fencing, writer termination before durable commit and retired desktop local resources. Checkpoint writes now skip unchanged state (notably Drive chunks) without weakening before/after remote boundaries.

## Validation evidence

Final validation completed 29 October 2026 (Asia/Singapore), Linux / Node 24.21 / Chromium 148. CI configuration targets Linux and macOS; remote CI and non-Chromium browser runs are not claimed.

- Clean `corepack pnpm install --frozen-lockfile` in a new temporary directory: **passed**, 32.4 s, Node 24.21 / pnpm 9.15.4.
- `corepack pnpm test:unit`: **440 passed, 1 existing macOS-only test skipped**, 72 passing files, 38.55 s. Includes 106 sync tests (17 browser adapters + 89 preserved sync unit/integration); these are not additional to the total.
- `corepack pnpm test:db`: **142 passed, 0 skipped**, 2.83 s. All 68 CoreStore, 66 Google integration and 8 schema-migration tests execute under Node; these also appear in the unit suite.
- `corepack pnpm test:ui`: **99 passed, 0 skipped**, 7.5 min, real static Chromium 148. Includes planner interactions, local onboarding, account isolation, storage/import failures, version fencing, interrupted-save takeover, focus/narrow/reduced-motion checks and mocked GIS consent with real worker synchronization. No live Google authorization is implied.
- Actual WASM compatibility: **13 checks**, covering FTS5/triggers, positional/named bindings, FK/JSON/CTE/window queries, savepoints/rollback, statement reuse/finalization, export/reopen, unchanged populated snapshots and domain FTS.
- `corepack pnpm build`: **passed** both TypeScript checks and the production Vite build (29.96 s bundling), including the browser-only dependency graph guard. Existing CJS/package-type and large-chunk warnings remain; they are not hidden.
- `corepack pnpm test:production`: **passed** real production onboarding, task/note/event editing, settings, reload and FTS; no page errors and test hooks absent.
- `corepack pnpm test:offline`: **4 scenarios passed** on the final production bundle: cold offline tab/lazy screens/durable edits/FTS; failed update preserving current data; successful activation waiting for old clients; failed initial install with recovery. All 85 application assets were cached. Evidence: `output/offline-validation.json`.
- Repository-root environment loading verified through Vite's resolved configuration with a temporary fixture. `.env.example` documents the optional public client ID; local configuration is Git-ignored.
- Failures investigated during validation: concurrent builds hit the 120-second server startup timeout; outdated onboarding count omitted the newly guaranteed local Inbox; an incomplete bridge fixture omitted bootstrap capabilities; strict typechecking caught an un-narrowed test result. Corrected and rerun without dropping checks. Final builds run sequentially to avoid memory contention.

## UI follow-up

UI follow-up (29 October): added the croissant favicon, theme-accent calendar creation previews, matching plus-icon task/note creation rows, and icon-free task/note empty states; removed the duplicate sidebar New note button. Notes use the shared width/slide transition while retaining a wider document layout. Fixed one-time note restoration reopening a freshly saved note after an explicit close. Production build/typechecks and eight focused editor/context unit tests pass. Browser verification covered creation styling, calendar drag previews and existing planner interactions; focused reruns pass note open/close animation, narrow/reduced-motion behavior, paging, autosave/navigation and reload. The navigation check explicitly selects visual mode when a rapid return preserves source mode during the exit animation. Screenshots are under `output/ui-review/`.

## Performance

The small revision record avoids cloning a full database on every read. Unchanged Google checkpoints also avoid redundant exports. Full snapshots remain O(database size) for actual writes; no changed-page optimization is claimed. SQL and serialization stay off the rendering thread.

Quiet Chromium 148/Linux measurements: 1,000 each tasks/notes/events (3,000 total) reopened in **495 ms**, search **11 ms**, full calendar month **45 ms**, durable edits **29 ms** median. At 5,000 each (15,000 total): **894 / 38 / 157 / 53 ms** respectively. The 14.3 MB snapshot cost **9.1 ms export + 29.2 ms IndexedDB completion** median. Observed renderer long tasks: **0**; worker WASM allocation **68.75 MB** at the larger size. Raw samples, heap limitations and methodology are [recorded](performance/browser-workspace.md). This local-only benchmark excludes online-sync lock contention; slow multi-page sync can delay queued local requests.

## External verification and deliberate limits

Live Google consent, production-origin registration, scope verification and real-account API behavior require the operator's Web OAuth client and interactive authorization. No live connection is claimed. Vercel has no authenticated session, linked project or deployment token in this environment; checked-in `vercel.json` and [exact deployment steps](deployment.md) are ready. Preview/production origins have separate browser storage; export/import transfers data.

Chromium is the executed browser target; other current browsers need release testing. Full snapshots and large editor/diagram chunks remain measurable optimization opportunities. Native sources/tests are retained only as regression/reference tooling; default dev/build/distribution is the web app. Two actual OS integration tests remain under `tests/desktop`, outside the web suite.

Official references: [SQLite WASM API](https://sqlite.org/wasm/doc/trunk/api-oo1.md), [SQLite export/deserialize](https://sqlite.org/wasm/doc/trunk/api-c-style.md), [IndexedDB completion](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event), [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Drive generated-ID uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files).
