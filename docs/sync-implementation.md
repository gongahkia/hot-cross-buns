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

## Following increments

1. Separate HTTP waiting from the workspace lock, with durable operation reservations, version checks and takeover fencing. Test local edits during slow HTTP before enabling it.
2. Persist remote baselines and local field changes; automatically merge independent edits. Preserve explicit review for overlapping edits, deletions and structural changes.
3. Coalesce compatible unsent edits and send smaller patches without breaking undo, ordering or recurrence dependencies.
4. Add server sessions and a narrow Google transport adapter, then Calendar watch notifications. The backend requires its own deployment/configuration and does not create a Tasks push API.
5. Treat full HCB Notes/preferences replication and native mobile background execution as separate product extensions.

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
