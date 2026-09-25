# Live Google smoke testing

`pnpm test:live-google` is deliberately separate from normal local tests. It uses an existing signed-in HCB Electron user-data directory, never reads credentials from environment variables, and has two enforced modes.

Quit every HCB instance using the selected profile before running either mode. Start and sync HCB normally once first so the profile has completed setup and can access the desired Google account.

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

This mode creates, updates, then deletes one marked Task and one marked Calendar event. It only uses exactly one Task list and one Calendar with the supplied names, and both must belong to the supplied account. The test synchronizes after create, update, and cleanup; it fails if the profile already has pending mutations.

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

Every remotely-created record begins with `[HCB live smoke ...]`. If connectivity fails during cleanup, use that prefix only inside the dedicated test resources to remove leftovers, then rerun the suite.
