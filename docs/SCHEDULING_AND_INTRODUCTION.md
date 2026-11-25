# Scheduling, time and first-load introduction

The browser app detects the device's IANA time zone on first connection. It initializes the scheduling default only while that default is still `Local`; it does not overwrite an already selected zone on each visit. Change it through Settings → Your details & time zone. Existing task time zones are retained. Every native orchestrator model request, including streamed requests and routing, receives a fresh host timestamp and the user's zone. A task's explicitly selected scheduling zone governs that task's calendar dates.

## Scheduled prompts

A scheduled task retains its prompt, workspace, configured model/limits and read/draft policy. A due slot invokes the ordinary HCB agent harness: a task can involve multiple model/tool requests, rather than necessarily one HTTP request. Local and cloud models use the same scheduling boundary. A change-only project watch can skip a model call when its inputs are unchanged. Schedules cannot approve external actions, grant permissions, or silently enable CLI/computer access.

Recurring tasks store their deterministic rule as cron. One-time tasks store a distinct `run_at` instant, at minute precision. The browser displays words such as “At 8:00 PM, every weekday” or “Once on November 30, 2026 at 8:00 PM · Asia/Singapore”; it does not ask the user to read or enter cron. The Scheduled tasks panel filters All / One-time / Recurring. Existing custom rules are translated for inspection, while timing editors offer date, time, weekday and day-of-month controls. Monthly days absent from a month are skipped. Ambiguous or nonexistent daylight-saving times in the one-time editor require a different time or an explicitly offset conversational request.

The reviewed proposal tool can create a standalone schedule without inventing a goal. Use `run_at` for a one-time task, or `cron` for a recurring task; never both. Set `ends_at` for a bounded recurring series. Those fields are host data, not user-facing syntax. The proposal's source and originating chat are captured by the host. Accepting its exact revision creates the task; merely viewing the proposal does not activate it. Task timing and prompt edits use a computed review and preserve existing model, limits, account pins and permissions.

## Returning after downtime

The normal `web/main.mjs` entry point starts the Go job supervisor while the server is open. A separately installed, already-running supervisor keeps ownership; the browser does not terminate that external service. The browser stops only a supervisor process it started. Closing a browser tab alone does not close the server.

The supervisor checks due work on startup and every 15 seconds. It also retains availability gaps, scheduled times, immutable attempt records and notification delivery state. New in-app tasks use `run_once` catch-up. Existing tasks retain their reviewed missed-run policy; the timing editor can change that policy explicitly.

When a recurring task has several missed slots, HCB coalesces them into the latest eligible slot and runs one catch-up prompt. It does not replay a long backlog on successive ticks. A one-time task remains due after downtime until its slot is claimed, unless explicitly configured to skip missed work. Slot claims survive restart. An interrupted/failed attempt is retained for recovery rather than being silently replayed as a fresh automatic execution.

Scheduled Work receives both its original scheduled time and its actual start time. A late result has a deterministic “Delayed by …” prefix in its retained update. The task panel marks due work as overdue. This records actual delay; it does not claim HCB delivered anything while the laptop was asleep.

HCB does not wake a sleeping laptop or execute while its backend/service is stopped. Work and notifications resume when the machine and service return, subject to saved permissions, pause/end boundaries, account availability and usage limits. Ended schedules do not gain permission for new model checks after their end boundary. Existing notification retry/deduplication remains in force. A schedule claim is not a guarantee of successful delivery or exactly-once external effects.

## One-time introduction in chat

On first browser connection, HCB posts a welcome in the selected chat and asks only for a missing basic. The user replies through the normal composer. Follow-up questions come from the configured orchestrator, one question at a time, about preferred name, reply style and current projects/help. Several answers can be supplied together; the introduction accepts omissions, corrections, skipping, and moving on to ordinary work. No setup form opens automatically. Settings → Your details & time zone remains a manual profile and timezone editor.

The host retains the welcome's owning conversation and time. Reopening the app restores that same welcome and any pending summary without creating another onboarding session. Other chats do not receive its draft or greeting. A completed or skipped introduction does not restart automatically, and already-known basics are not requested again.

Answers stay in the conversation until HCB offers one combined memory summary. Proposed values must quote actual user messages from this onboarding session, never another chat, a file, assistant wording or a generated fact. The normal whole-message credential and do-not-remember exclusions still apply. The host displays the exact proposed words; an affirmative reply such as “yes please” saves the batch. A correction or other new answer discards the old review before asking again. Changed profile revisions invalidate the proposal, and the conversation can recover with a new review. Saving again does not add duplicate profile records. Source history, withdrawal and retrieval invalidation remain in force.

The welcome is host-authored; the questions and follow-ups use the real selected model. Confirmation and memory writes are host-controlled. An unanswered question or model error does not become a memory. API usage for the conversation is recorded under onboarding. Settings-only edits and timezone detection do not require model requests.

This is not a policy of saving every conversation. The general model is instructed to collect related useful facts and necessary clarifications before capturing them, and not narrate a memory update after every reply. Ordinary memory tools still require eligible, attributable user evidence; they do not gain permission to infer facts from historical summaries. The onboarding batch is a narrowly scoped, explicitly confirmed intake.

## Header icons and command access

All four activity controls use icons without visible labels. Review appears only with pending proposals; Scheduled tasks appears while saved task definitions exist, including while the scheduler is offline; Delegated work appears with live delegated work; Agents appears with at least two live agents. Completed delegated history does not keep those live-activity icons visible. Each panel remains available through Cmd/Ctrl+K even when its header icon is hidden. Accessible names and hover tooltips remain available.
