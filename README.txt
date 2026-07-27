I've learned a lot by looking at other people's code, so maybe someone can learn something from looking at mine.

= = = = = = = = =

Hot Cross Buns is a small desktop client for Google Calendar and Google Tasks.

It keeps a local SQLite cache for fast startup and offline work, then syncs
tasks, calendars, events, and queued mutations with Google. Notes are an
optional local presentation of ordinary Google Tasks with no due date.

You can create, edit, complete, move, reorder, bulk-edit, and delete Tasks;
create, edit, move, resize, bulk-edit, and delete Calendar events; and work
with Google-supported Calendar recurrence. HCB-managed recurring Tasks use a
visible marker in the Google Task notes field.

For more information, see: docs/README.md

= = = = = = = = =

Build on macOS with Homebrew Qt, CMake, Ninja, and LLVM:

  make build
  make test
  make format

Each tester supplies a Google Cloud Desktop OAuth client ID in Settings. Enable
Google Tasks API and Google Calendar API, add the test account to the OAuth
consent screen where required, save the client ID, then select Connect Google.
HCB uses a temporary localhost callback and does not accept a client secret.

Real-account acceptance and macOS distribution are still release blockers.
Linux and Windows parity are deferred until those macOS gates pass.
