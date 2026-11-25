# Browser command discoverability audit — 2026-11-25

## Scope and method

Reviewed the current browser entry point, all 66 registered command-palette entries, the gateway action/route allowlists, managed-host bridge panels, command result presentation, relevant controllers, and tool-generated next-step text. Traced whether each workflow has a visible entry point, contextual next action, usable form/review, and status/error feedback. This is a code audit, not a claim that every account, OS capability, CLI, or background integration was exercised live. Historical Electron/terminal documentation is not evidence of browser coverage.

A backend slash command behind a correctly labeled button is implementation reuse, not a UX gap. A raw command/ID that the user must discover, type, or copy to make progress is a gap. “Partly covered” means a usable UI exists for some operations, with the missing operation identified below.

## Fixed in this change

- Durable proposals now have **Review** in the top bar, a pending count, full inspection, source-integrity checks, and explicit Accept/Reject buttons. Also reachable from the chat menu, Settings, and the command palette. Opening does not apply anything. Decisions use the inspected revision; stale or resolved proposals cannot be accepted again.
- Memory approval reasons appear beside **Review action**, rather than merely looking like a long-running tool. Casual project statements are recognized; registered project facts appear under Project context without needing a formal goal.
- Every Memory category has a local Markdown view, with its path exposed in that category. Existing editable memory/note text can be corrected there; managed approval state stays separate. See MEMORY_MARKDOWN_FILES.md for the exact editing contract.

The durable review queue represents `/suggestions`. Foreground action approvals and execution-plan questions remain in their owning chat. Memory candidates remain in Memory → Suggestions. These are currently separate review surfaces, not a unified all-approvals inbox.

## Remaining findings, ordered by impact

