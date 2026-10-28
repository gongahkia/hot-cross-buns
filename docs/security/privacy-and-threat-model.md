# Browser privacy and threat model

The current product is a browser application. This section supersedes the historical desktop specification below. See [migration evidence](../web-migration.md) and [Google Web OAuth setup](../google-browser-setup.md).

- Planner content, mirrored Google records and queues live in SQLite snapshots in IndexedDB under this browser profile and origin. HCB does not encrypt these snapshots. Exports contain personal content; persistent storage is not an independent backup.
- Google access tokens live only in window/worker memory. There are no browser client secrets, refresh tokens, Keychain credentials or local MCP server. Tokens are excluded from SQL, exports, logs, URL parameters and application-shell caches. Reload/expiry requires explicit reconnection.
- GIS verifies Google's userinfo subject and checks identity when reconnecting an existing account. Partial grants enable only granted services. Optional-scope reconfiguration replaces the current token; it does not claim to revoke prior application-wide grants.
- Authorized transport restricts HTTPS API hosts, omits cookies, refuses redirects, applies response/body deadlines and never silently resends rejected mutations. Creation intent and receipts cross durable checkpoints; uncertain remote work remains visible for review.
- Worker isolation is an execution boundary, not a vault against compromised same-origin scripts. XSS could read IndexedDB, call services or use an active session. CSP and the native-runtime build guard reduce exposure; trusted dependencies and deployment origins remain essential.
- Requests use validated actions and parameterized SQL. Production excludes raw-SQL fixtures and failure hooks. External links permit HTTP/HTTPS/mailto and detach the opener. Clipboard, picker and notification requests use browser controls and user activation.
- Imports are limited to 128 MiB and staged on a separate SQLite connection with schema, integrity and relationship checks. Explicit review precedes replacement; Google queues are quarantined. Failed commits restore prior durable data and caches. WAL-dependent copies require a consistent backup.
- Offline caches contain deliberately listed application assets only, never Google API/authentication responses. Synchronization and reminders require an open application and remain subject to browser suspension. No default analytics SDK, cloud crash reporter or application backend is introduced.

Automated tests cover token exclusion, identity/account isolation, expiry/denial, remote checkpoints, failed saves/imports, multi-tab fencing and offline updates. Live OAuth project approval and real-account verification remain operator work. Browser extensions or other software with access to the profile are outside the application boundary.

## Historical desktop design (not browser runtime requirements)

Status: this document includes design targets and future platform/agent requirements. It is not a list of shipped capabilities. Local MCP/agent access and semantic search are currently unavailable; see the [current product contract](../product/current-capabilities.md).

## Security Posture

Hot Cross Buns 2 is a local-first desktop app that syncs with Google Tasks and Google Calendar. It must protect Google credentials, local personal planning data, and MCP write access.

The app ships with no third-party analytics SDK and no cloud crash reporter by default.

## Sensitive Assets

Sensitive assets include:

- Google refresh tokens
- Google access tokens
- OAuth client secrets supplied by the user
- MCP bearer token
- cache encryption keys if added later
- task notes/details
- calendar event descriptions, locations, guests
- local note bodies
- diagnostics that could reveal account or filesystem metadata

## Storage Rules

- Google tokens live in OS credential storage, not SQLite.
- MCP bearer token lives in OS credential storage, not SQLite.
- SQLite may store mirrored personal data but not credentials.
- Logs and diagnostics must redact secrets by default.
- Renderer storage must not contain credentials or raw Google responses.

## Electron Hardening

Required BrowserWindow defaults:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` unless a documented blocker exists
- preload exposes only the typed app API
- navigation blocked except approved external links opened through shell adapter
- new-window handling locked down
- Content Security Policy defined in production

Renderer dependencies must be treated as untrusted relative to local secrets.

## IPC Threats

Primary risks:

- renderer compromise calls privileged APIs
- malformed IPC payload causes unsafe service behavior
- error payload leaks secrets
- direct SQL or filesystem access slips into renderer

Controls:

- runtime validation for every preload API
- allowlisted IPC methods
- parameterized SQL only
- sanitized errors
- tests that renderer cannot import privileged modules
- no broad "execute command" IPC

## MCP Threats

Primary risks:

- local malicious process calls MCP endpoint
- browser page reaches localhost MCP endpoint
- bearer token leaks in logs
- agent performs destructive write accidentally
- oversized/malformed body causes denial of service

Controls:

- bind only to `127.0.0.1`
- require bearer token
- reject unexpected origins
- cap headers and body size
- constant-time token comparison
- rate limiting
- dry-run and confirmation for writes
- destructive writes always require confirmation
- sanitized mutation audit log

## Google API Threats

Primary risks:

- OAuth token exposure
- overbroad scopes
- logging raw API failures
- confusing sync errors causing data loss

Controls:

- least scopes for Tasks and Calendar only
- token access only in main/worker service
- no raw Google payloads in renderer diagnostics
- optional-access reconfiguration is an explicit, main-process-only revoke-and-reconnect flow; it blocks unresolved Google writes and never exposes the credential or revocation response to the renderer
- retry/backoff for transient failures
- full-resync path for invalid sync tokens
- visible unresolved sync issue state

## Local Data Threats

Primary risks:

- SQLite database reveals personal data to local users/processes
- migration corrupts cache
- queued mutation applies unexpectedly

Controls:

- store database in app support directory
- migration tests and backups before destructive changes
- mutation queue state visible in diagnostics
- confirmation for destructive data controls
- future-compatible cache encryption design

## Privacy Commitments

- No analytics by default.
- No hosted sync backend in v1.
- Optional Drive linking access searches metadata for existing links. A separate, explicit `drive.file` grant uploads only a file selected in HCB's native picker to the user's private `Hot Cross Buns attachments` folder. The renderer never receives local paths or bytes; HCB does not download, move, share, or delete Drive files.
- Optional, explicit read-only Gmail access is limited to a user-requested message metadata/snippet search and explicit Gmail-to-Task capture; HCB does not send, edit, archive, label, or delete mail.
- No sharing local notes with Google or MCP clients unless explicitly requested by the user/tool.
- MCP is opt-in and local-only.

## Required Security Tests

- IPC validation rejects malformed inputs.
- Sensitive fields are redacted in errors and diagnostics.
- MCP unauthorized, malformed, oversized, and unexpected-origin requests are rejected.
- OAuth status sent to renderer excludes tokens.
- Logs generated by tests do not contain fake token fixtures.
