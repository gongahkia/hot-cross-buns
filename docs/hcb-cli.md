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
`saved-searches`, `conflicts`, `import`, `auth`, `config`, `themes`, `daemon`,
`drive`, and `schema`. Top-level operations include `capture`, `search`, `find-time`,
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
hcb events instance-cache --calendar CAL_ID
hcb events duplicate EVENT_ID --include-attendees
hcb events invite EVENT_ID guest@example.test --send-updates all
hcb calendars set-list CAL_ID --color '#4285f4' --selected
hcb themes list
hcb themes show Dracula
hcb themes apply "Catppuccin Mocha"
hcb themes apply --file ~/.config/hcb/my-theme.json
hcb capture "Call Sam tomorrow"
hcb --json search "Sam"
hcb schema show events.instances
hcb import preview tasks.csv
hcb export --format ics --output calendar.ics
```

`--json` and `--tsv` are mutually exclusive. Human output goes to stdout and
actionable errors go to stderr. Destructive noninteractive commands require
`--yes`. `NO_COLOR` and `TERM=dumb` disable decoration.

All `--json` success output has this envelope:

```json
{
  "schema_version": 1,
  "command": "events.instances",
  "data": {}
}
```

Expected JSON failures use `error` instead of `data`, with stable `code`,
`message`, nullable `hint`, and `exit_code`; they still exit non-zero. The
scalar `hcb --json-schema-version` intentionally remains `1`. `hcb schema list`
lists every public JSON command, and `hcb schema show COMMAND` prints its
self-contained Draft 2020-12 schema. The versioned schema is bundled in both
the wheel and source distribution.

Account selection uses `--account`, `HCB_ACCOUNT`, or
`preferences.default_account_id`; a sole configured account is selected
automatically. OAuth setup requires a local owner-only `.env` file containing
`HCB_GOOGLE_CLIENT_ID` and, when supplied by Google, `HCB_GOOGLE_CLIENT_SECRET`.
The default is `~/.config/hcb/personal.env`; `--env-file PATH` and
`HCB_ENV_FILE` override it for the process. The refresh token is encrypted in
that file and its encryption key is stored in the OS keyring.

`preferences.editor` stores the external editor command used by TUI text
fields (default `nvim`), and `keys.external_editor` stores its shortcut
(default `ctrl+g`). For the current process, `HCB_EDITOR` takes precedence over
`preferences.editor`; it does not use the account credential `.env` file.
For example:

```sh
hcb config set preferences.editor "nvim"
hcb config set keys.external_editor "ctrl+g"
```

TUI text fields offer standard Rich emoji codes and aliases after `:`; use
`↑`/`↓` to select and `Tab` or `Enter` to insert the displayed emoji.

`events agenda`, `events instances`, and `events instance-cache` read SQLite
only. Normal `sync` updates canonical event records; `events refresh-instances
--calendar --from --to` is the explicit remote operation that expands a range
through Google and updates the derived instance cache. `events instances`
returns the queried occurrences together with `fresh`, `partial`, `stale`, or
`missing` cache coverage for the exact range. A local or remote recurring
series/instance change marks every cached range for that calendar stale; only a
named refresh marks coverage fresh again. `events edit` supports `--rrule` / `--recurrence`,
`--clear-recurrence`, `--clear-description`, and `--clear-location`.
`events set-properties` accepts a structured JSON object and honours explicit
JSON `null` and empty arrays as clears. `calendars edit` changes Calendar
resource fields, while `calendars set-list` changes CalendarList settings such
as selection, colors, default reminders, and notification preferences.

`themes list` returns HCB's 30 bundled Ghostty-derived presets in rank order.
`themes show NAME` returns one full semantic palette, and `themes apply NAME`
writes it to `config.json` while retaining the current density, border, focus,
mouse, and loader choices. `themes apply --file PATH` accepts a strict standalone
`theme` JSON object: `profile`, `density`, `borders`, `focus`, `mouse`, `loader`, plus a
`colors` object with any or all of `background`, `surface`, `panel`, `overlay`,
`control`, `text`, `muted`, `border`, `focus`, `selection`, `accent`, `success`,
`warning`, and `danger`. Omitted fields use the terminal-minimal defaults.
Unknown fields, duplicate keys, and invalid Textual colors are rejected. A
custom file replaces every supplied visual setting; a bundled preset replaces
the full color palette and profile, but preserves UI layout and interaction
settings. Any direct `hcb config set theme.*` visual edit clears the preset
provenance label; use `hcb themes apply NAME` to select a bundled preset.

The reminder process is explicit:

```sh
hcb daemon run --once
hcb daemon run
hcb daemon install     # macOS only
hcb daemon status
hcb daemon uninstall
```

Use each command's `--help` as the authoritative option reference.
