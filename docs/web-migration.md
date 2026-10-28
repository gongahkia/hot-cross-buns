# Browser migration checkpoint

Branch: `migration/browser-indexeddb`. The initial tree was clean.

## Architecture

The original SQL/domain implementation now lives in `src/shared/core/CoreStore.ts`. A small synchronous database interface preserves the existing queries, pagination, recurrence, task ordering, FTS triggers, outbox and undo. The original `src/main/services/coreStore.ts` is a native regression-test/legacy adapter.

Vite serves the existing React interface. `src/browser/bridge.ts` installs `window.hcb` before React mounts and uses the original validated result envelopes. A dedicated worker runs SQLite WASM and serialization. The exact official package is pinned at `@sqlite.org/sqlite-wasm@3.54.1-build1` (registry verified).

IndexedDB is the durable store: one record atomically holds a full SQLite snapshot plus format/revision/save metadata. Mutations are acknowledged only on IndexedDB transaction completion (strict durability requested). Failure reconstructs the active database and statement cache from the last durable snapshot. SQL exceptions roll back a surrounding savepoint. Initialization/migration errors preserve durable data and surface errors; no fallback reset is permitted.

An exclusive Web Lock grants one request writer authority across tabs. Each request checks the IndexedDB revision and refreshes stale worker state before SQL. The write transaction also compares the expected revision atomically. SQL and serialization never run on the rendering thread. HTTPS/localhost and a current browser with Web Locks, WebAssembly and IndexedDB are required.

Full snapshots favor correctness; cost scales with database size. `window.hcb.diagnostics.storage()` reports bytes, export/commit/load milliseconds and revision. Each request currently reads the snapshot record to check its revision, including reads. Cross-tab refresh invalidates session-only smart-scheduling previews; regenerate a preview after another tab changes the workspace.

Measured with `pnpm measure:storage` against the static test server, headless Chromium 148 on Linux, five edits per dataset while other UI validation ran. Values below are medians, not latency guarantees; [raw samples](performance/browser-storage.json) are retained.

| Tasks | Snapshot bytes | Export ms | IndexedDB commit ms | Read snapshot ms | Complete edit ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,122,304 | 1.1 | 14.4 | 5.1 | 31.6 |
| 5,000 | 3,325,952 | 4.6 | 32.3 | 15.2 | 60.4 |
| 10,000 | 6,365,184 | 8.3 | 45.5 | 22.0 | 77.6 |

Full snapshots are not negligible. Splitting revision reads from blob reads and measuring page-delta commits are future optimizations. The rendering thread remains free of SQL/serialization during these costs.

## Capability parity

Preserved implemented domain: tasks/subtasks/task lists, notes/note lists, tags, calendar events/recurrence/occurrence edits, scheduled task blocks, smart scheduling, full-text search, settings, history and undo/redo. Existing renderer pagination, virtual lists, calendar gestures, keyboard navigation, inspectors and drafts remain in use. External-tab refresh waits for editors/gestures to finish; a discovered task-inspector draft-loss bug has a regression test and fix. Pane view preferences, layout and stars use IndexedDB-backed settings; localStorage fallback remains only for legacy harnesses without the browser bridge. New workspaces seed Inbox, Primary calendar and Notes. Onboarding supports these local resources without Google.

Google OAuth, sync, Drive, Gmail and free/busy are unavailable during this pass and return actionable errors. Status reports availability honestly. Desktop tray/menu, native notifications, filesystem dialogs and desktop update controls are unavailable in the browser. Two OS-specific tests remain under `tests/desktop`; they are outside the browser suite.

Historically declared but unimplemented bridge methods remain unsupported, not fabricated successes: tags merge/bulk apply/analytics/auto reapply; semantic model install/rebuild; note entity/broken-link APIs; agent actions/duplicate cleanup; customization/extensions/snippets; attachments; ICS; portable archive/local pointer/vault services. Core `linkSuggest`, lexical search/resolveLinks, tags CRUD and native browser clipboard/external web links do work.

## Validation

- `pnpm build`: **passed**, including strict browser/core TypeScript and Vite's browser-only module guard. Generated `dist/`; existing large editor/diagram chunks still trigger size warnings.
- `pnpm test:production`: **passed** against the production bundle: real local onboarding, durable task/note/event edits and settings, FTS after reload, no page errors, no test hooks. Screenshot: `output/web-production.png`.
- Actual browser-worker WASM compatibility: **13 checks passed**, SQLite 3.54.1: FTS5, positional/named bindings, foreign keys, triggers, JSON, CTE/window queries, nested savepoints/rollback, constraint-error reuse/finalization, export/reopen/writes, byte-identical populated reopen and domain FTS.
- `pnpm test:db`: **142 passed**, zero skips (68 CoreStore, 66 mocked Google integration, 8 migration safety).
- `pnpm test:unit`: **395 passed**, one existing macOS-only native test skipped. All database tests executed under Node; a subsequently added preference regression also passed in its targeted run.
- Initial static Chromium run: **75/77 passed**. Two outdated desktop expectations (Today accessible label, Google-only onboarding radios) were corrected without removing their interaction checks.
- Rebuilt focused browser run: **37/38 passed**. Includes all 12 browser storage/multitab/preferences/Google-unavailable tests plus affected UI suites. Found a fast-navigation preference save regression; final fix and focused validation pending.
- Browser tests cover failed IndexedDB commits (including event/block/undo rollback), context isolation, writer coordination, unchanged revisions for reads, corrupt/future-schema preservation, FTS, recurrence, task completion/undo/redo, and preferences surviving `localStorage.clear()`.

## Sources

- [Official SQLite WASM OO API](https://sqlite.org/wasm/doc/trunk/api-oo1.md)
- [Official SQLite WASM export/deserialize API](https://sqlite.org/wasm/doc/trunk/api-c-style.md)
- [Official SQLite package](https://github.com/sqlite/sqlite-wasm)
- [IndexedDB transaction completion](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event)
- [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [Vite worker bundling](https://vite.dev/guide/features.html#web-workers)

## Remaining work

Finish the final focused navigation regression validation. Dedicated Google OAuth/sync/Drive/Gmail integration, browser backup import/export, and desktop-only background capabilities remain follow-ups. Consider a small separate revision record and page-delta persistence after the measured full-snapshot costs above. Browser application data does not use OPFS, localStorage or a server database. Legacy Electron source/tests remain development references; Electron packaging/rebuild commands and packaging dependencies were removed from the default workflow.

## Completion pass in progress

The foundation is preserved on the same migration branch. The earlier 84 browser cases passed across full and focused runs; the current follow-up is being revalidated rather than assuming those results cover the new work.

- Extracting the existing Google sync engine into a portable shared service; browser GIS Web OAuth keeps access tokens in memory, uses verified Google identity, and requires explicit reconnection after expiry. Worker serialization and Web Locks also cover async synchronization; remote writes receive durable before/after checkpoints.
- Adding reviewed full-workspace SQLite export/import. Candidate imports migrate on a separate connection, check integrity and foreign keys, reject future schemas and standalone WAL-mode files, and quarantine imported Google mutation queues. Review tokens are revision-bound and expire after ten minutes.
- Added atomic revision metadata beside the snapshot to avoid cloning the full database on each read. Full snapshots still serialize every durable SQL mutation; no page-write claim is being made.
- Adding real browser file/download/clipboard actions, tab-lifetime notifications, initialization recovery controls and production offline assets. Native-only controls are being removed from browser settings.
- Adding Vercel static deployment configuration, a mixed-workspace benchmark and independent failure-path review. No live Google authorization or authenticated Vercel deployment has yet been verified in this pass.
