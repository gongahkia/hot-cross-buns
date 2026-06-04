# HCB CLI

`pnpm hcb -- <command>` talks to the local Hot Cross Buns 2 MCP server. It is intended for agents and CLI users who need Git-like diagnostics against the running local app.

## Setup

1. Start Hot Cross Buns 2.
2. Open Settings -> General -> Agent access.
3. Enable Local MCP server.
4. Run `pnpm hcb -- doctor`.

The CLI discovers the runtime file written by the app and loads the bearer token from the macOS Keychain. Override discovery with `HCB_MCP_RUNTIME_FILE`, `HCB_USER_DATA_DIR`, or `HCB_MCP_URL=http://127.0.0.1:<port>`.

## Commands

- `pnpm hcb -- doctor`: run read-only diagnostics and show suggested next commands.
- `pnpm hcb -- status`: show account, sync, cache, pending mutation, MCP, and build state.
- `pnpm hcb -- log -n 20 --level warn`: show sanitized recent logs.
- `pnpm hcb -- diff --limit 20`: show pending local-to-Google mutations.
- `pnpm hcb -- show task <id>`: show one task.
- `pnpm hcb -- show event <id>`: show one event.
- `pnpm hcb -- show note <id>`: show one note.
- `pnpm hcb -- show mutation <id>`: show one pending mutation.
- `pnpm hcb -- show diagnostics`: show a diagnostics snapshot.

All commands accept `--json` for structured output. `doctor` also accepts `--log-limit <n>` and `--mutation-limit <n>`.

## Agent Workflow

1. Run `pnpm hcb -- doctor`.
2. If doctor reports account or sync issues, run `pnpm hcb -- status`.
3. If doctor reports failed or pending mutations, run `pnpm hcb -- diff`.
4. If a mutation id is shown, run `pnpm hcb -- show mutation <id>`.
5. If recent logs are flagged, run `pnpm hcb -- log --level warn` or `pnpm hcb -- log --level error`.

## Smoke Test

Run the fixture-backed CLI/MCP smoke test:

```sh
pnpm hcb:smoke
```

This starts an in-process local MCP server, writes a temporary runtime file, runs `pnpm hcb -- doctor` behavior through the CLI entry point, and removes the temp files.

## Privacy

The CLI only talks to `127.0.0.1`. It does not print bearer tokens. MCP diagnostics are sanitized by the main app services and must not expose Google OAuth tokens, Keychain material, cache encryption keys, raw credentials, or raw Google payloads.
