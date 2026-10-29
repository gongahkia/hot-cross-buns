# Current product contract

The current product is the React browser application. [The browser capability matrix](../web-migration.md) is authoritative for runtime, storage, Google authorization, backups and native replacements. The detailed planner interaction contract below was established by the Electron application and is preserved by browser tests; desktop-only menu bar, Keychain, filesystem and background-operation descriptions are historical, not shipped browser controls. Older specifications and roadmaps do not certify a shipped feature.

## Onboarding and Settings interface audit — 29 October 2026

Full review of the five onboarding steps, Calendar agenda/context empty states, primary sidebar navigation, and all seven Settings categories. Implementation uses the existing React, Tailwind, shared theme tokens, Lucide action icons, and Radix dialog components. The current browser product is the review target; retained Electron-only controls are outside the visual verification scope.

The planner requires a linked Google account even when older workspaces have already completed or skipped setup. The public Web OAuth client must be configured before onboarding can finish; see [Google setup](../google-browser-setup.md). Existing workspaces with a linked Google account remain usable offline after session expiry. Disconnecting the last linked account restores the connection gate without deleting planner data. Drive/Gmail grants remain optional. All changes reuse the existing Google, settings, workspace, and diagnostics APIs. The account requirement is checked independently of saved onboarding status. Older local-only workspaces open directly at Connect Google; linking an account preserves their existing settings and records. The planner is inert while the connection gate is loading or visible.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Onboarding descriptions; category headings; shared control labels and account/resource rows | Removed clipped setup copy and shared row labels; added category descriptions and a proper heading hierarchy. |
| Surfaces | Settings shell, all category components, shared rows/switches, onboarding dialog | Responsive category navigation and panel-width row layout; badges no longer compete with switches for a fixed 40px box. |
| Animations | Shared transitions and reduced-motion rules; existing dialogs | No new page animations; switches use colour/position transitions and existing reduced-motion handling. |
| Icons | Primary navigation, Calendar empty states, Settings category navigation | Removed redundant pictograms; retained functional action icons, Google service marks, and status indicators. |
| Performance | Settings rendering/search and browser/native feature boundaries | Kept one active category mounted; no new library, network request, or backend service. No performance benchmark claimed. |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `FirstRunOnboarding.tsx` | Local resources allowed bypassing Google; account diagnostics could outlive the live session | Require a connected account for Continue/Finish; show configuration and reconnection states | Match the requested setup contract and make blocked actions understandable. |
| HIGH | `FirstRunOnboarding.tsx` | A styled modal did not contain keyboard focus | Use the existing Radix modal primitive | Keyboard navigation must stay inside required setup. |
| MEDIUM | `FirstRunOnboarding.tsx` | Footer step counter and truncated descriptions | Remove the counter; let explanatory copy wrap | Reduce visual noise without hiding necessary setup information. |
| LOW | `AppHeader.tsx`, `CalendarAgendaView.tsx`, `CalendarSidebar.tsx`, `SettingsPrimitives.tsx` | Redundant navigation and empty-state pictograms | Text navigation and icon-free Calendar empty states | Keep attention on destinations, selections, and content. |
| HIGH | `SettingsPrimitives.tsx`, `styles/index.css`, `AppearanceSettingsTab.tsx` | Rows followed viewport breakpoints despite a sidebar; fixed minimum widths could clip labels/controls | Rows follow panel width, wrap labels, constrain controls, and stack below the breakpoint | Controls must remain readable and reachable on narrow screens. |
| MEDIUM | `SettingsPrimitives.tsx` | Switch labels crammed counts and input into one fixed square; group titles repeated the page heading level | Separate trailing content, use a labelled switch with keyboard focus, and nest headings correctly | Improve hit areas, alignment, and document structure. |
| MEDIUM | `SettingsView.tsx` | Search announced category counts without direct destinations and could trap category navigation | Clickable matching categories, category-name queries, clear empty states, and navigation that clears unrelated filters | Make search results and recovery from no results actionable. |
| MEDIUM | `AppearanceSettingsTab.tsx`, `SettingsView.tsx` | Browser users could configure a menu-bar font, native window restoration, or order absent toolbar actions | Hide unsupported native settings and expose only rendered toolbar actions; omit obsolete search terms | Preferences must describe observable behaviour. |
| HIGH | `SettingsView.tsx` | Google errors and unconfirmed clipboard writes could appear as success | Distinguish informational, success, and failure notices; await clipboard result | Feedback must reflect the actual operation outcome. |
| MEDIUM | `AlertsSettingsTab.tsx`, `AboutSettingsTab.tsx`, `DataSettingsTab.tsx` | Reminder slider remained actionable without reminders; update and Google copy conflicted with runtime behaviour | Disable/hide unavailable reminder controls; explain all-tabs-closed updates and required initial connection | Keep settings consistent with capabilities. |
| LOW | `SettingsView.tsx` | Category headings offered little context; diagnostics duplicated the General entry | Add brief descriptions and retain diagnostics under General | Reduce navigation clutter while keeping the existing feature reachable. |

