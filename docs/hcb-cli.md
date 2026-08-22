# HCB CLI

Running `hcb` with an interactive terminal opens the TUI. All other entry
points are scriptable:

```sh
hcb --help
hcb COMMAND --help
hcb --account ACCOUNT_ID COMMAND
hcb --json COMMAND
hcb --tsv COMMAND
```

Major command groups are `tasks`, `task-lists`, `notes`, `events`, `calendars`,
`saved-searches`, `conflicts`, `import`, `auth`, `config`, `daemon`, and
`drive`. Top-level operations include `capture`, `search`, `find-time`,
`freebusy`, `sync`, `export`, `undo`, `redo`, and `doctor`.

Examples:

```sh
hcb auth connect personal you@example.com
hcb sync
hcb tasks list
hcb tasks create "Prepare agenda" --list LIST_ID --due 2026-08-24
hcb tasks complete TASK_ID
hcb events agenda --from 2026-08-21 --to 2026-08-28
hcb events refresh-instances --calendar CAL_ID --from 2026-08-21 --to 2026-09-21
hcb events duplicate EVENT_ID --include-attendees
hcb events invite EVENT_ID guest@example.test --send-updates all
hcb calendars set-list CAL_ID --color '#4285f4' --selected
hcb capture "Call Sam tomorrow"
hcb --json search "Sam"
hcb import preview tasks.csv
hcb export --format ics --output calendar.ics
```

`--json` and `--tsv` are mutually exclusive. Human output goes to stdout and
actionable errors go to stderr. Destructive noninteractive commands require
`--yes`. `NO_COLOR` and `TERM=dumb` disable decoration.

Account selection uses `--account`, `HCB_ACCOUNT`, or
`preferences.default_account_id`; a sole configured account is selected
automatically. OAuth setup requires a local owner-only `.env` file containing
`HCB_GOOGLE_CLIENT_ID` and, when supplied by Google, `HCB_GOOGLE_CLIENT_SECRET`.
The default is `accounts/ACCOUNT_ID.env` below HCB's configuration directory;
`--env-file PATH` and `HCB_ENV_FILE` override it for the process. The refresh
token is encrypted in that file and its encryption key is stored in the OS
keyring.

`events agenda` and `events instances` read SQLite only. Normal `sync` updates
canonical event records; `events refresh-instances --calendar --from --to` is
the explicit remote operation that expands a range through Google and updates
the derived instance cache. `events edit` supports `--rrule` / `--recurrence`,
`--clear-recurrence`, `--clear-description`, and `--clear-location`.
`events set-properties` accepts a structured JSON object and honours explicit
JSON `null` and empty arrays as clears. `calendars edit` changes Calendar
resource fields, while `calendars set-list` changes CalendarList settings such
as selection, colors, default reminders, and notification preferences.

The reminder process is explicit:

```sh
hcb daemon run --once
hcb daemon run
hcb daemon install     # macOS only
hcb daemon status
hcb daemon uninstall
```

Use each command's `--help` as the authoritative option reference.
