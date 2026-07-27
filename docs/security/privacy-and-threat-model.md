# Privacy And Threat Model

## Assets

- Google OAuth credentials and user-supplied OAuth client configuration
- task notes, event descriptions, attendees, locations, and local cache data
- pending mutations, sync checkpoints, and diagnostic summaries

## Current controls

- macOS credentials use Keychain-backed adapters and never SQLite.
- Qt Quick has no direct SQLite, token, or HTTP client access; `AppController` and C++ services validate UI requests.
- SQL uses parameter binding and multi-step writes use transactions.
- Google HTTP work has explicit timeout/cancellation and redacts tokens/error bodies from UI and diagnostics.
- Local search and sync operate on SQLite cache data; Google remains authoritative for synced rows.
- Calendar popup reminders use `UNUserNotificationCenter`; reminder state stores no OAuth credential.
- The app does not currently expose an MCP listener, browser extension, or local vault/hoster service.

## Residual risks

- A user with access to the macOS account may read unencrypted local cache data.
- An unsigned or unnotarized artifact can require Gatekeeper approval and must be verified per release.
- Live Google authorization needs user-owned OAuth configuration and redacted manual validation.

## Required tests

- credentials never enter SQLite, QML models, logs, or diagnostics
- malformed UI/Google inputs fail safely
- migrations and transactions preserve local consistency
- timeout/cancellation and shutdown paths have coverage
- redaction tests cover OAuth and HTTP errors
