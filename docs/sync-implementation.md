# Google/local sync implementation

Started 2026-10-29 from `82046a2`, following the [Things Cloud research and code trace](things-sync-research.md). Changes build on the existing shared `CoreStore` and `GoogleSyncService`.

## First increment: measurement and automatic scheduling

The first increment measures where sync time goes and makes returning to the app fetch Google changes promptly. It must preserve manual mode, offline work, per-tab authorization, account isolation, and durable write/recovery boundaries.

| Change | Status | Verification required |
| --- | --- | --- |
| Bounded, content-free timings for queue/lock waits, storage, HTTP, pulls and delivery | Implemented | TypeScript and 42 focused performance/sync tests passed |
| Foreground, resume and online triggers with coalescing | Planned | Real worker/browser integration, burst events, suspended/hidden tabs |
| Shared per-account scheduling across tabs | Planned | Multiple authorized tabs, pending edits from an unauthorized tab, account isolation, takeover, manual mode |
| Automatic failure cooldown and hidden polling restraint | Planned | Failed pulls, repeated focus/online events, explicit recovery, expired credentials |

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
