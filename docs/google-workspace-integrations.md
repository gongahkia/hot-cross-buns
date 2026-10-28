# Google Workspace integrations

The current application uses browser GIS authorization and IndexedDB persistence. See [Web OAuth setup](google-browser-setup.md) for origins, scopes and live verification requirements; legacy desktop authorization instructions do not apply.

## What HCB implements

- Calendar: Google Meet create requests, stored conference links, self RSVP, free/busy lookup, Drive-link attachments, Focus Time, Out of Office, and Working Location.
- Drive: searches file metadata and attaches an existing Drive `webViewLink` to a Calendar event or a task/event description. A file selected through HCB's browser picker is uploaded resumably to a private `Hot Cross Buns attachments` Drive folder and linked in the description. HCB does not download, move, share, or delete Drive files.
- Gmail: searches explicitly requested message metadata/snippets and creates a Task that links back to the selected Gmail thread. It never sends, edits, archives, labels, or deletes mail.
- Cross-account migration: previewable, non-destructive one-way copy. It creates new Task lists/tasks and ordinary Calendar events in a destination account. It intentionally excludes attendees, Meet links, Drive attachments, and Calendar status events.

## Fidelity and interoperability

- Calendar recurrence is HCB's canonical Google Calendar RFC 5545 line array. The event editor exposes the exact `RRULE`, `EXRULE`, `RDATE`, and `EXDATE` lines Google accepts, including property parameters such as `TZID`; it sends those lines unchanged and keeps the event start/end and IANA timezone alongside them. The simple repeat controls are an opt-in shortcut for creating a basic rule. Choosing them explicitly replaces the exact rule set on save, with a visible warning. Calendar views project exact recurrence instances in their visible window; editing one creates a native Google exception and deleting one adds a native `EXDATE`. For **this and following**, HCB partitions `RRULE`/`EXRULE` counts plus every explicit `RDATE`/`EXDATE` value, bounds the old master, creates the successor, and migrates future modified/cancelled instances. Google exposes no transaction for this operation, so HCB compensates by deleting the successor and restoring the original master if a later remote step fails.
- Google Tasks does not have HCB equivalents for priority, tags, planned start/end, duration, schedule lock, or snooze. When any are set, HCB stores a versioned footer in the task's Google-visible notes and strips it from the note shown in HCB on the next pull. Regular note text is preserved. Do not manually edit or remove that footer if the HCB planning fields should survive a reinstall or use in another HCB profile. Google limits task notes to 8,192 characters, so HCB reports a clear sync conflict instead of truncating either user text or metadata when the combined value cannot fit.

## Consent model

Calendar and Tasks use the standard HCB OAuth grant. Drive and Gmail are optional and must be requested by the user in **Settings → Profile**:

- Drive linking: `https://www.googleapis.com/auth/drive.metadata.readonly`
- Drive uploads: `https://www.googleapis.com/auth/drive.file` — a narrowly scoped, non-sensitive grant used only after the user explicitly selects a local file. It lets HCB create and manage files it uses; it does not grant broad Drive access.
- Gmail capture: `https://www.googleapis.com/auth/gmail.readonly`

HCB's **Settings → Accounts → Reconfigure Google access** flow lets the user choose these capabilities per account, confirms the selection, and requests a replacement GIS token with only the selected optional scopes. The cache and queued work remain intact. Partial grants enable only authorized services. This does not revoke older application-wide Google permissions; users can manage those through Google Account connections. The maintainer must complete Google Cloud consent-screen, test-user, scope-review and verification requirements before the intended public distribution. Automated consent/transport tests do not establish live approval.

The description-reference UI is capability-aware: without the Drive metadata grant it shows no Drive search controls or Drive results; without `drive.file` it shows no local-file upload controls. The Calendar Drive-attachment picker and Gmail-capture panel follow the same rule. HCB item references remain available without either Drive scope. Users who decline an optional scope therefore see only the features their account authorized.

## Test selection for agents

| Change | Required automated test | Optional live test |
| --- | --- | --- |
| Calendar REST body, pagination, sync token, Meet, attachments, or status event | `pnpm test:unit` | Disposable account only; create and clean up dedicated resources |
| SQLite event fields or cross-account copy | `pnpm test:db` | Disposable accounts only; verify source is unchanged |
| Drive metadata search, upload, or Gmail capture UI | `pnpm test:unit`, `pnpm test:smoke` | Personal account: read-only search/render only. Disposable account: upload a dedicated disposable file, verify its private Drive link, then delete it manually if desired; capture a dedicated Gmail message as a task and delete the task |
| Browser authorization and account isolation | `pnpm test:unit`, `pnpm test:ui` | Use the configured Web OAuth client and explicitly authorized test account as described in [browser setup](google-browser-setup.md) |

Never request OAuth secrets, refresh tokens, browser cookies, passwords or Keychain exports. The old [Electron live suite](live-google-testing.md) is historical tooling, not evidence of browser authorization.

## Push webhooks are not a desktop-only feature

Google Calendar watches need a publicly reachable HTTPS webhook with a valid certificate and channel-renewal/storage policy. HCB polls while the browser application is open. No backend or closed-application synchronization is supplied by this migration.
