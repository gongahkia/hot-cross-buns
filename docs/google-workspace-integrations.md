# Google Workspace integrations

## What HCB implements

- Calendar: Google Meet create requests, stored conference links, self RSVP, free/busy lookup, Drive-link attachments, Focus Time, Out of Office, and Working Location.
- Drive: searches file metadata and attaches an existing Drive `webViewLink` to a Calendar event. It does not upload, download, move, or change sharing on Drive files.
- Gmail: searches explicitly requested message metadata/snippets and creates a Task that links back to the selected Gmail thread. It never sends, edits, archives, labels, or deletes mail.
- Cross-account migration: previewable, non-destructive one-way copy. It creates new Task lists/tasks and ordinary Calendar events in a destination account. It intentionally excludes attendees, Meet links, Drive attachments, and Calendar status events.

## Consent model

Calendar and Tasks use the standard HCB OAuth grant. Drive and Gmail are optional and must be requested by the user in **Settings → Profile**:

- Drive attachments: `https://www.googleapis.com/auth/drive.metadata.readonly`
- Gmail capture: `https://www.googleapis.com/auth/gmail.readonly`

HCB requests these only when the user selects an enable button. They are read-only scopes, but Google classifies some Workspace scopes as sensitive or restricted. Do not claim public distribution is ready until the maintainer has completed the relevant Google Cloud consent-screen, test-user, scope-review, and verification work for the chosen distribution model.

## Test selection for agents

| Change | Required automated test | Optional live test |
| --- | --- | --- |
| Calendar REST body, pagination, sync token, Meet, attachments, or status event | `pnpm test:unit` | Disposable account only; create and clean up dedicated resources |
| SQLite event fields or cross-account copy | `pnpm test:db` | Disposable accounts only; verify source is unchanged |
| Drive metadata search or Gmail capture UI | `pnpm test:unit`, `pnpm test:smoke` | Personal account: read-only search/render only. Disposable account: capture a dedicated test message as a task and delete the task |
| Any signed-in profile | none by default | Follow [Live Google testing](live-google-testing.md) exactly |

Never request OAuth secrets, refresh tokens, browser cookies, passwords, or Keychain exports. The live suite operates through a user-owned existing Electron profile.

## Push webhooks are not a desktop-only feature

Google Calendar watches need a publicly reachable HTTPS webhook with a valid certificate and channel-renewal/storage policy. HCB currently polls. Adding a watch endpoint requires a user-controlled hosted relay, a privacy policy for callback metadata, secret/channel lifecycle design, and an explicit deployment decision; do not add an arbitrary internet endpoint to the Electron process.
