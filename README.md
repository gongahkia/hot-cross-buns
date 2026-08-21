# Hot Cross Buns

Hot Cross Buns (`hcb`) is a local-first terminal interface and scriptable CLI
for Google Tasks and Google Calendar. It keeps an SQLite mirror on your device,
queues offline changes, and stores Google refresh tokens in the operating-system
credential store.

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

## Desktop OAuth setup

1. In Google Cloud Console, create or select a project.
2. Enable the Google Calendar API, Google Tasks API, and Google Drive API.
3. Configure the OAuth consent screen and add your Google account as a test user
   when the app is in testing mode.
4. Create an OAuth client with application type **Desktop app** and download its
   JSON file.
5. Point HCB at that file and connect:

```sh
export HCB_GOOGLE_CLIENT_CONFIG="$HOME/Downloads/client_secret.json"
hcb auth connect personal you@example.com
hcb sync
hcb
```

The TUI onboarding flow can also save the Desktop client JSON path in HCB's
local configuration. Do not commit the JSON file.

## CLI examples

```sh
hcb task-lists list
hcb tasks create "Book dentist" --list LIST_ID --due 2026-08-31
hcb events agenda --from 2026-08-21 --to 2026-08-28
hcb capture "Submit report tomorrow"
hcb search "report"
hcb --json tasks list
hcb export --format json --output hcb-export.json
hcb doctor
```

Use `--account`, `HCB_ACCOUNT`, or `preferences.default_account_id` when more
than one account is configured.

## Privacy and local data

Google remains authoritative for synchronized tasks and calendars. HCB stores
its SQLite mirror, mutation queue, sync checkpoints, configuration, and reminder
state in platform-appropriate user data directories. `hcb config path` prints
the configuration path. Refresh tokens are stored through the OS keyring;
access tokens stay in memory. HCB does not operate a web service or cloud
backend.

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
