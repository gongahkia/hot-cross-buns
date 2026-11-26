# Task conversations

HCB remains one assistant with one main conversation. Its wordmark menu includes
a searchable, scrollable **Tasks** list containing only conversations created by
the main assistant. Ordinary legacy chats remain available through Cmd/Ctrl-P.
Opening a task shows its own history and composer; Back to HCB returns home.

For a clear follow-up to a completed task, the conversational router can choose
`continue` with that exact task ID. Ambiguous references should produce a short
clarifying question; unrelated requests become separate work. Semantic routing
is model-dependent, not a deterministic topic classifier.

The native owner validates the original task provenance and workspace, checks
that the task has no unfinished request/review, binds the new parent turn to the
existing task, and admits it once. Continuation preserves the original task's
captured execution options and account scope. New files and planning requests
need a separate scope/review transition. Each write still needs its normal
approval; continuation is not permission. Interrupted or unconfirmed dispatches
are not automatically replayed.

The new prompt and answer appear in the task's retained request/revision history
and the main conversation. Each parent exchange reads its own result revision;
a later follow-up does not replace earlier answers. Replies entered directly
inside a completed task use that task's ordinary work path rather than creating nested
conversations. Existing main-chat answers are not retrospectively reassigned.

The task list filters validated canonical provenance before pagination. It uses
bounded local file reads, while the existing general past-work search retains
its SQLite index. This keeps a display cache from asserting task ownership;
large histories still have the catalog's documented read/size limits.

Verification includes native continuation/admission/retry tests, preserved
scope and results, direct task replies, task-only search, and an opt-in live
orchestrator routing evaluation (`HOT_CROSS_BUNS_LIVE_ROUTING=1`). The live check
covers Iran-war and Tokyo-trip follow-ups plus unrelated filesystem work and an ambiguous reference that should clarify. It
checks routing only and does not send messages or change external accounts.
