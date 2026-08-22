# Local TUI architecture

Hot Cross Buns is an installed, local Google Calendar and Google Tasks client.
Running `hcb` opens the terminal interface; resource subcommands provide the
same application operations without a full-screen terminal.

## Trust boundary

Google Calendar and Google Tasks remain authoritative for synchronized data.
SQLite is a local mirror, search index, sync checkpoint store, reminder state
store, and durable mutation journal. Normal reads and optimistic writes do not
require a network round trip. Synchronization reconciles queued writes and
remote changes.

OAuth uses a Desktop client and a temporary loopback callback with PKCE. The
client ID and optional secret live in an owner-only per-account `.env` file.
The refresh token is encrypted in that same file; only its per-file encryption
key is held by the operating-system credential store. Tokens must not be
written to SQLite, TOML, command output, logs, or diagnostics. Drive access is
requested only for user-initiated metadata searches.

## Layers

The `hcb` package is divided into:

- `domain`: typed tasks, calendars, events, mutations, conflicts, and settings.
- `storage`: migrations and account-partitioned SQLite repositories.
- `sync`: Google transport, incremental pull, outbox delivery, and recovery.
- `application`: operations shared by the CLI, TUI, and scheduler.
- `cli`: stable commands, machine output, exit codes, and shell completion.
- `tui`: Textual views and editors. It never calls Google or SQLite directly.
- `auth`: loopback OAuth and credential-store access.
- `scheduler`: explicit local synchronization and reminder service.

The Google Calendar mirror stores canonical recurrence masters unchanged. A
named remote range refresh materializes Google's concrete recurring instances
as derived cache rows and records the refreshed range. TUI range views use that
cache, while the CLI exposes both cached `events instances` and explicit remote
`events refresh-instances`; HCB does not implement recurrence expansion.
Each cached range records its refresh time and `fresh`/`stale` state. Local or
remote changes to a recurring series or instance stale the calendar's cached
ranges. A named refresh is the only operation that makes its requested coverage
fresh. The TUI reports the visible range, latest refresh time, and stale reason
without making an implicit network request.

## Synchronization invariants

1. Flush pending mutations in creation order before pulling remote changes.
2. Send entity tags on updates and deletes when available.
3. Convert `409`, `410`, and `412` mutation failures into recoverable conflicts.
4. Retain retryable mutations after transport, rate-limit, and server failures.
5. Use a five-minute overlap on Google Tasks `updatedMin` watermarks.
6. Save Calendar pages and resume state transactionally.
7. Save `nextSyncToken` only from the final page.
8. On Calendar `410 Gone`, clear only the affected mirror and restart its full
   synchronization.
9. Never advance a checkpoint for a page that was not committed.

## Processes and database ownership

Interactive commands and the optional scheduler may coexist. SQLite uses WAL,
bounded transactions, a busy timeout, and one writer transaction at a time.
The scheduler is a visible, separately invokable process; opening the TUI does
not silently install or start a daemon.

## Terminal contract

Human output goes to stdout and actionable errors go to stderr. Machine
commands support JSON, avoid decoration, and use stable non-zero exit codes.
The renderer honors `NO_COLOR`, `TERM=dumb`, narrow terminals, Unicode width,
and an ASCII line-art fallback. Every core TUI operation has a non-TUI command.

Themes and keymaps use semantic names rather than widget-specific colors.
Built-in dark, light, and monochrome themes can be overridden in validated
TOML without changing synchronization or domain behavior.
