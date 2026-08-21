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
automatically. OAuth setup requires a Desktop client JSON path in
`HCB_GOOGLE_CLIENT_CONFIG` or local preferences.

The reminder process is explicit:

```sh
hcb daemon run --once
hcb daemon run
hcb daemon install     # macOS only
hcb daemon status
hcb daemon uninstall
```

Use each command's `--help` as the authoritative option reference.
