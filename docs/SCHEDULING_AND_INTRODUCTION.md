# Scheduling, time and first-load introduction

The browser app detects the device's IANA time zone on first connection. It initializes the scheduling default only while that default is still `Local`; it does not overwrite an already selected zone on each visit. Change it through Settings → Your details & time zone. Existing task time zones are retained. Every native orchestrator model request, including streamed requests and routing, receives a fresh host timestamp and the user's zone. A task's explicitly selected scheduling zone governs that task's calendar dates.

## Scheduled prompts

A scheduled task retains its prompt, workspace, configured model/limits and read/draft policy. A due slot invokes the ordinary HCB agent harness: a task can involve multiple model/tool requests, rather than necessarily one HTTP request. Local and cloud models use the same scheduling boundary. A change-only project watch can skip a model call when its inputs are unchanged. Schedules cannot approve external actions, grant permissions, or silently enable CLI/computer access.

Recurring tasks store their deterministic rule as cron. One-time tasks store a distinct `run_at` instant, at minute precision. The browser displays words such as “At 8:00 PM, every weekday” or “Once on November 30, 2026 at 8:00 PM · Asia/Singapore”; it does not ask the user to read or enter cron. The Scheduled tasks panel filters All / One-time / Recurring. Existing custom rules are translated for inspection, while timing editors offer date, time, weekday and day-of-month controls. Monthly days absent from a month are skipped. Ambiguous or nonexistent daylight-saving times in the one-time editor require a different time or an explicitly offset conversational request.

Foreground chats can manage scheduled tasks directly through the existing app controller. The agent can list/search saved tasks across this local profile, inspect a complete prompt, create a one-time or recurring prompt, edit timing or prompt, pause, resume, and cancel. Inspection is read-only. Creation binds the current workspace and original chat on the host. Edits preserve the existing workspace, model, budgets, account pins and execution permissions; changing execution authority is a separate operation. Cancellation removes future scheduling while retaining history and the original chat. An already-started run may finish.

Schedule management defaults to **Ask**. Its inline review shows the task, prompt, readable timing, workspace and retained limits. **Allow once** approves that exact mutation; **Always allow scheduling** permits future foreground schedule changes until revoked in Settings → Permissions. Returning to Ask does not pause or cancel tasks already scheduled. These choices do not grant file, account, browser, computer, CLI or external-action access to a scheduled run. Unattended tasks do not receive the foreground app-management tools.

The host binds approvals to the exact review and current permission revision. Permission changes while review is pending invalidate that operation. Editing/canceling a task also requires its current policy digest; concurrent edits are rejected while scheduler bookkeeping can advance independently. Identical creation delivery within the same host run reuses its identity rather than duplicating or reviving a changed task. An Always choice is a persistent grant in its own right, even if the particular target subsequently fails validation.

The agent inspects `schedules` and uses the app controller's `schedule` operation for direct management; these are internal tool fields, not slash commands the person must run. Existing interval-based follow-up controls use the same schedule permission choices. More specialized goal-watch source/notification edits retain their existing agreement and account checks. Background suggestion tools remain available as a reviewed fallback, and existing pending schedule proposals remain pending until accepted. Viewing a proposal does not activate it.

Task-management wording such as “create a reminder” is semantically classified before generic document-creation heuristics, so saving a reminder does not force a Markdown deliverable. Explicitly selected artifact outputs still retain their contracts. The scheduled-task list refreshes when a foreground schedule change completes. Approval details scroll independently so the three permission choices remain visible on small screens.

## Returning after downtime

Recurring schedules support a deterministic inclusive `starts_at` and exclusive
`ends_at` window. Chat and the timing editor show these boundaries in words and
preview upcoming eligible runs. An inclusive final calendar day is represented
by the following midnight in that task's timezone. Bounds are enforced by due
selection, catch-up, occurrence previews and slot claiming; they are not merely
instructions in a model prompt. Editing a boundary invalidates stale reviews.

Chat-created schedules can explicitly bind selected connections and exact
`read_operations`, inspect/draft mode, per-run request/token/time limits and an
enabled parameterized routine's exact revision. These access changes always
receive a fresh review even with Always scheduling. Account/descriptor changes,
revocation and disabled/changed/stale-source routines invalidate continued use.
Routine execution narrows the ordinary task's effects and budgets; it grants no
additional tools. Scheduled drafts stay staged for foreground review. Notification
conditions use the existing evidence-checked quiet/attention decision; creating
an artifact or proposal cannot be silently classified as quiet.

## Event-triggered work

An event task uses `trigger: {types: [...], match: {field: "exact value"}}` instead
of a timer. Matching is deliberately narrow: declared event types and exact
top-level string fields. In Scheduled tasks choose **Event endpoint**, review
the task, and enable its signed endpoint. The signing key is shown once in a
password field for copying; rotate or disable it there. Keys never enter agent
tool results, URLs, SSE or task arguments. This remains a desktop integration;
the server binds loopback, and remote services require an intentionally configured
forwarding route. No router port or public server is created automatically.

