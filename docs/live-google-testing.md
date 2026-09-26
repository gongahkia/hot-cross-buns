# Live Google smoke testing

`pnpm test:live-google` is deliberately separate from normal local tests. It uses an existing signed-in HCB Electron user-data directory, never reads credentials from environment variables, and has two enforced modes.

Quit every HCB instance using the selected profile before running either mode. Start and sync HCB normally once first so the profile has completed setup and can access the desired Google account.

## Agent decision rule

| Situation | Allowed suite | Agent action |
| --- | --- | --- |
| No signed-in profile, no explicit request to run live tests, or account type is unclear | None | Do not run live tests. Ask the user to choose a mode. |
| Personal, production, or otherwise-used Google account | `read-only` only | Run only the read-only command. Never substitute mutating mode, even if test resources exist. |
| Disposable Google account the user explicitly authorizes for mutation testing | `mutating` | Require the exact acknowledgement plus dedicated Task-list and Calendar names before running. |

Never request, paste, log, or accept a Google password, OAuth client secret, refresh token, access token, browser cookie, or Keychain export. The test uses the existing signed-in Electron profile only.

## Read-only mode — use for your real account

This mode runs a Google pull with `readOnly: true`, reads Task/Calendar data through HCB, and checks that the connected account renders in Settings. It blocks Task/Calendar mutations, OAuth lifecycle actions, full syncs, and ordinary syncs at the main-process IPC boundary. Automatic startup/background sync is also disabled.

It will update HCB's local cache and sync tokens after the read-only Google pull, but it never delivers the local outbox or changes a Google resource.

```bash
HCB_LIVE_GOOGLE_TEST_MODE=read-only \
HCB_LIVE_GOOGLE_PROFILE_DIR=/absolute/path/to/hcb-user-data \
HCB_LIVE_GOOGLE_TEST_ACCOUNT_EMAIL=you@example.com \
pnpm test:live-google
```

## Mutating mode — use only for a disposable account

This mode runs five checks: a read/render check, a direct create/update/delete round trip for one marked Task and Calendar event, a supported-metadata round trip, a timed three-run create/update/sync/cleanup benchmark, and the Command Palette Quick Add path for both an event and a task. The metadata check verifies Calendar description, location, guest, reminder, timezone, color, visibility, transparency, and canonical Google recurrence lines, plus HCB task-planning metadata stored in Google Tasks notes. Quick Add intentionally opens the existing full editor, which then saves and syncs the item.

It only uses exactly one Task list and one Calendar with the supplied names, and both must belong to the supplied account. Every mutating check uses a unique `[HCB live smoke ...]` title, synchronizes after writes and cleanup, and asserts that no active marked record or queued mutation remains. If an earlier run was interrupted, the suite may recover and remove only a marked record in those exact dedicated resources before starting a new run.

Create dedicated, otherwise-empty resources in the disposable account first, for example `HCB Smoke Tasks` and `HCB Smoke Calendar`. Never point this mode at a personal or production account.

```bash
HCB_LIVE_GOOGLE_TEST_MODE=mutating \
HCB_LIVE_GOOGLE_PROFILE_DIR=/absolute/path/to/hcb-user-data \
HCB_LIVE_GOOGLE_TEST_ACCOUNT_EMAIL=unused-google-account@example.com \
HCB_LIVE_GOOGLE_TEST_TASK_LIST_NAME='HCB Smoke Tasks' \
HCB_LIVE_GOOGLE_TEST_CALENDAR_NAME='HCB Smoke Calendar' \
HCB_LIVE_GOOGLE_TEST_MUTATION_ACK=I_UNDERSTAND_HCB_LIVE_TEST_WRITES_AND_DELETES \
pnpm test:live-google
```

Every remotely-created record begins with `[HCB live smoke ...]`. If connectivity fails during cleanup, use that prefix only inside the dedicated test resources to remove leftovers, then rerun the suite. Google Tasks and HCB retain deleted-task tombstones for sync reconciliation; these are not active tasks or queued writes.
