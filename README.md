# Hot Cross Buns

Hot Cross Buns (`hcb`) is a local-first terminal interface and scriptable CLI
for Google Tasks and Google Calendar. It keeps an SQLite mirror on your device,
queues offline changes, and keeps a local Google credential file on the local
machine.

## Install

Python 3.12 or newer is required.

```sh
uv tool install hot-cross-buns
# or
pipx install hot-cross-buns
```

From a source checkout:

```sh
uv sync --extra dev
uv run hcb --help
```

Run `hcb` in a terminal to open the Textual TUI. Run `hcb --help` to discover
scriptable commands.

## Text editing

Every TUI text field supports Slack-style emoji completion: type a colon and an
emoji code such as `:smile` or alias such as `:+1`, then use `↑`/`↓` and `Tab`
or `Enter` to insert the selected emoji. `Escape` dismisses the suggestions.

Press `Ctrl+G` in a text field to edit its value in `nvim` by default. HCB
suspends its terminal UI, passes a private temporary file directly to the
editor command, then restores the changed value. Multiline fields retain their
text; single-line fields join edited lines with spaces. Configure the command
and shortcut in `config.json` or through the CLI:

```sh
hcb config set preferences.editor "nvim"
hcb config set keys.external_editor "ctrl+g"
```

`HCB_EDITOR` overrides `preferences.editor` for the current process. It is a
normal environment variable, separate from HCB's account `.env` credential
file.

## Desktop OAuth setup

1. In Google Cloud Console, create or select a project.
2. Enable the Google Calendar API, Google Tasks API, and Google Drive API.
3. Configure the OAuth consent screen and add your Google account as a test user
   when the app is in testing mode.
4. Create an OAuth client with application type **Desktop app**.
5. Create HCB's owner-only default credential file at `~/.config/hcb/personal.env`.
   Pass `--env-file` or set `HCB_ENV_FILE` to use another local path.

```sh
credential_file="$HOME/.config/hcb/personal.env"
mkdir -p "${credential_file%/*}"
$EDITOR "$credential_file"
# HCB_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
# HCB_GOOGLE_CLIENT_SECRET=...  # optional for a Desktop client
chmod 600 "$credential_file"

hcb --env-file "$credential_file" auth connect personal you@example.com
hcb sync
hcb
```

The file is never read from the repository or `config.json`. On first
connection HCB adds an encrypted refresh-token value to that same file; its
per-file encryption key remains in the operating-system keyring. HCB rejects a
credential file that group or other users can read or write. Do not commit it.

## CLI examples

```sh
hcb task-lists list
hcb tasks create "Book dentist" --list LIST_ID --due 2026-08-31
hcb events agenda --from 2026-08-21 --to 2026-08-28
hcb events create "Standup" --calendar CAL_ID --start 2026-08-24T09:00:00+08:00 --end 2026-08-24T09:15:00+08:00 --rrule 'FREQ=WEEKLY;BYDAY=MO'
hcb events refresh-instances --calendar CAL_ID --from 2026-08-21 --to 2026-09-21
hcb events instances --calendar CAL_ID --from 2026-08-21 --to 2026-09-21
hcb events instance-cache --calendar CAL_ID
hcb calendars set-list CAL_ID --color '#4285f4' --selected
hcb capture "Submit report tomorrow"
hcb search "report"
hcb --json tasks list
hcb schema list
hcb schema show events.instances
hcb config schema
hcb themes list
hcb themes apply "Catppuccin Mocha"
hcb export --format json --output hcb-export.json
hcb doctor
```

Use `--account`, `HCB_ACCOUNT`, or `preferences.default_account_id` when more
than one account is configured.

## Machine-readable output

Every successful `--json` command emits a versioned envelope with
`schema_version`, `command`, and `data`. Expected `--json` failures emit the
same version and command plus `error.code`, `error.message`, `error.hint`, and
`error.exit_code`, then return a non-zero process status. `hcb --json-schema-version`
remains a scalar `1` for lightweight capability checks.

HCB bundles its Draft 2020-12 contract in the installed package. Use
`hcb schema list` to enumerate covered commands and `hcb schema show COMMAND`
to print a self-contained schema for one command. The schema is intended for
shell and program integrations; the human and TSV output formats are separate
interfaces.

`hcb config init` writes the complete strict JSON configuration to the path from
`hcb config path`. `hcb config schema` prints its Draft 2020-12 schema. The TUI
uses its semantic theme tokens and reloads valid visual changes from that file;
invalid edits leave the active appearance in place and report an error.

## Themes

HCB ships 30 Ghostty-derived visual presets, selected from Ghostty's bundled
theme collection using family-level community adoption and recurrent terminal
theme curation. `hcb themes list` shows the stable ranked set, `hcb themes show
NAME` prints every semantic token, and `hcb themes apply NAME` writes it to
`config.json`. The running TUI notices that edit and reloads it.

For a fully custom appearance, apply a strict standalone theme JSON document:

```sh
hcb themes apply --file my-theme.json
```

The file accepts every visual input field: `profile`, `density`, `borders`,
`focus`, `mouse`, `loader`, and all 14 semantic `colors` tokens. The Settings
dialog includes a searchable picker for all 56 [Rattles](https://github.com/vyfor/rattles)
loaders; `hcb config set theme.loader braille.dots` selects one noninteractively.
The selected loader is used consistently while HCB is connecting, syncing,
refreshing recurring instances, or querying Google free/busy.
`hcb config set theme.colors.TOKEN VALUE` is useful for a single override and
clears the preset provenance label. The complete Ghostty source inventory,
selection method, and pinned upstream revision are in
[the bundled-theme inventory](docs/architecture/ghostty-bundled-themes.md).

## Privacy and local data

Google remains authoritative for synchronized tasks and calendars. HCB stores
its SQLite mirror, mutation queue, sync checkpoints, configuration, and reminder
state in platform-appropriate user data directories. `hcb config path` prints
the configuration path. Refresh tokens are encrypted in the owner-only account
environment file; only the encryption key is stored through the OS keyring.
Access tokens stay in memory. HCB does not operate a web service or cloud backend.

`hcb auth disconnect` removes local credentials and keeps cached data.
`hcb auth reset --yes` also permanently removes that account's local data.

## Reminders and daemon

The reminder process is opt-in and independent of the TUI:

```sh
hcb config set preferences.reminders_enabled true
hcb daemon run --once
hcb daemon install   # macOS LaunchAgent
hcb daemon status
hcb daemon uninstall
```

Opening the TUI never installs a daemon. Automatic LaunchAgent installation is
currently available only on macOS; `hcb daemon run` can be supervised manually
on other platforms.

## Development

```sh
uv sync --extra dev
make format
make lint
make test
make build
make benchmark
```

See [the documentation index](docs/README.md), the
[local smoke test](docs/testing/local-tui-smoke.md), and the
[live Google smoke procedure](docs/testing/live-google-tui-smoke.md).

## Acceptance status

The live Google acceptance gate for the Python pivot was explicitly waived and
was not executed before the legacy Qt, web, and self-hosted products were
retired. Automated and local TUI checks do not substitute for that live-account
acceptance. Run the documented live smoke procedure before treating Google
integration as release-accepted.