| Priority | Workflow and current entry | What is obscured or incomplete | Recommended UI |
| --- | --- | --- | --- |
| P1 | Follow-up results: `/inbox`; task updates may appear in chats | The Inbox list/detail/read/rating panels exist, but the main browser menu, Settings and custom Cmd/Ctrl+K inventory do not expose Inbox. No top-level unread-results destination. A scheduled check can produce something users cannot easily find. | Results/Inbox destination with unread badge; notification opens the exact retained result; explicit read/rating actions. |
| P1 | Daily orientation: `/overview` | A substantial dashboard already exists with changes, decisions, next steps and blockers. Its controller even opens results, suggestions and plans. Browser navigation does not provide a normal entry. | A visible Overview destination, opening existing guarded controller actions; link suggestions to the new queue rather than a command report. |
| P1 | Completed work: `/review`, `/save`, `/apply`, `/retry` | Artifact downloads are visible. Saving verified deliverables into a chosen folder and initially applying a verified patch still start from commands. Bundle summaries explicitly instruct the user to use those commands. History has some review/retry controls, so retry is not universally command-only. Downloading an artifact is not the same as saving/applying its verified change set. | Completed-task card with Preview, Save to folder and Review patch actions; exact diff/target review; existing delivery receipt and safe retry controls. |
| P1 | Message queue: `/queue`, `/dequeue`, `/clear-queue` | The composer shows “N queued”, but its dialog is a text-only list. The bridge already supports edit/remove/earlier/later/move/run/guide, while the browser shows none of those controls. | Editable queued-message rows with removal and ordering controls, bound to existing queue identity/revision guards. |
| P1 | Ordinary/advanced schedules: `/jobs ...` | The clock panel supports inspection and pause/resume. Reviewed project-check creation/editing has forms. Generic advanced jobs fall back to “Edit it with /jobs edit ID”; the jobs panel's create hint is itself `/jobs add`. Job history, deletion and complex timing are not fully covered by that panel. | Extend the existing schedule form to supported cron/calendar timing, show readable timing plus raw rule under details, and expose run history/delete with review. |
| P2 | Goal plan/calendar: `/agenda`, `/plan`, `/activity`, `/notifications` | Goals are reachable through Scheduled tasks → Ongoing responsibilities, and inspected plan data exists. That does not provide a full plan editor, agenda, recurrence/occurrence editor, goal activity view or notification/quiet-hour editor. The execution-plan approval UI is a different concept from a persistent goal plan. | Goal detail tabs for Plan, Agenda, Activity and Alerts; create/edit/review forms that preserve expected plan revisions. |
| P2 | Feedback and learning: `/feedback ...` | Emoji reactions and reply/copy/fork controls exist. They do not replace useful/wrong/do-not-learn feedback or a reviewable correction/remember workflow. Guidance management is reachable indirectly through Memory → Guidance. | Explicit answer feedback controls, optional explanation and correction, with visible learning consequences. Keep reactions conversational. |
| P2 | Retained history: `/history`; archived conversations | Chat browsing/search and task inspection exist, but an all-run status/history view and archive/trash/restore management are not ordinary browser destinations. Active-chat search alone is not full retention management. | History destination with explicit scope/status/archive filters and guarded restore/archive controls. |
| P2 | Task authority/output requirements: `/mode`, `/artifact`, `/web-origin` | Composer model/effort selection and permission reviews are visible. Preselecting inspect/draft/act, required output paths and a bounded next-task web-origin policy still needs commands or a conversational request. These affect execution, not just appearance. | A compact task-options sheet near the composer; show the captured mode, deliverable contract and source policy on the exact task review. |
| P2 | Project instructions: `/source-refresh`, `/source ignore`, `/source unignore`, `/source ignored` | Workspace selection is visible. It does not expose all snapshot refresh and per-conversation ignored-instruction management. | Workspace → Instructions list with included/ignored state, inspect and restore actions; explicit refresh snapshot action. |
| P2 | Notes/skills: `/note ...`, `/skill ...` | Memory/Saved browsing, note correction/forgetting, routine management and conversational proposals exist. Saved notes has no full dedicated manual note-creation/editor flow; skill authoring/editing is not equivalent to browsing/activating an existing routine. | Notes editor and procedure authoring/revision review, preserving source dependencies and activation controls. |
| P2 | Specialist control: `/agents`, `/tasks`, `/steer-task`, `/cancel-task`, `/steer` | Activity/Agents inspectors show state, step facts and retained output; opening the owning chat and its top-level Stop is supported. Fine-grained worker steering/cancellation is not presented as direct per-worker controls. Conversational guidance covers some top-level steering. | Per-agent inspect, stop and guide controls on exact live task identities; clearly distinguish local CLI output from public summaries. |
| P2 | Configuration of vendor CLIs | Models → CLI agents is a configuration/status inventory. It is not an enrollment/authentication/settings editor. Local CLI installation/sign-in and some external setup still require the terminal or local configuration. | A provider-specific setup/readiness screen with exact missing prerequisites and a safe terminal handoff where required. Do not imply an available logo means authentication works. |
| P3 | Diagnostics: `/status`, `/doctor`, `/help` | Existing model readiness and Settings cover subsets. Full diagnostics and help lack a clear ordinary browser entry. | Help & diagnostics in Settings with exact actionable checks, copyable redacted report, and repair links. |
| P3 | Revision navigation: `/revision-back`, `/revision-forward` | Chat history and response branching exist; they do not expose a conversation revision timeline or previous/next revision controls. | Revision history with read-only inspection and explicit branch/open actions; avoid silent scope changes. |
| P3 | Appearance: `/appearance`, `/theme` | Backend appearance panels are not evidence that the browser consumes every terminal preference. No ordinary browser Appearance entry is visible. | Browser-specific appearance controls wired to browser tokens, or clearly identify terminal-only options instead of advertising parity. |
| P3 | Evaluation tooling: `/pilot` | Internal follow-up pilot/reporting controls are intentionally advanced and still command-driven. | Keep in an explicitly labeled advanced/developer area; it need not occupy normal personal-assistant navigation. |

## Flows that already have real UI

New/main chat and chat search; workspace selection and attachments; model/provider/effort selection; memory browse/add/correct/forget/pin/snooze and candidate review; routine activation management; connected-account/permission setup; browser/computer access controls; usage/limits; data/backups; foreground action approvals and plan questions; stop/recovery; artifact download and response copy/reply/fork; scheduled project-check setup and basic schedule controls. These reuse backend panels/actions and should not be rebuilt merely because their implementation invokes a command.

