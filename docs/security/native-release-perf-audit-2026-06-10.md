# Security, Native, Release, MCP, And Perf Audit - 2026-06-10

Scope: static repo audit plus local test/perf harness surfaces. No packaged-app QA, external MCP client QA, live Google API run, or native helper implementation was performed.

## Implemented In This Slice

- Webhooks now persist delivery payloads, retry state, next-attempt timestamps, and last-attempt timestamps in SQLite.
- Webhook delivery now uses bounded retry, per-subscription rate limiting, body redaction by subscription policy, and due-delivery draining during sync/manual activity.
- Missing webhook emit sources added:
  - `mutation.failed` from the Google pending mutation worker.
  - `event.starting` when an event notification is scheduled.
- Sync and mutation backoff now support injectable low-power/constrained-network multipliers.
- Perf fixtures now include explicit `event15k` / `HCB_PERF_FIXTURE_SIZE=15k-event` coverage.

## MCP Original Parity

- Original Swift/docs tool names are present: `hcb_search`, `hcb_today`, `hcb_week`, `hcb_get_task`, `hcb_get_event`, `hcb_list_task_lists`, `hcb_list_calendars`, `hcb_create_task`, `hcb_create_note`, `hcb_create_event`, `hcb_update_task`, `hcb_update_event`, `hcb_complete_task`, `hcb_reopen_task`, `hcb_move_task`, `hcb_delete_task`, `hcb_delete_event`.
- HCB2 adds a superset: diagnostics/log/diff/show/tail/brief/plan, notes/lists, sync/mutation controls, undo/redo, settings/OAuth/MCP controls, convert, and event completion tools.
- Dry-run / confirmation / allow-write modes are implemented in current MCP tests. Destructive tools still require confirmation in allow-write mode.
- No explicit alias registry was found in the original Swift MCP surface or current TS tool registry.
- External MCP client QA remains open.

## Deferred Native/Release Items

- Cache encryption remains gated. Do not expose a Settings toggle until dependency, migration, rollback, restart-open, corrupt-key, missing-Keychain, interrupted-write, decrypt/export, and recovery drills pass.
- GitHub Releases update checker remains audit/spec only. Required behavior: semantic version compare, latest release state, recoverable network errors, manual download prompt, checksum/signature path, no silent install.
- Spotlight/Raycast/Alfred/App Intents/Share Extension remain audit/spec only. Legacy Swift implementations exist in `../hot-cross-buns`; Electron helper packaging is not implemented in this slice.
- Rich notification actions remain deferred. Current implementation still uses Electron notification click routing plus the new `event.starting` emit.

## Overdue/Cleanup Audit

- Settings and sync paths already expose separate retention values for past events and completed tasks.
- Read sync applies retention windows when fetching Google Tasks/Calendar data.
- No standalone overdue-cleanup service equivalent to legacy `PastCleanupService` was found in the TS app. Keep this open if product expects a destructive local cleanup action rather than sync-range retention.

## Remaining QA

- Run external MCP client against a live app config.
- Run packaged macOS QA for notifications, protocol links, menu bar, updater status, and release artifact checks.
- Run `pnpm test:perf:15k` on a stable local machine and compare report-only timings before adding thresholds.
