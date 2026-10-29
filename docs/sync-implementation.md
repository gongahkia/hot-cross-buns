# Google/local sync implementation

Started 2026-10-29 from `82046a2`, following the [Things Cloud research and code trace](things-sync-research.md). Changes build on the existing shared `CoreStore` and `GoogleSyncService`.

## First increment: measurement and automatic scheduling

The first increment measures where sync time goes and makes returning to the app fetch Google changes promptly. It must preserve manual mode, offline work, per-tab authorization, account isolation, and durable write/recovery boundaries.

| Change | Status | Verification |
| --- | --- | --- |
| Bounded, content-free timings for queue/lock waits, storage, HTTP, pulls and delivery | Implemented | TypeScript and 42 focused performance/sync tests passed |
| Foreground, resume and online triggers with coalescing | Implemented | Real browser workers catch up after focus/page restoration; event bursts produce one pull |
| Shared per-account scheduling across tabs | Implemented | Two authorized tabs share pull timing; a hidden authorized tab delivers another tab's edits; remaining tab takes over; manual mode preserved |
| Automatic failure cooldown and hidden polling restraint | Implemented | Failed pulls back off across workers, explicit refresh resets cooldown, hidden tabs skip idle downloads |

The initial scheduling validation passed 71 focused unit tests and nine browser tests, including four new end-to-end scheduling scenarios. Google responses are mocked; production Google quotas and latency remain unmeasured.

The follow-up code review found a session-isolation defect, verified after fixing it with a real-timer browser test: expiry removes only that worker's credential and projects `reauth_required` locally; it no longer marks the shared account unauthenticated for other workers. Explicit disconnect continues to block all tabs. The extended browser suite also verifies offline-to-online delivery and automatic draining of 105 writes across the 100-write batch boundary. All seven scheduling scenarios and both account-gate scenarios pass, as do 142 SQLite/migration/sync integration tests.

### Scheduling behavior

Foreground/online events debounce for 250 ms. Successful recent pulls suppress another foreground pull for ten seconds; interval pulls retain the existing 30-second or five-minute modes. Ready outgoing writes bypass this freshness interval, but obey manual mode, account authorization, mutation backoff and failure cooldown. More than 100 ready mutations drain in successive bounded batches.

Attempts and completion/cooldown metadata live per account in the existing SQLite metadata store. Selection and persistence occur under the existing workspace lock; the next tab sees the claimed attempt before it may start. There is no permanent leader whose closed tab could strand the account, and credentials remain private to each worker. Broadcasts prompt an authorized worker to inspect queued writes; idle broadcasts never trigger a Google download.

Failed account pulls use exponential backoff with jitter, initially 24–36 seconds and capped at 15 minutes. Explicit sync bypasses this cooldown. Clock rollback or malformed/future scheduling metadata resets the timing state without changing tasks or outbox records. These records do not replace the existing mutation retry limits or conflict recovery.

## Second increment: local edits during HTTP — 2026-10-29

Local requests now have a separate worker queue from Google operations. A stalled Google pull, write, or response body no longer owns the SQLite/IndexedDB writer lock. The shared domain store and Google engine remain authoritative; there is no second backend or database merge engine.

### Ownership and durable boundaries

`hot-cross-buns-google-operations` serializes Google operations across tabs. Its owner acquires `hot-cross-buns-workspace-writer` only for local segments. Before each HTTP request, it saves all changed SQL state, releases the workspace lock, and consumes the response body while unlocked. On success **or failure**, it reacquires the writer and reloads the latest durable revision before applying a receipt, retry, or conflict. A stable store facade directs the existing sync engine to that current connection; statements and SQLite transactions never span an unlocked network wait.

Other local requests—including edits to the item currently being sent—continue through the normal durable save path. Their SQLite state, outbox entries, and undo history still commit together before success is returned. Two Google requests remain ordered even when they originate in different tabs. Manual mode, per-account scheduling, automatic cooldowns, and private in-memory credentials retain their existing behavior.

The network owner also protects interrupted-create recovery. Reopening a snapshot in another worker no longer mistakes a live Tasks creation for a crashed one. A nonblocking ownership check permits recovery only when no Google owner exists; a newly acquired Google owner recovers abandoned intents before starting work. Web Locks release ownership when the worker closes. No timestamp lease or permanent leader is required. IndexedDB protocol **v3** closes and fences v1/v2 writers that do not understand this ownership rule, while retaining their saved snapshot.

Workspace export and import review remain local operations. Confirming a replacement, and explicit outbox recovery decisions, wait for Google ownership without occupying the local request queue. Import still rejects a review if the workspace changed while it waited. Explicit disconnect can finish during HTTP: a write already accepted by Google retains its receipt, and later sends stop until reconnection.

### Responses that arrive after local changes