Two qualification points: a recovery screen being present does not prove every initial delivery action is discoverable; a settings screen being present does not make an integration's missing OS/account capability available.

## Root causes

1. `web/public/client.mjs:paletteCommands` enumerates a small manual list plus `[data-route]` buttons; it is not an automatic, friendly mirror of all registered backend commands.
2. `renderPanel` correctly converts many typed rows, fields and letter-key hints into buttons. `describeResult`, however, renders arbitrary lines/footers as prose, including commands; that generic report cannot invent safe review controls.
3. Discovery is spread among the chat menu, Settings, clock popover, activity panels and contextual actions. Available backend projections for overview/following/inbox do not automatically create navigation.
4. Several legacy command handlers return CLI usage or “continue in terminal” text even when reached from a browser-usable controller.
5. A paused human review and an executing tool share a row whose state may still say running. Reasons and current next actions need to be attached to the actual paused operation.

Do not solve this by detecting arbitrary `/commands` in model text and automatically making them executable. Expose typed host actions with original scope, expected version, explicit reviews and confirmed outcomes.

## Evidence map

- Command registry and bundle delivery instructions: `internal/workapp/commands.go` (`commandPaletteEntries`, `prepareBundleSave`, `prepareCodeApply`, `formatBundleSummary`).
- Actual browser navigation, result rendering and next actions: `web/public/index.html`, `views.mjs`, `client.mjs` (`navigate`, `renderPanel`, `describeResult`, `renderWork`, `paletteCommands`).
- Follow-up result controls: `internal/workapp/inbox.go`, `bridge_panel.go`; overview controller: `cmd/hot-cross-buns/work_overview.go`.
- Schedule gaps: `internal/workapp/followup.go:editFollowup`, jobs section of `bridge_panel.go`, `web/public/scheduled.mjs`.
- Existing queue capability: `internal/workapp/bridge_queue.go`; browser read-only queue dialog: `client.mjs:renderWork`.
- Scope-preserving goal data: `internal/workapp/bridge_goals.go`; plan/agenda/notification commands: `commands.go` and `cmd/hot-cross-buns/command_goal.go`.
- Memory/note/guidance/routine controls: `web/public/memory.mjs`, `internal/personalization/catalog.go`, `internal/workapp/learnings.go`, `bridge_panel.go`.
- Inspector limitations: `web/public/task-inspector.mjs`; frontend account/model inventory: `models-view.mjs`.

## Full registered-command inventory

The following inventory was extracted from `commandPaletteEntries`; every entry was considered in the workflow groups above or the already-covered UI list. Slash entry points are retained for keyboard/CLI users; removing them is not part of this work.

- `/help`
- `/new`
- `/model`
- `/source`
- `/mode`
- `/attach`
- `/detach`
- `/status`
- `/settings`
- `/appearance`
- `/theme`
- `/doctor`
- `/history`
- `/jobs`
- `/inbox`
- `/goals`
- `/followup`
- `/overview`
- `/permissions`
- `/computer`
- `/browser`
- `/connections`
- `/search`
- `/recovery`
- `/usage`
- `/data`
- `/context`
- `/pilot`
- `/agenda`
- `/plan`
- `/activity`
- `/notifications`
- `/suggestions`
- `/memory`
- `/note`
- `/skill`
- `/routines`
- `/learnings`
- `/feedback`
- `/review`
- `/save`
- `/apply`
- `/retry`
- `/copy`
- `/exit`
- `/effort`
- `/artifact`
- `/connector`
- `/web-origin`
- `/source-refresh`
- `/source ignore`
- `/source unignore`
- `/source ignored`
- `/agents`
- `/queue`
- `/dequeue`
- `/clear-queue`
- `/revision-back`
- `/revision-forward`
- `/tasks`
- `/steer`
- `/cancel`
- `/cancel-task`
- `/steer-task`
- `/approve`
- `/deny`

`/exit` is a process/terminal control; closing a browser tab is the corresponding browser action. It is not a missing personal-assistant workflow.
