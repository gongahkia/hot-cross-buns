# HCB CLI and MCP

This is the agent-facing reference for local HCB debugging and cleanup.

## CLI

Use `pnpm hcb -- <command>`. Add `--json` when a machine-readable response is better.

Read commands:

- `doctor`
- `status`
- `today`
- `week [--start-date <date>]`
- `search <query> [--scope tasks|notes|events|lists|calendars|all]`
- `list task-lists|note-lists|calendars`
- `get task|event|note <id>`
- `pending-mutations [--limit <n>]`
- `diff [--limit <n>]`
- `log [--level debug|info|warn|error] [--limit <n>]`
- `show task|event|note|mutation|diagnostics [id]`
- `undo-status`
- `export-diagnostics`

Write commands default to dry-run:

- `create task|note|event|task-list|note-list ...`
- `update task|note|event <id> ...`
- `rename task-list|note-list <id> --title <title>`
- `complete task <id>`
- `reopen task <id>`
- `move task <id> ...`
- `delete task|note|event|task-list|note-list <id>`
- `sync-now [--resources tasks,calendar] [--full]`
- `retry-mutation <id>`
- `cancel-mutation <id>`
- `undo`
- `redo`
- `schedule task <id> ...`
- `settings update --patch-json '<json>'`
- `google save-oauth-client ...`
- `google begin-oauth`
- `mcp set-enabled true|false`

Apply a write only after reviewing the dry-run:

```sh
pnpm hcb -- delete task task-id
pnpm hcb -- delete task task-id --apply --confirmation-id confirm-id
```

## MCP Tools

Read tools:

- `hcb_doctor`
- `hcb_status`
- `hcb_today`
- `hcb_week`
- `hcb_search`
- `hcb_get_task`
- `hcb_get_event`
- `hcb_get_note`
- `hcb_list_task_lists`
- `hcb_list_note_lists`
- `hcb_list_calendars`
- `hcb_pending_mutations`
- `hcb_diff`
- `hcb_log`
- `hcb_show`
- `hcb_undo_status`

Write tools:

- `hcb_create_task`
- `hcb_create_note`
- `hcb_create_event`
- `hcb_create_task_list`
- `hcb_create_note_list`
- `hcb_update_task`
- `hcb_update_note`
- `hcb_update_event`
- `hcb_rename_task_list`
- `hcb_rename_note_list`
- `hcb_complete_task`
- `hcb_reopen_task`
- `hcb_move_task`
- `hcb_delete_task`
- `hcb_delete_note`
- `hcb_delete_event`
- `hcb_delete_task_list`
- `hcb_delete_note_list`
- `hcb_sync_now`
- `hcb_retry_mutation`
- `hcb_cancel_mutation`
- `hcb_undo`
- `hcb_redo`
- `hcb_schedule_task_block`
- `hcb_settings_update`
- `hcb_google_save_oauth_client`
- `hcb_google_begin_oauth`
- `hcb_mcp_set_enabled`

Destructive tools always require confirmation: deletes, `hcb_cancel_mutation`, `hcb_undo`, and `hcb_redo`.

## MCP Resources

Static resources:

- `hcb://status`
- `hcb://doctor`
- `hcb://today`
- `hcb://week`
- `hcb://diff`
- `hcb://logs`
- `hcb://pending-mutations`

Resource templates:

- `hcb://week/{startDate}`
- `hcb://tasks/{id}`
- `hcb://events/{id}`
- `hcb://notes/{id}`
- `hcb://mutations/{id}`

## MCP Prompts

- `debug-sync`
- `inspect-pending-mutations`
- `clean-stuck-google-sync`
- `review-today`
- `plan-week`
- `prepare-support-summary`

## Debug Recipes

Sync/account issue:

```sh
pnpm hcb -- doctor
pnpm hcb -- status --json
pnpm hcb -- pending-mutations --json
pnpm hcb -- log --level warn --limit 50
```

Retry a failed queue item:

```sh
pnpm hcb -- show mutation mutation-id
pnpm hcb -- retry-mutation mutation-id
pnpm hcb -- retry-mutation mutation-id --apply --confirmation-id confirm-id
pnpm hcb -- sync-now --resources tasks,calendar
```

Cancel an obsolete queue item:

```sh
pnpm hcb -- show mutation mutation-id
pnpm hcb -- cancel-mutation mutation-id
pnpm hcb -- cancel-mutation mutation-id --apply --confirmation-id confirm-id
```