Send JSON `{type, data}` with headers `X-HCB-Timestamp` (Unix seconds),
`X-HCB-Event-ID` (unique delivery identity) and `X-HCB-Signature`: hex HMAC-SHA256
using the key over `timestamp + "." + eventID + "." + exactRequestBytes`.
Timestamps must be within five minutes. The endpoint rechecks the exact reviewed
task policy, enabled/end state and filters before accepting data. Editing its
policy requires reviewing the endpoint again. The existing supervisor admits
queued work on its next tick; it batches up to eight events with at most one
claimed batch per task per minute. Execution retains the normal limits and
read/draft permissions, and data is explicitly untrusted model context.

Delivery identities survive restart and interrupted attempts retain their input
in the durable intent. They are not silently replayed as new work. Replay
identities are kept for thirty days, bounded to 4096 deliveries and 64 pending
inputs per task; exhausted capacity rejects new input. Claimed payloads remain
in immutable attempt history while their queue copy is reduced to metadata.
Pausing/ending a task rejects new input. Disabling an endpoint stops new admission;
already accepted work remains subject to the saved task state and permissions.
Neither a queued input nor a completed run establishes successful external delivery.

The normal `web/main.mjs` entry point starts the Go job supervisor while the server is open. A separately installed, already-running supervisor keeps ownership; the browser does not terminate that external service. The browser stops only a supervisor process it started. Closing a browser tab alone does not close the server.

The supervisor checks due work on startup and every 15 seconds. It also retains availability gaps, scheduled times, immutable attempt records and notification delivery state. New in-app tasks use `run_once` catch-up. Existing tasks retain their reviewed missed-run policy; the timing editor can change that policy explicitly.

When a recurring task has several missed slots, HCB coalesces them into the latest eligible slot and runs one catch-up prompt. It does not replay a long backlog on successive ticks. A one-time task remains due after downtime until its slot is claimed, unless explicitly configured to skip missed work. Slot claims survive restart. An interrupted/failed attempt is retained for recovery rather than being silently replayed as a fresh automatic execution.

Scheduled Work receives both its original scheduled time and its actual start time. A late result has a deterministic “Delayed by …” prefix in its retained update. The task panel marks due work as overdue. This records actual delay; it does not claim HCB delivered anything while the laptop was asleep.

HCB does not wake a sleeping laptop or execute while its backend/service is stopped. Work and notifications resume when the machine and service return, subject to saved permissions, pause/end boundaries, account availability and usage limits. Ended schedules do not gain permission for new model checks after their end boundary. Existing notification retry/deduplication remains in force. A schedule claim is not a guarantee of successful delivery or exactly-once external effects.

## One-time introduction in chat

On first browser connection, HCB posts a welcome in the selected chat and asks only for a missing basic. The user replies through the normal composer. Follow-up questions come from the configured orchestrator, one question at a time, about preferred name, reply style and current projects/help. Several answers can be supplied together; the introduction accepts omissions, corrections, skipping, and moving on to ordinary work. No setup form opens automatically. Settings → Your details & time zone remains a manual profile and timezone editor.

The host retains the welcome's owning conversation and time. Reopening the app restores that same welcome and any pending summary without creating another onboarding session. The browser places the welcome at its original time, including after completion or skipping, rather than after newer work. Its position in the backend message array remains unchanged so approval indexes keep referring to the same messages. Other chats do not receive its draft or greeting. A completed or skipped introduction does not restart automatically, and already-known basics are not requested again.

Answers stay in the conversation until HCB offers one combined memory summary. Proposed values must quote actual user messages from this onboarding session, never another chat, a file, assistant wording or a generated fact. The normal whole-message credential and do-not-remember exclusions still apply. The host displays the exact proposed words; an affirmative reply such as “yes please” saves the batch. A correction or other new answer discards the old review before asking again. Changed profile revisions invalidate the proposal, and the conversation can recover with a new review. Saving again does not add duplicate profile records. Source history, withdrawal and retrieval invalidation remain in force.

The welcome is host-authored; the questions and follow-ups use the real selected model. Confirmation and memory writes are host-controlled. An unanswered question or model error does not become a memory. API usage for the conversation is recorded under onboarding. Settings-only edits and timezone detection do not require model requests.

This is not a policy of saving every conversation. The general model is instructed to collect related useful facts and necessary clarifications before capturing them, and not narrate a memory update after every reply. Ordinary memory tools still require eligible, attributable user evidence; they do not gain permission to infer facts from historical summaries. The onboarding batch is a narrowly scoped, explicitly confirmed intake.

## Header icons and command access

All four activity controls use icons without visible labels. Review appears only with pending proposals; Scheduled tasks appears while saved task definitions exist, including while the scheduler is offline; Delegated work appears with live delegated work; Agents appears with at least two live agents. Completed delegated history does not keep those live-activity icons visible. Each panel remains available through Cmd/Ctrl+K even when its header icon is hidden. Accessible names and hover tooltips remain available.
