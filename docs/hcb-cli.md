# HCB CLI

`hcb <command>` or `pnpm hcb -- <command>` talks to the local Hot Cross Buns 2 MCP server. It is intended for agents and CLI users who need Git-like diagnostics against the running local app.

## Setup

1. Start Hot Cross Buns 2.
2. Open Settings -> General -> Agent access.
3. Enable Local MCP server.
4. Run `hcb doctor`.

The CLI discovers the runtime file written by the app and loads the bearer token
from the platform credential store: macOS Keychain, Linux Electron `safeStorage`
with an OS-backed provider, or Windows Electron `safeStorage`. Override
discovery with `HCB_MCP_RUNTIME_FILE`, `HCB_MCP_SECRET_STORE_FILE`,
`HCB_USER_DATA_DIR`, `HCB_MCP_BEARER_TOKEN`, or
`HCB_MCP_URL=http://127.0.0.1:<port>`.
Packaged smoke scripts may also set `HCB_MCP_SAFE_STORAGE_BINARY` to the
installed app executable so token decryption uses the packaged app's own
Electron `safeStorage` context.

## Install And Completion

The package exposes `bin/hcb.js` as the `hcb` binary. From a checkout, use
`pnpm hcb -- <command>` or `pnpm exec hcb <command>`. From an installed package,
run `hcb <command>`.

Shell completion is generated without reading local planner data:

```sh
hcb completion zsh > "${fpath[1]}/_hcb"
hcb completion bash > ~/.local/share/bash-completion/completions/hcb
hcb completion fish > ~/.config/fish/completions/hcb.fish
```

## Commands

- `hcb completion zsh`: print shell completion for bash, zsh, or fish.
- `hcb tui`: open the terminal dashboard with status, agenda, scoped search, level-filtered logs, pending mutation retry/cancel dry-runs, backend, vault host, hosters, detail panes, command history, resize-aware rendering, and dry-run/apply commands.
- `pnpm hcb -- doctor`: run read-only diagnostics and show suggested next commands.
- `pnpm hcb -- status`: show account, sync, cache, pending mutation, MCP, and build state.
- `pnpm hcb -- search <query> --scope tasks`: search tasks, notes, events, lists, or calendars.
- `pnpm hcb -- today`: show today's tasks, events, and notes.
- `pnpm hcb -- week --start-date 2026-06-04`: show a seven-day agenda.
- `pnpm hcb -- export-diagnostics`: print a redacted diagnostics JSON bundle.
- `pnpm hcb -- list task-lists`: list Google Tasks lists.
- `pnpm hcb -- list calendars`: list Google calendars.
- `pnpm hcb -- list note-lists`: list HCB note lists backed by Google Tasks lists.
- `pnpm hcb -- get task <id>`: get one task by id.
- `pnpm hcb -- get event <id>`: get one event by id.
- `pnpm hcb -- get note <id>`: get one note by id.
- `pnpm hcb -- create task --title "Plan" --due-date 2026-06-04`: dry-run a task create.
- `pnpm hcb -- create note --title "Draft" --body "Body"`: dry-run a note create.
- `pnpm hcb -- create event --title "Review" --start-date 2026-06-04T09:00:00.000Z`: dry-run an event create.
- `pnpm hcb -- create task-list --title "Errands"`: dry-run a task list create.
- `pnpm hcb -- create note-list --title "Project notes"`: dry-run a note list create.
- `pnpm hcb -- update task <id> --title "Plan v2"`: dry-run a task update.
- `pnpm hcb -- update note <id> --body "Body v2"`: dry-run a note update.
- `pnpm hcb -- update event <id> --start-date 2026-06-04T09:00:00.000Z`: dry-run an event update.
- `pnpm hcb -- rename task-list <id> --title "Errands v2"`: dry-run a task list rename.
- `pnpm hcb -- rename note-list <id> --title "Project notes v2"`: dry-run a note list rename.
- `pnpm hcb -- complete task <id>`: dry-run completing a task.
- `pnpm hcb -- reopen task <id>`: dry-run reopening a task.
- `pnpm hcb -- move task <id> --task-list-id <id>`: dry-run moving a task.
- `pnpm hcb -- log -n 20 --level warn`: show sanitized recent logs.
- `pnpm hcb -- diff --limit 20`: show pending local-to-Google mutations.
- `pnpm hcb -- backend status`: show active backend, local vault path, hoster endpoint, and Google sync state.
- `pnpm hcb -- backend set hcb-local`: dry-run switching to local HCB vault mode.
- `pnpm hcb -- backend set hcb-hoster --endpoint http://127.0.0.1:7419`: dry-run switching to local hoster mode.
- `pnpm hcb -- vault export --out /tmp/planner.hcbvault --passphrase-env HCB_VAULT_PASSPHRASE`: dry-run encrypted `.hcbvault` export.
- `pnpm hcb -- vault import /tmp/planner.hcbvault --passphrase-env HCB_VAULT_PASSPHRASE`: dry-run encrypted `.hcbvault` import.
- `pnpm hcb -- vault serve --path /srv/hcb/current.hcbvault --host 0.0.0.0 --token-env HCB_VAULT_HOST_TOKEN`: run a standalone HCB vault host on a trusted machine.
- `pnpm hcb -- vault remote-status --endpoint https://pi.local/hcb/v1/vault --token-env HCB_VAULT_HOST_TOKEN`: inspect a remote vault host.
- `pnpm hcb -- vault push --endpoint https://pi.local/hcb/v1/vault --token-env HCB_VAULT_HOST_TOKEN --passphrase-env HCB_VAULT_PASSPHRASE`: dry-run local encrypted vault export and remote upload.
- `pnpm hcb -- vault pull --endpoint https://pi.local/hcb/v1/vault --token-env HCB_VAULT_HOST_TOKEN --passphrase-env HCB_VAULT_PASSPHRASE`: dry-run remote download and destructive import.
- `pnpm hcb -- show task <id>`: show one task.
- `pnpm hcb -- show event <id>`: show one event.
- `pnpm hcb -- show note <id>`: show one note.
- `pnpm hcb -- show mutation <id>`: show one pending mutation.
- `pnpm hcb -- show diagnostics`: show a diagnostics snapshot.
- `hcb hoster status`: show local hoster server/profile status.
- `hcb hoster create --name Terminal`: dry-run a local hoster profile create.
- `hcb hoster export <id> --out /tmp/local.hcbhost --passphrase-env HCB_HOSTER_PASSPHRASE`: dry-run an encrypted portable `.hcbhost` export.
- `hcb hoster import /tmp/local.hcbhost --passphrase-env HCB_HOSTER_PASSPHRASE`: dry-run importing a portable `.hcbhost`.
- `hcb hoster test <id> --private`: run the encrypted signal round-trip test.
- `hcb hoster signal <id> --tool hcb_status --arguments-json '{}'`: send a raw loopback hoster signal for development/testing.

