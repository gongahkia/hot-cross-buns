# Hot Cross Buns MCP

Hot Cross Buns can expose a local Model Context Protocol endpoint for agent clients that you explicitly configure on this Mac.

## Enable

1. Open Hot Cross Buns Settings.
2. Go to General -> Agent access.
3. Turn on Local MCP server.
4. Choose a permission mode.
5. Copy the client config and paste it into your MCP client.

The endpoint is:

```text
http://127.0.0.1:<port>/mcp
```

Requests must include:

```text
Authorization: Bearer <generated-token>
```

The token is stored in the macOS Keychain. Reset it from Settings if a client config is no longer trusted.

## Permissions

- Read-only: clients can search and read tasks, notes, events, lists, and calendars.
- Confirm writes: clients must dry-run a write and pass back the returned `confirmationId` before it applies.
- Allow writes: non-destructive writes can apply directly; delete tools still require dry-run confirmation.

Every write tool accepts `dryRun`. Dry-runs return the planned item payload without changing local state or Google-backed data.

## Tools

Read tools:

- `hcb_search`
- `hcb_today`
- `hcb_week`
- `hcb_get_task`
- `hcb_get_event`
- `hcb_list_task_lists`
- `hcb_list_calendars`

Write tools:

- `hcb_create_task`
- `hcb_create_note`
- `hcb_create_event`
- `hcb_update_task`
- `hcb_update_event`
- `hcb_complete_task`
- `hcb_reopen_task`
- `hcb_move_task`
- `hcb_delete_task`
- `hcb_delete_event`

Tool responses include `applied`, `dryRun`, `requiresConfirmation`, optional `confirmationId`, `message`, and sanitized `item` or `items`. Task and event responses include `hotcrossbuns://` deep links for review in the app.

## Privacy

The MCP server binds only to `127.0.0.1`. It rejects non-local connections and unexpected browser origins. It does not return Google OAuth tokens, cache encryption keys, Keychain material, raw credential config, or raw Google diagnostic payloads.

## OpenClaw-style setup

Use the copied Settings config when your client accepts HTTP MCP servers. For clients that manage MCP entries by command, configure the URL as:

```text
http://127.0.0.1:<port>/mcp
```

and add the copied `Authorization` header. Keep Hot Cross Buns running while the client connects.

## Transport notes

This v1 implements simple Streamable HTTP-style JSON-RPC request/response over `POST /mcp`. It returns `405 Method Not Allowed` for `GET`; SSE and server-initiated streaming are not implemented yet.
