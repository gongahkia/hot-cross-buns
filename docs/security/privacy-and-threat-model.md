# Privacy And Threat Model

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
- task/note bodies
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

Final release-packaging decisions:

- Production CSP is injected from the main process as a response header. It uses `default-src 'none'`, `script-src 'self'`, `connect-src 'none'`, blocks frames/forms/objects, and allows `style-src 'unsafe-inline'` only for renderer-owned dynamic layout styles.
- Development CSP keeps localhost HTTP/WebSocket connections for Vite only; production does not allow renderer network connections.
- Production file navigation is limited to the loaded app document, ignoring hash changes. Development navigation is limited to the configured local dev-server origin.
- New windows are always denied. Approved external URLs are opened through the shell adapter only for the explicit allowlist: Google OAuth/API help hosts and `mailto:`.
- Renderer source is covered by a static privilege-boundary test that rejects imports from Electron, Node built-ins, main/preload aliases, SQLite, network listener modules, and command-execution modules.

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

IPC errors, public error details, diagnostics logs, and performance metadata now pass through shared redaction utilities before they are returned, logged, or persisted.

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

Final MCP request limits for release packaging:

- Browser `Origin` headers are rejected entirely. Local MCP clients should omit `Origin`; this prevents browser pages, including localhost pages, from driving the MCP endpoint.
- HTTP headers are capped at 8 KiB and bodies at 256 KiB. Extra trailing bytes, malformed JSON, wrong paths, non-local remotes, and unsupported methods are rejected before tool dispatch.
- The default rate limit is 60 requests per local client key per minute.
- Audit events record client metadata, tool name, outcome, dry-run/confirmation booleans, and redacted argument keys only. Argument values, task/event/note bodies, and bearer tokens are not recorded.

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
- retry/backoff for transient failures
- full-resync path for invalid sync tokens
- visible unresolved sync issue state

Google API errors record sanitized kind/status/retry/body-size metadata only. Raw Google error bodies and OAuth token values are not included in renderer status, IPC errors, logs, diagnostics summaries, or performance reports.

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
- No Google Drive access in v1.
- No sharing planner data with MCP clients unless explicitly requested by the user/tool.
- MCP is opt-in and local-only.

Diagnostics and performance reports expose counts, timings, status states, query-plan summaries, and redaction guarantees. They do not include raw Google payloads, OAuth credentials, MCP bearer tokens, note bodies, task notes, calendar descriptions, guest lists, or full mutation payloads. Copyable diagnostics also omit account identifiers, account email/display names, and task-list/calendar identifiers or titles; selected-resource rows use stable placeholders only. If the user disables performance diagnostics, copied summaries and the diagnostics performance endpoint omit timing samples.

## Preview Support Summary

Use this short summary in release notes and support replies for unsigned macOS preview builds:

- Hot Cross Buns 2 stores planner cache data, settings, checkpoints, diagnostics metadata, and pending mutation state on the local Mac.
- Google Tasks and Calendar use a bring-your-own Desktop OAuth client in the Mac preview. OAuth tokens, optional client secrets, and MCP bearer tokens are stored in macOS Keychain by the main process, not in renderer storage or SQLite.
- Authenticated Google sync transport and scheduling are wired for macOS preview use, but live-account QA, conflict recovery polish, and signed/notarized distribution remain release blockers.
- Notes are task-backed and sync through Google Tasks.
- The app includes no third-party analytics SDK and no hosted sync backend.
- Copyable diagnostics are sanitized and are the preferred support artifact.
- Users and maintainers must not share OAuth credentials, MCP bearer tokens, local databases, raw Google payloads, Apple signing material, or notarization secrets.

## Required Security Tests

- IPC validation rejects malformed inputs.
- Sensitive fields are redacted in errors and diagnostics.
- MCP unauthorized, malformed, oversized, and unexpected-origin requests are rejected.
- OAuth status sent to renderer excludes tokens.
- Logs generated by tests do not contain fake token fixtures.