Considered but rejected: replacing removed icons with a second Apple-style icon library (text already identifies these destinations); changing Google token persistence to avoid reconnection (outside this UI task and changes the security/storage contract); replacing the existing full-screen Settings surface with a new modal (responsive improvements fit the established workspace and keyboard behaviour).

Verification:

- `corepack pnpm typecheck` passed.
- `corepack pnpm exec vitest run src/browser/googleAuth.test.ts src/renderer/src/components/FirstRunOnboarding.test.tsx src/renderer/src/features/core/screens/settings/ProfileSettingsTab.test.tsx`: **18 passed**.
- `corepack pnpm exec playwright test -c output/ui-review/settings.playwright.config.ts tests/smoke/settings-audit.spec.ts tests/smoke/onboarding-layout.spec.ts tests/browser/browser-controls.spec.ts tests/browser/persistence.spec.ts tests/smoke/workspace-ui.spec.ts:498`: **16 passed** against a fresh static test build. The ignored local config extends build startup to 360 seconds and test timeout to 120 seconds on this busy laptop; assertions and fixtures are unchanged. The normal repository config can run the same test selections.
- Checked every Settings category at 1180px light, 640px dark, and 390px dark; captured and inspected desktop/narrow screenshots. Checked keyboard focus, switch persistence, notification/clipboard refusal, search navigation/no results, Google denial, required setup, and offline reopening of completed workspaces.
- `node output/ui-review/inspect-settings.cjs`: inspected the two switch transitions at 10% playback speed, confirmed reduced-motion duration of `0.00001s`, and verified the empty Agenda contains zero SVG icons. The script and screenshots are local review artifacts under `output/ui-review/`.
- `git diff --check` passed. The first browser attempts exposed a build timeout, missing matching Chromium, a switch pointer target, and an overly strict search-test text locator; these were resolved before the passing run. Visual inspection also corrected the narrow category strip before final verification.

Account-gate follow-up: typechecking, 10 focused unit/component checks, 20 targeted account/persistence/import/onboarding browser checks, and all four production offline scenarios passed. Earlier targeted Settings, browser controls, preferences, cross-tab UI, and startup checks also passed with the linked-account fixture. Google consent was simulated; no live authorization or benchmark was run.

Verdict: **Approve for the reviewed interface scope**. Not verified: real Google consent using the deployment's OAuth client, other browser engines, and retained Electron-only surfaces. No new performance benchmark or deployment is claimed.

## Why use HCB alongside Google

