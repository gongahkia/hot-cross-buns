# Google Workspace integrations

## What HCB implements

- Calendar: Google Meet create requests, stored conference links, self RSVP, free/busy lookup, Drive-link attachments, Focus Time, Out of Office, and Working Location.
- Drive: searches file metadata and attaches an existing Drive `webViewLink` to a Calendar event. It does not upload, download, move, or change sharing on Drive files.
- Gmail: searches explicitly requested message metadata/snippets and creates a Task that links back to the selected Gmail thread. It never sends, edits, archives, labels, or deletes mail.
- Cross-account migration: previewable, non-destructive one-way copy. It creates new Task lists/tasks and ordinary Calendar events in a destination account. It intentionally excludes attendees, Meet links, Drive attachments, and Calendar status events.

## Fidelity and interoperability

- Calendar recurrence is HCB's canonical Google Calendar RFC 5545 line array. The event editor exposes the exact `RRULE`, `EXRULE`, `RDATE`, and `EXDATE` lines Google accepts, including property parameters such as `TZID`; it sends those lines unchanged and keeps the event start/end and IANA timezone alongside them. The simple repeat controls are an opt-in shortcut for creating a basic rule. Choosing them explicitly replaces the exact rule set on save, with a visible warning. Calendar views project exact recurrence instances in their visible window; editing one creates a native Google exception and deleting one adds a native `EXDATE`. For **this and following**, HCB partitions `RRULE`/`EXRULE` counts plus every explicit `RDATE`/`EXDATE` value, bounds the old master, creates the successor, and migrates future modified/cancelled instances. Google exposes no transaction for this operation, so HCB compensates by deleting the successor and restoring the original master if a later remote step fails.
- Google Tasks does not have HCB equivalents for priority, tags, planned start/end, duration, schedule lock, or snooze. When any are set, HCB stores a versioned footer in the task's Google-visible notes and strips it from the note shown in HCB on the next pull. Regular note text is preserved. Do not manually edit or remove that footer if the HCB planning fields should survive a reinstall or use in another HCB profile. Google limits task notes to 8,192 characters, so HCB reports a clear sync conflict instead of truncating either user text or metadata when the combined value cannot fit.

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