All commands accept `--json` for structured output. Write JSON output includes `kind: "hcbCliResult"` and `schemaVersion: 1` while preserving the command, tool, target, dry-run, confirmation, apply command, and item fields. `doctor` and `export-diagnostics` also accept `--log-limit <n>` and `--mutation-limit <n>`. `export-diagnostics` prints JSON by default.

## Create Workflow

1. Run `pnpm hcb -- create|update|rename|complete|reopen|move ...` without `--apply`.
2. Inspect the preview and `Apply:` command.
3. In `confirm-writes` mode, rerun the shown command with `--apply --confirmation-id <id>`.
4. In `allow-writes` mode, rerun the shown command with `--apply`.
5. In `read-only` mode, write commands are rejected.

## Backend And Vault Workflow

1. Run `pnpm hcb -- backend status`.
2. Preview a switch with `pnpm hcb -- backend set hcb-local`.
3. Apply with the returned confirmation command.
4. Export or import encrypted local state with `pnpm hcb -- vault export|import ... --passphrase-env <VAR>`.
5. Host the encrypted vault on a Pi/laptop with `vault serve`, then `vault push` from one client and `vault pull --apply` on another.
6. In TUI, run `view backend` or `view vault` to inspect the same state. Run `vault status`, `vault push`, or `vault pull`; push/pull use the standard dry-run/apply flow and saved vault-host credentials when available.

## Agent Workflow

1. Run `pnpm hcb -- doctor`.
2. If doctor reports account or sync issues, run `pnpm hcb -- status`.
3. If doctor reports failed or pending mutations, run `pnpm hcb -- diff`.
4. If a mutation id is shown, run `pnpm hcb -- show mutation <id>`.
5. If recent logs are flagged, run `pnpm hcb -- log --level warn` or `pnpm hcb -- log --level error`.
6. For valid destination ids, run `pnpm hcb -- list task-lists`, `pnpm hcb -- list calendars`, or `pnpm hcb -- list note-lists`.
7. For user-visible context, run `pnpm hcb -- today`, `pnpm hcb -- week`, `pnpm hcb -- search <query>`, or `pnpm hcb -- get task <id>`.
8. For a compact support bundle, run `pnpm hcb -- export-diagnostics`.

## Smoke Test

Run the fixture-backed CLI/MCP smoke test:

```sh
pnpm hcb:smoke
```

This starts an in-process local MCP server, writes a temporary runtime file, runs read/create behavior through the CLI entry point, and removes the temp files.

## Local Hosters

The local hoster protocol is documented in [Local Hoster Protocol](specs/local-hoster.md). Signal hoster routes bind only to `127.0.0.1`, use the local MCP bearer token, and dispatch through existing MCP/domain services. Vault hosting is a separate encrypted `.hcbvault` push/pull endpoint for trusted local machines.

Passphrase-portable packages use `--passphrase-env <VAR>` only; the passphrase must be supplied through the named environment variable and is not written into command previews, confirmations, or logs.

Remote vault endpoints must use HTTPS unless they are loopback. `--allow-insecure-http` exists for explicit trusted LAN/tunnel cases; vault payloads remain encrypted, but bearer tokens are still HTTP credentials.

## Privacy

The CLI defaults to `127.0.0.1` for MCP and signal hosters. Remote vault push/pull only talks to the endpoint supplied by the user or stored as the HCB hoster endpoint. It does not print bearer tokens. MCP
diagnostics are sanitized by the main app services and must not expose Google
OAuth tokens, platform credential-store material, cache encryption keys, raw
credentials, or raw Google payloads.