Google Calendar already displays and edits Tasks, supports task start/end times and deadlines, and provides Drive attachment controls. Combined display and manual time blocking are therefore parity features, not a sufficient switching proposition. See [Google Calendar Help](https://support.google.com/calendar/answer/9901136) and [Google Tasks Help](https://support.google.com/tasks/answer/7675838?co=GENIE.Platform%3DDesktop&hl=en), checked 18 October 2026. Google's [Workspace guide](https://support.google.com/a/users/answer/13306853?hl=en) also documents Gmail-to-task capture.


| Feature | Role in HCB's planning workflow | Ownership and boundaries |
| --- | --- | --- |
| Combined task/calendar planning | A foundation for planning. Review a task's time, duration, and destination Calendar before creating a scheduled block. Combined display and manual time blocking also exist in Google. | A due date is a Google Tasks date. A scheduled block is a linked Google Calendar event; scheduling does not silently change the due date. |
| Smart Schedule | Preview where tasks fit around cached Calendar commitments, using task durations and working hours, then review before applying. | A deterministic planner over locally cached data. It needs a recent sync to reflect changes made elsewhere. |
| Keyboard capture and contextual editing | Capture and edit with the command palette, shortcuts, and a right-hand details panel. | OS capabilities vary; tray, global shortcuts, and notifications need platform validation. |
| Cross-domain local search | Search indexed cached tasks, events, and local notes through one entry point. | Lexical SQLite FTS search. Cloud-only items that have not synced are absent. Semantic search is unavailable. |
| Local notes and item references | Keep planning context in local documents and item editors. Open web references in the default browser. | Notes stay on this device. Inline Drive links point to Drive; a local attachment library and computed backlink graph are unavailable. |
| Device stars and list ordering | Collect priority tasks or notes and keep preferred list sorting across restarts. | These preferences live in local SQLite settings and its full backups. They do not claim to change Google's stars. |
| Offline cache and queued Google writes | Render stored data before network refresh and keep authorized edits queued through disconnection. | Google remains authoritative for synced Tasks and Calendar resources. Sync status and failures must remain visible. |
| Local backups and diagnostics | Create consistent SQLite snapshots, retain daily backups, export a snapshot, and recover local notes. | “Restore local notes” recovers note content and lists, preserving current Google queues and preferences. It is not a complete profile rollback. Diagnostics omit note bodies. |
| Optional Google integrations | Explicit Drive metadata linking/file upload, Gmail-to-task capture, and reviewed account copying reduce switching between applications. | They depend on the account's granted capabilities. Optional services are not prerequisites for core planning. |

The strongest differentiated workflow is **capture → choose what to do → preview time in Calendar → keep context → review completion**. Basic task CRUD, event CRUD, and color themes are supporting features, and do not independently justify switching from Google's apps. Users who only need task CRUD, Calendar integration, or manual time blocking may gain little from HCB; onboarding should make reviewed scheduling, keyboard workflows, and local planning context explicit. Google OAuth setup, separate linked Calendar events, local-only notes, and Electron's memory floor are real switching costs. Optional Gmail/Drive integrations are conveniences rather than defensible differentiators.

Task trees currently support one subtask level. A task with children must have those children moved or deleted before it can be deleted, moved to another list, or made a subtask. The service rejects operations that would leave invisible children and explains the required action. This restriction is a usability cost compared with a complete subtree-operation workflow.

The details panel uses compact inline fields and an Event / Task / Birthday / Note type menu. Text saves on field blur; choices save immediately. Closing or changing sections waits for pending writes, and failures keep the draft open with Retry and Discard edits. Confirmed type conversions save the replacement before removing the original; Copy and Cut place the title and Markdown body on the system clipboard, and Duplicate creates an independent item. Birthday identity and event tags are retained locally across restarts.

The Calendar toolbar uses an application-rendered view menu with Day, Week, Month, Agenda, custom ranges of 2–31 days, and persistent weekend, declined-event, and week-number preferences. Calendar eye buttons change display visibility without deleting or deselecting synced sources. Completed events and tasks are muted in calendar views.

Completing or reopening a scheduled task block updates its linked task through the existing task service; other blocks for that task reflect the same state. Calendar source permissions are retained from Google and enforced in controls and persistence. Read-only or unverified remote permissions prevent writes; duplicating into a writable calendar remains available. Loading, cached/offline, queued and failed delivery states are visible in Calendar, with recovery through existing diagnostics.

Calendar events can be moved in Month and timeline views. All-day spans resize from either date edge; timed appointments resize from the start or end in a timeline. Pointer previews save on release, Escape/blur cancels, and recurring edits ask which occurrences to change. Whole-series gestures involving stored exceptions, complex recurrence-selector changes, or timed/all-day series conversion require review instead of guessing a new recurrence. Scheduled-block gestures use the existing scheduling service and preserve the task's due date. Dragging near viewport edges scrolls and can advance the displayed period.

Horizontal timeline scrolling advances individual days after any native horizontal overflow; Month scrolling advances bounded week windows at its edges. The rolling position persists, date selection resets it, and existing retention/future limits still apply. Six rendered Month weeks and the existing renderer/worker range caches stay bounded; range loading keeps one active request and only the latest replacement.

Month density adapts from one to six event lanes to fit the available height, with titles taking priority in narrow cells. Overflow contains keyboard focus, and grids use one Tab stop with arrow/Home/End navigation. Navigation-limit messages explain disabled directions and link to Settings. Notes place timestamps below the title/preview to preserve reading space.

Right-click and Shift+F10 open calendar item actions in Month, timelines, Agenda and overflow. Event actions include editing, copying full text, duplication, and deletion. A recurring occurrence is duplicated as one independent event. Deletion supports one occurrence or the entire series; deleting this and future occurrences remains unavailable. Task entries open their task editor. Remaining daily-driver concerns and verification boundaries are recorded in [the calendar interaction audit](../testing/calendar-interaction-audit.md).

The right-panel toggle opens local search for cached events, tasks, and birthdays. Results open in the same panel while the current workspace and date stay visible. Back to Search saves edits and restores the query. Opening, closing, and additional event fields animate; system reduced-motion and the app's Disable animations preference are honored. On narrow windows the panel becomes an overlay with focus containment and Escape dismissal.

The Calendar uses one displayed timezone for event labels, grouping, and timeline placement. Each event retains its original timezone for editing and Google recurrence rules. Day windows follow local midnight, including daylight-saving transitions; all-day events remain date-only.

Native item routes preserve event/task/note IDs and open their inspectors once the destination section is ready; event links reveal the relevant date and Today resets the date. The macOS menu bar panel shares the app's palette, theme mode and font preferences, with two-line agenda titles, visible keyboard focus, Escape dismissal and a fixed action footer. Its calendar overview opens Today through the existing route; it does not offer in-panel date editing. Connection labels describe account connectivity, while queued/failed delivery details remain in the main app. The panel continues to render a bounded cached snapshot with JavaScript disabled.

HCB uses the public Google Tasks API. Its `due` field is a date-only scheduled day, and Google documents that it neither represents the native Deadline field nor exposes a task's scheduled time. HCB's “due date” edits that API day; HCB scheduling creates a separate linked Calendar event. Native Google task start/end times and Deadlines are not mirrored by HCB. This compatibility gap is a product cost, not additional value. [Google Tasks API reference](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks)

## Responsiveness contract

Memory use cannot be independent of available physical RAM. The implementation instead avoids loading work in proportion to the total task or note collection:

- SQLite, recurrence projection, sync processing, indexing, and backups run in a worker; native window/credential operations remain in main.
- Task lookup summaries retain 100 items; note lookup summaries retain 50. Viewport pages expose short text previews. Editors fetch full records before editing or duplication.
- Each visible list retains at most six 100-item pages, with two reads in flight across query changes. Distant scrolling requests the destination page directly. Offscreen task columns release pages while retaining their view state.
- Calendar retention is limited to six requested time windows in the renderer and three projected ranges in the worker. Event descriptions are previews until opened. A dense time window can still contain many events; a window count is not a fixed byte ceiling.
- Task trees and notes use measured virtual rows. Selected task children and completed sections can be revealed without downloading intervening rows.
- One planner workspace with a persistent mini-calendar sidebar and a contextual details panel is supported. Saved split layouts reopen their active app section; webpage links open in the default browser. Embedded note content loads on expansion and is released on collapse.
- Search snippets, performance timing samples, logs, and projection caches have bounds.

Regression measurements and their limitations belong in [the remediation checklist](../performance/audit-remediation.md). Universal latency or memory guarantees require representative hardware measurements, not only synthetic fixtures.

## Unavailable capabilities

Local MCP/agent access, semantic model installation, webhooks, custom CSS/JavaScript injection, a local attachment store, a server-maintained backlink graph, ICS subscription shells, and portable archive shells are not shipped capabilities. Reachable unfinished controls are removed, and unsupported privileged calls fail explicitly. Future work must implement the service and validation before exposing its controls.
