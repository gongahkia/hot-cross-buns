# Product requirements

## Product

Hot Cross Buns is an installed Python terminal application for one or more
Google Calendar and Google Tasks accounts. Running `hcb` opens a keyboard-first
Textual workspace; subcommands expose the same operations for scripts.

## Product goals

- Fast local reads, search, and optimistic edits through an SQLite mirror.
- Durable offline mutations with explicit sync and recoverable conflicts.
- Task lists, hierarchy, completion, notes projection, recurrence markers,
  batch actions, import/export, and quick capture.
- Calendar agenda and time-grid workflows, event mutation, recurrence
  round-tripping, reminders, invitations, free/busy, and saved search.
- Desktop OAuth with user-supplied `.env` credentials, encrypted
  local refresh tokens, and an OS-keyring encryption key.
- Stable JSON/TSV output, useful exit codes, and noninteractive parity for core
  TUI operations.
- Optional local reminders that do not depend on the TUI remaining open.

## Product boundaries

Google Calendar and Google Tasks remain authoritative for synchronized data.
HCB does not host accounts, operate a sync backend, or provide a web, Electron,
Qt, or other GUI product. It does not reimplement Google Calendar recurrence
expansion; concrete recurring instances come from Google.

Task due dates follow Google Tasks' date-only model. Timed task blocks are
Calendar events linked to their source tasks in local metadata.

## Privacy and reliability

Refresh tokens belong only in the encrypted owner-only account environment
file, their encryption keys belong in the operating-system credential store,
and access tokens remain in memory. Neither tokens nor OAuth secrets may enter
SQLite, logs, exports, or diagnostics. Every schema change requires a tested migration.
Queued user writes must not be silently discarded.

## Acceptance

Automated tests, type checking, linting, package builds, and the local TUI smoke
test are required. The live Google acceptance gate for this Python pivot was
explicitly waived and not executed before legacy retirement. Therefore Google
integration is not considered live-account accepted until
`docs/testing/live-google-tui-smoke.md` is completed and recorded.