- Task and event receipts update remote identities/ETags while preserving newer local content, ordering, recurrence, and attachment edits. Task receipts retain the location actually used by the request, so a later move addresses the right remote list.
- A deletion queued during creation receives the accepted ID and ETag on its tombstone. Pulls do not resurrect that deleted row. Calendar's reserved identity can recover a lost creation receipt onto the tombstone after a tab closes.
- Moving a still-unbound Calendar creation becomes an ordered remote move after its identity arrives, including recovery through a subsequent pull.
- Undo during an accepted delete preserves the restored local item. Tasks recreate after clearing the deleted binding. Calendar reserves a fresh durable ID for that restoration and reuses it across retries. Google requires unique Calendar IDs and documents a new ID for a new instance when an identifier already exists; see [Calendar errors](https://developers.google.com/workspace/calendar/api/guides/errors) and [event identity/status](https://developers.google.com/workspace/calendar/api/v3/reference/events). This is the app's restoration strategy, not a general claim that Calendar has no undelete behavior.
- Delivery rechecks the current outbox before each command, including eligibility, permissions, and refreshed deletion payloads. Retry/cancel decisions are serialized with Google work.
- A recurring-series split spans several remote mutations. If local commands arrive during one of those waits, it stops for explicit comparison instead of compensating over newer edits. Its partial remote result is treated as uncertain. Ordinary local edits remain available.

Tasks creations with a genuinely lost result still require review; Google Tasks has no client-supplied creation ID here. Independent remote/local field merging remains a later increment. Google operations within one pipeline remain sequential; Gmail metadata requests are also sequential to preserve one SQL continuation.

### Responsiveness and limits

The browser regression tests deliberately hold Google responses open and require local API operations to finish **before releasing HTTP**, within a two-second test deadline. They cover same-tab and cross-tab edits, reads, undo, settings, a second queued sync, another worker reopening an active intent, closing the Google owner, local save failure, deletion during creation, undo during deletion, and explicit disconnect. Unit coverage also holds a response **body** open, verifies refresh-before-error handling, and checks that a failed checkpoint prevents the request from being sent.

The deadline is a regression bound on small mocked workspaces, not a measured production latency percentile or a claim about Google performance. SQLite work, snapshot export, IndexedDB commits, full-page reconciliation, and local preparation of uploads still take the workspace lock. Large-workspace storage costs, device load, browser suspension, and Google latency remain separate limits. The existing 30-second HTTP deadline includes response bodies. HTTP 204/205/304 replies are reconstructed with a null body even if the transport exposes an empty stream, so a successful delete is not misclassified as a network failure.

Implementation: `src/browser/workspace.worker.ts`, `workspaceLease.ts`, `googleSync.ts`, `googleSyncSessions.ts`, `indexedDb.ts`, and the existing shared `CoreStore`/`GoogleSyncService`. Regression coverage lives in `tests/browser/responsive-sync.spec.ts`, `src/browser/googleConcurrency.test.ts`, and `src/browser/workspaceLease.test.ts` alongside the existing sync/storage tests.

### Second increment verification

Runtime verified at `cb03557`, with the final browser tests added in the following test commit:

- `corepack pnpm test:unit`: **481 tests across 78 files passed**, including the database/integration tests. The separate `test:db` command also passed its 142 cases.
- **49 distinct browser checks passed** across two targeted runs: 47 cases covering responsiveness, automatic sync, account requirements, controls, persistence, multiple tabs, preferences, storage safety and transfers; then two additional cases verifying inspector save/close and import waiting during stalled HTTP. Eleven of these cases are in `responsive-sync.spec.ts`.
- Storage upgrades from both v1 and v2 retain the snapshot, close the old connection, and reject old-version writers.
- `corepack pnpm build`: both TypeScript checks and production bundling passed. Existing Vite chunk-size warnings remain.
- `corepack pnpm test:production`: passed; required Google onboarding, durable recovery and absence of test hooks remain verified.
- `corepack pnpm test:offline`: all four production offline/update scenarios passed.

Google responses were mocked for concurrency testing. No live Google resources or deployment were changed. No quiet-machine percentile benchmark was performed. `README.md` was left unchanged.

## Following increments

1. Persist remote baselines and local field changes; automatically merge independent edits. Preserve explicit review for overlapping edits, deletions and structural changes.
2. Coalesce compatible unsent edits and send smaller patches without breaking undo, ordering or recurrence dependencies.
3. Add server sessions and a narrow Google transport adapter, then Calendar watch notifications. The backend requires its own deployment/configuration and does not create a Tasks push API.
4. Treat full HCB Notes/preferences replication and native mobile background execution as separate product extensions.

The existing browser token model still requires reconnection after reload or token expiry. This first increment does not claim unattended closed-app sync or measured phone-to-Mac latency. Live validation uses disposable Google resources after local regression checks pass.

## Reading the measurements

The existing Diagnostics summary/export includes these samples when performance diagnostics are enabled. The in-memory history remains bounded to 200 samples and resets with the worker. Fixed labels contain no account/resource identifiers, URLs, note content, response bodies or credentials.

- `workspace.queue.wait` and `workspace.lock.wait` separate same-worker waiting from cross-tab contention.
- `workspace.snapshot.export` and `workspace.snapshot.persist` measure local persistence.
- `google.http.read` and `google.http.write` include JSON response consumption and failed requests, excluding the separate before-write checkpoint.
- `google.pull.tasks`, `google.pull.calendar`, `google.outbox` and `google.checkpoint.*` show higher-level phases; `google.sync` measures the full cycle. These nested timings must not be added together.

This measures JSON sync traffic; Drive's binary upload transport is outside the HTTP timing labels. Cross-device convergence and renderer application timing still require separate end-to-end instrumentation and live measurements.

## First increment verification — 2026-10-29

Runtime changes were verified at `8d86976`:

- 71 focused unit tests across browser scheduling, lifecycle, auth, bridge, sync and performance instrumentation.
- `corepack pnpm test:db`: 142 database, migration and sync integration tests.
- 27 distinct browser cases across targeted runs: seven automatic-sync scenarios, two required-account scenarios, three browser-control checks, and 15 persistence/storage/multitab/preference regressions.
- `corepack pnpm build`: both TypeScript checks and the production Vite build pass.
- `corepack pnpm test:production`: production has no test hooks, enforces the Google account requirement, and preserves local recovery data across reloads.
- `corepack pnpm test:offline`: all four production offline/update scenarios pass.

The production smoke initially assumed account-free onboarding and timed out on the correctly disabled Continue button. Its expectations now cover the mandatory account gate, including a legacy completed workspace; production runtime code was not weakened to satisfy the test. Connected-workspace interactions are covered by the mocked-GIS browser suite. No live Google account or deployment was changed.
