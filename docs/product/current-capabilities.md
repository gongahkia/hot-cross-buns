# Current product contract

This describes the implemented Electron app. Older specifications and the roadmap contain future targets; they do not certify a shipped feature. README.md is intentionally outside this remediation.

## Why use HCB alongside Google

| Feature | Purpose beyond Google's separate web apps | Ownership and boundaries |
| --- | --- | --- |
| Combined task/calendar planning | See task due dates and appointments together. Review a task's time, duration, and destination Calendar before creating a scheduled block. | A due date is a Google Tasks date. A scheduled block is a linked Google Calendar event; scheduling does not silently change the due date. |
| Smart Schedule | Preview where tasks fit around cached Calendar commitments, using task durations and working hours, then review before applying. | A deterministic planner over locally cached data. It needs a recent sync to reflect changes made elsewhere. |
| Keyboard capture and split workspace | Capture and edit with the command palette, shortcuts, and adjacent planner panes. | OS capabilities vary; tray, global shortcuts, and notifications need platform validation. |
| Cross-domain local search | Search indexed cached tasks, events, and local notes through one entry point. | Lexical SQLite FTS search. Cloud-only items that have not synced are absent. Semantic search is unavailable. |
| Local notes and item references | Keep planning context next to tasks and events. Insert stable item links; load embedded content when requested. | Notes stay on this device. Inline Drive links point to Drive; a local attachment library and computed backlink graph are unavailable. |
| Device stars and list ordering | Collect priority tasks or notes and keep preferred list sorting across restarts. | These preferences live in local SQLite settings and its full backups. They do not claim to change Google's stars. |
| Offline cache and queued Google writes | Render stored data before network refresh and keep authorized edits queued through disconnection. | Google remains authoritative for synced Tasks and Calendar resources. Sync status and failures must remain visible. |
| Local backups and diagnostics | Create consistent SQLite snapshots, retain daily backups, export a snapshot, and recover local notes. | “Restore local notes” recovers note content and lists, preserving current Google queues and preferences. It is not a complete profile rollback. Diagnostics omit note bodies. |
| Optional Google integrations | Explicit Drive metadata linking/file upload, Gmail-to-task capture, and reviewed account copying reduce switching between applications. | They depend on the account's granted capabilities. Optional services are not prerequisites for core planning. |
| Optional embedded webpages | Keep a reference page beside the planner when useful. | Restored pages start paused. Loading creates an additional browser process; Pause releases it. Only the selected tab is mounted. Open in browser is also available. |

The strongest differentiated workflow is **capture → choose what to do → preview time in Calendar → keep context → review completion**. Basic task CRUD, event CRUD, color themes, and an embedded webpage are supporting features, and do not independently justify switching from Google's apps. Users who only need separate task and calendar lists may gain little from HCB; onboarding should make the combined planning workflow explicit.

Task trees currently support one subtask level. A task with children must have those children moved or deleted before it can be deleted, moved to another list, or made a subtask. The service rejects operations that would leave invisible children and explains the required action. This restriction is a usability cost compared with a complete subtree-operation workflow.

The Calendar uses one displayed timezone for event labels, grouping, and timeline placement. Each event retains its original timezone for editing and Google recurrence rules. Day windows follow local midnight, including daylight-saving transitions; all-day events remain date-only.

## Responsiveness contract

Memory use cannot be independent of available physical RAM. The implementation instead avoids loading work in proportion to the total task or note collection:

- SQLite, recurrence projection, sync processing, indexing, and backups run in a worker; native window/credential operations remain in main.
- Task lookup summaries retain 100 items; note lookup summaries retain 50. Viewport pages expose short text previews. Editors fetch full records before editing or duplication.
- Each visible list retains at most six 100-item pages, with two reads in flight across query changes. Distant scrolling requests the destination page directly. Offscreen task columns release pages while retaining their view state.
- Calendar retention is limited to six requested time windows in the renderer and three projected ranges in the worker. Event descriptions are previews until opened. A dense time window can still contain many events; a window count is not a fixed byte ceiling.
- Task trees and notes use measured virtual rows. Selected task children and completed sections can be revealed without downloading intervening rows.
- Four planner panes and twelve saved tabs per web pane are supported. Embedded pages consume additional memory only when loaded. Embedded note content loads on expansion and is released on collapse.
- Search snippets, performance timing samples, logs, and projection caches have bounds.

Regression measurements and their limitations belong in [the remediation checklist](../performance/audit-remediation.md). Universal latency or memory guarantees require representative hardware measurements, not only synthetic fixtures.

## Unavailable capabilities

Local MCP/agent access, semantic model installation, webhooks, custom CSS/JavaScript injection, a local attachment store, a server-maintained backlink graph, ICS subscription shells, and portable archive shells are not shipped capabilities. Reachable unfinished controls are removed, and unsupported privileged calls fail explicitly. Future work must implement the service and validation before exposing its controls.
