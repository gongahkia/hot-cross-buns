# Local data specification

HCB stores its configuration, SQLite database, and runtime cache in
platform-appropriate directories selected by `platformdirs`. Run
`hcb config path` to locate strict JSON `config.json`; the database is `hcb.sqlite3` in the
corresponding user data directory.

`config.json` is the sole configuration format. It rejects malformed JSON,
duplicate keys, unknown fields, invalid types, and invalid semantic color tokens.
Run `hcb config init` to write a complete document and `hcb config schema` to
inspect its bundled Draft 2020-12 schema. Valid visual token changes are applied
to the running TUI; invalid edits retain the last valid appearance.

SQLite contains account metadata without credentials, Google Tasks and
Calendar mirrors, local settings, search data, sync checkpoints, pending
mutations, conflicts, recurrence/link metadata, and reminder delivery state.
Google remains authoritative for synchronized rows.

Rules:

- Every schema change is a numbered migration with fresh, repeated, upgrade,
  and rollback tests.
- All SQL is parameterized and mirror-plus-mutation writes are transactional.
- Account-owned rows are partitioned by account identifier.
- All-day values are ISO dates; timed values retain explicit instants and time
  zone data.
- WAL, bounded transactions, busy timeouts, and one writer transaction at a
  time support CLI/TUI and reminder-process coexistence.
- Refresh tokens live only as encrypted values in an owner-only per-account
  credential `.env`; their per-file encryption key lives in the OS keyring and
  access tokens remain in memory.
- Destructive recovery requires confirmation. `hcb auth disconnect` keeps
  cached data, while `hcb auth reset --yes` removes the selected account's
  credentials and local rows.
- Diagnostics and machine output must not expose credentials or raw private
  Google payloads.

HCB has no remote database or hosted backend. Users should treat local database
files and exports as private data and secure or delete backups themselves.
