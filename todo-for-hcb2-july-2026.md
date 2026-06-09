# TODO for HCB2 - July 2026

Consolidated from:

- `stuff-missing-from-hcb2-to-add-july-2026.md`
- `prompts-to-run-july-2026-to-port-to-diff-devices.md`
- `proposed-optimisations-for-hcb2-july-2026.md`

This is the single July 2026 planning todo. Ports stay last.

Last repo audit for this file: 2026-06-08.

Audit note: static repo/source/test evidence only. No live Google API, external MCP client, packaged-app, or manual UI QA was performed for this update.

Status key:

- `Done`: static repo evidence found.
- `Partial`: implemented enough to use, but named hardening/depth remains.
- `Missing`: no static repo evidence found during this audit.
- `Verify`: likely present or adjacent code exists, but needs a feature-specific audit before code.
- `Deferred`: intentionally parked.

## Current status snapshot

### Done / verified present

- Task-backed notes are the current app/MCP/CLI model. Old local-only SQLite note tables are dropped by migration evidence, and docs/specs say notes sync through Google Tasks.
- MCP/CLI v1 exists with Git-like reads and writes:
  - reads: `doctor`, `status`, `log`, `diff`, `show`, `search`, `today`, `week`, list/get commands, undo status, pending mutations
  - writes: sync/retry/cancel queue, create/update/delete task/event/note/list, rename lists, complete/reopen task/event, move task, schedule task block, settings/OAuth/MCP admin, undo/redo, convert
  - dry-run/confirmation behavior exists for writes, destructive tools are guarded, and CLI docs exist.
- CRUD coverage for tasks, events, notes, task lists, and note lists exists through the shared domain services used by UI and MCP/CLI.
- Event completion exists as local HCB state for calendar events, including renderer behavior and MCP/CLI complete/reopen tools.
- Convert flows exist for task/event/note primitives; birthdays are explicitly excluded from conversion.
- Duplicate controls exist for task/event/note/birthday inspector flows; copies use `(copy)` naming and open as editable drafts.
- Birthday events are first-class HCB calendar events with `hcbKind: "birthday"`, strict UI fields, Google `eventType`/birthday metadata read mapping, strict birthday create/update payload tests, and birthday-safe mutation worker handling.
- Google Calendar event `colorId` is cached, written, theme-mapped, and user-overridable in Appearance settings.
- Rule-based auto-tagging/color assignment exists for tasks/events/notes with settings toggle, validation, preview, conflict visibility, reorder controls, invalid-regex auto-disable, and tests.
- Calendar has Agenda/Day/Multi-Day/Week/Month modes, overflow popovers titled `Items for <date>`, all-item overflow contents, completed-first ordering in overflow, and task-linked Google Calendar projection cleanup on task deletion.
- Startup bootstrap snapshot, light bootstrap timings, startup fan-out fallback, and deferred `calendar.scheduleSuggest` request path exist.
- Near-immediate post-CRUD sync/drain path exists through shared sync control/service-container wiring and live Google smoke docs reference `sync.post-crud-drain`.
- Advanced local search parser/repository coverage exists for regex, attendee, duration, notes/body presence, due/start windows, list, calendar, tag, status, priority, and source/domain filters.
- Sync mode selector exists for `manual`, `balanced`, and `near-real-time`, including settings UI, onboarding UI, diagnostics status, scheduler behavior, and tests.
- Past-event and completed-task retention settings exist, including `0` as forever and sync read lower-bound behavior.
- Diagnostics has logs, History, and Sync Issues surfaces with copy/search/error states and command-palette entry points.
- Local backup settings and manual backup action exist.
- MCP resources and prompt registry exist with status/doctor/today/week/diff/logs/pending-mutation resources and sync/today/week/support prompts.
- Google account disconnected state is surfaced as a user-visible issue while cached SQLite data can still render.
- Sidebar task/note counts use HCB-visible task-backed counts instead of raw Google/cache totals.
- Full unit suite was previously green after the latest auto-tag/settings hardening pass.

### Partial / still worth drilling down

- Tags now have a first-class local catalog, many-to-many entity links, tag CRUD/merge UI, tag colors, bootstrap/IPC/preload/source plumbing, and backfill from existing task/event tag JSON. Saved tag analytics remain basic count totals.
- Auto-tagging has inspector-level audit detail and settings-level bulk reapply for loaded tasks/events/notes. Full background reapply across unloaded cache windows and coalesced undo remain open.
- Multi-account plumbing is partially present: account IDs, account-scoped tokens/cache/checkpoints/mutations, latest-account transport, and multi-account docs/tests exist. Full connected-account management UX, account badges/filters, explicit target account selection, and merged multi-account Today remain open.
- Duplicate detection/review exists for tasks/events/notes with dismiss/open/delete/merge flows. Coalesced cleanup and deeper duplicate-resolution QA remain open.
- Conversion works, but should get one live/manual QA pass against real Google sync for replace-original cleanup and queued mutation replay.
- MCP/CLI is featureful, and prompt/resource registries now include `hcb_brief`, `hcb tail`, `hcb plan`, `hcb://brief`, `hcb://plan`, and `hcb://tail`. Webhooks and a durable pending agent action tray are still missing.
- Birthday Google payload shape is unit-tested, but live Google API smoke for birthday create/update/delete is still the main external-risk test.
- Quick-add/NL parsing has meaningful code and tests, including recurrence handling, but not the full chrono-style parser depth listed below.
- Calendar recurrence UI exists. Edit/delete scope selection now reaches repository writes; whole-series, Google-backed occurrence edits/deletes, and locally materialized future-series splits are covered by focused tests. Google-expanded future-series edits still fail fast when the master series is unavailable; deeper RRULE editor depth and live Google smoke remain open.
- Search/filter depth is partial: advanced parser-backed operators, boolean `AND`/`OR`/`NOT`, saved-search settings, pinned filters, and command-palette pinned filter chips exist. Semantic search, local LLM, and chat sidebar remain open.
- Portable data has real `.hcbexport` export/preview/import with deterministic state JSON, manifest SHA-256, attachment bundling/relinking, pre-import backup, and focused tests. ICS import/subscriptions and local pointer repair UI remain open.

### Missing / not implemented yet

- Hierarchical Areas.
- Bulk operations with coalesced undo/mutation entries.
- Semantic search, local LLM provider, and conversational planning sidebar.
- CSS snippets, JSON config/keymaps, and sandboxed user extensions.
- ICS import/subscriptions and local pointer repair UI.
- Cache encryption.
- Spotlight/Raycast/Alfred/App Intents/Shortcuts/Share Extension.
- Rich notification actions.
- Linux/Windows ports.

## Recommended next implementation order

1. First-class tags:
   - Status: `Partial`; implemented local tag catalog/repository, tag/entity tables, CRUD/merge UI, tag colors, counts, filters via tag search, pinned saved filters, inspector audit, and loaded-data bulk reapply.
   - Remaining: full-cache/background auto-tag reapply, richer tag analytics, and coalesced undo for bulk changes.
2. Recurrence correctness:
   - Status: `Partial`; whole-series, Google-backed occurrence edits/deletes, locally materialized future-series splits, and recurrence tests exist.
   - Remaining: Google-expanded future-series writes when master data is unavailable, deeper RRULE editor, and live Google smoke.
   - reason: high-risk calendar behavior; better before broad calendar automation.
3. Boolean/custom search and pinned filters:
   - Status: `Partial`; boolean DSL and pinned saved filters are implemented.
   - Remaining: semantic search, local LLM, and conversational planning sidebar.
4. Duplicate merge/coalesced cleanup:
   - Status: `Partial`; duplicate group merge is implemented for loaded tasks/events/notes.
   - Remaining: coalesced undo/mutation entries and deeper duplicate-resolution QA.
5. Portable export/import verification or implementation:
   - Status: `Partial`; deterministic `.hcbexport`, dry-run import diff, attachment bundling/relinking, and pre-import backups exist.
   - Remaining: local pointer repair UI, richer item-level preview, `.hcb2export` naming decision, and manual migration QA.
6. Agent-native MCP/CLI v2:
   - Status: `Partial`; `hcb brief`, `hcb tail`, `hcb plan`, `hcb_brief`, `hcb_tail`, `hcb_plan`, resources, and prompts are implemented.
   - Remaining: webhooks and durable pending agent action tray/proposed-write store.
7. Release hardening:
   - live Google smoke, external MCP client QA, notification actions, updater, packaging/signing checks
   - reason: product-readiness work after feature slices stabilize.

## 0. Planning gate

- 2026-06-08: this file was statically re-audited against the current repo. Repeat before any implementation slice; live/manual QA was not part of this audit.
- Re-audit current repo and `../hot-cross-buns` before implementation.
- For each item below, classify as `Present`, `Partial`, `Missing`, or `Deferred-with-reason` before code.
- Inspect at minimum:
  - `src/main/mcp/toolRegistry.ts`
  - `src/renderer/src/features/core/inspectors/TaskInspectorBody.tsx`
  - `src/renderer/src/features/core/screens/settings/AdvancedSettingsTab.tsx`
  - `src/renderer/src/features/core/screens/calendar/CalendarEventForm.tsx`
  - `src/main/sync/readSyncRepository/recurrence.ts`
  - `src/main/native/notificationScheduling.ts`
  - `src/renderer/src/features/core/viewModelSource/loader.ts`
  - `src/renderer/src/features/core/viewModelSource/provider.tsx`
- Interview user before coding: priorities, acceptable slices, UX expectations, migration tolerance, security expectations, platform scope, test depth, and explicit deferrals.
- Produce a dependency-aware implementation plan with migrations, UI surfaces, IPC/contracts, tests, manual QA, and rollback/data-safety notes.
- Keep each slice scoped; update this todo when an item is implemented, verified present, or deferred.

## 1. Startup and sync optimisations

- Status: `Done`; implemented 2026-06-06 and statically rechecked 2026-06-08.
- Done: defer `calendar.scheduleSuggest` until after first useful render.
  - Initial snapshot should render tasks, calendar, notes, settings, sync status, Google status, and native status without waiting for suggestions.
  - Today/schedule UI needs stable pending and empty states.
  - Update tests that assume startup waits on `scheduleSuggest`.
- Done: add one bootstrap IPC snapshot for initial app load.
  - Replace startup IPC fan-out with one typed bootstrap endpoint where safe.
  - Keep paging and lazy calendar range loading separate.
  - Treat bootstrap contract changes as high blast-radius.
- Done: trigger near-immediate pending-mutation queue drain after CRUD.
  - Debounce and batch drains.
  - Respect offline mode, disconnected accounts, sync-paused state, and app quit/startup sync.

## 2. Core planner feature gaps

### Accounts and sync scope

- Status: `Partial`.
- Static evidence exists for account IDs, account-scoped OAuth token storage, account-scoped cache rows/checkpoints/mutations, latest-account transport selection, and migration/sync replay tests. Product UX and merged multi-account planning remain incomplete.
- Promote the account mirror to first-class multi-account:
  - list and manage all connected Google accounts, not only the latest account status
  - keep OAuth tokens, sync checkpoints, mutation queues, task lists, calendars, tasks, and events isolated per account
  - add account badges and per-account filters for task lists, calendars, search, Today, and diagnostics
  - support a merged Today view across Personal + Work while preserving source account identity
  - make create/update flows choose an explicit target account/calendar/list when ambiguity exists
  - verify disconnected/reauth-required accounts do not block healthy accounts
  - add migration tests for existing single-account caches and replay tests for per-account pending mutations

### Tasks and organisation

- Status: `Verify` for Kanban parity; `Partial` for tags/auto-tagging, duplicate detection/review, snooze, subtasks, templates, and NL quick-add; `Missing` for Areas and coalesced bulk cleanup.
- Verify/finish Kanban parity beyond the current Google-list board if original `KanbanGrouping` behavior is not covered.
- Harden first-class tags beyond current catalog/link implementation:
  - full-cache/background auto-tag reapply
  - richer tag analytics
  - coalesced undo for bulk tag changes
- Harden current rule-based auto-tagging and color assignment:
  - "why was this tagged?" inspector/audit detail
- Add auto-tag bulk tools:
  - dry-run preview against existing tasks/events/notes
  - apply/reapply changed rules to selected scopes
  - undo/coalesced mutation handling for bulk reapply
- Add hierarchical Areas:
  - area schema
  - area sort order
  - area colors
  - task-list grouping under areas
  - settings/sidebar UI
- Finish bulk operations where current multi-select is incomplete:
  - reschedule
  - tag/untag
  - batched/coalesced undo and mutation entries
- Harden duplicate resolution for tasks, events, and notes.
  - Note: duplicate create controls, review/dismiss/open/delete, and loaded-data merge flows are present.
  - Remaining: coalesced cleanup and stronger duplicate-resolution QA.
- Finish snooze UX:
  - inspector controls for `snoozeUntil`
  - visible snoozed state in task lists/today/search
  - clear/snooze presets
- Finish subtask hierarchy UX:
  - parent/child editing in inspector
  - move/reorder subtasks safely inside Google Tasks list constraints
  - clear visual hierarchy in task views
- Finish task/event template engine if current settings-only templates are not fully instantiated:
  - `{{today}}`
  - `{{+Nd}}`
  - `{{prompt:Label}}`
  - `{{clipboard}}`
  - task/event creation from templates
- Upgrade NL quick-add with chrono-style date parsing and RRULE inference:
  - parse phrases like `every other Tue 9am`, `next Fri 2-4pm`, and `weekly until Jul 30`
  - convert recurring phrases into the existing `CalendarEventRecurrence` shape
  - preserve matched-token chips and remove parsed text from final title/summary
  - keep deterministic fallbacks for ambiguous dates/times
  - add parser tests for time zones, ranges, recurring weekdays, intervals, end dates, and count limits

### Calendar

- Status: `Partial`; Agenda/Day/Multi-Day/Week/Month are present.
- Verify/finish drag-to-create on calendar grids.
- Add month/week day-agenda popover from cell/day click.
- Add smart-reschedule:
  - suggest new slots for overdue, conflicted, or unscheduled tasks
  - respect priority, duration, locked schedules, working hours, visible calendars, and existing events
  - dry-run preview before applying changes
  - batch apply with undo and mutation coalescing
  - explain why each slot was chosen
- Harden recurring-event edit scope:
  - Google-backed occurrence edits/deletes are implemented.
  - Locally materialized future-series split is implemented.
  - Remaining: Google-expanded future-series writes when only an instance is cached, clearer unsupported-state copy, and live Google smoke.
- Finish visual RRULE editor depth if current UI does not cover all supported recurrence fields:
  - frequency, interval, weekdays, month rules, end date, count, and never-ending rules
  - readable summary and raw RRULE preview
  - validation for unsupported Google/RFC combinations
  - round-trip tests against current recurrence sync code
- Add attendee management depth beyond raw guest emails:
  - RSVP/status display
  - invitations
  - attendee validation/errors
- Add Google Meet/Hangouts attach on event create if current conference support is read-only.
- Add event visibility/transparency UI:
  - busy/free
  - public/private/default
- Expand custom reminders beyond one simple reminder field if needed.

### Today and review surfaces

- Status: `Verify`; CLI/MCP `today` exists, renderer coverage still needs feature-specific audit.
- Verify dedicated Today/Home surface coverage.
- If incomplete, add overdue, due-today, scheduled, next-up, upcoming events, and sidebar-filter-aware sections.
- Add forecast/review summary builders if still missing from original parity.

## 3. Linked markdown and knowledge graph

- Status: `Partial`; task-backed note link parsing/broken-link tests exist, universal entity graph/backlinks are still missing.
- Add shared wikilink parser for every markdown surface:
  - `[[note:...]]`
  - `[[task:...]]`
  - `[[event:...]]`
  - list/calendar links
  - aliases where needed
- Render clickable wikilinks in note bodies, task notes, event descriptions, and list metadata.
- Add read-only transclusion/live embeds:
  - `![[note:...]]`
  - `![[task:#id]]`
  - event/list/calendar embeds if useful
  - cycle and depth limits
  - loading/error/broken-target states
- Add universal entity-link graph:
  - `src_kind`
  - `src_id`
  - `dst_kind`
  - `dst_id`
  - `link_type`
  - source field/surface metadata where useful
- Re-index links after note/task/event/list/calendar edits and Google read sync.
- Expose graph-backed backlinks and outgoing links for every primitive.
- Make broken links visible and repairable for every primitive, not just notes.

## 4. Search, filters, and command surfaces

- Status: `Partial`; local search, MCP/CLI search, advanced parser-backed operators, boolean DSL, saved-search settings, and pinned filters exist. Semantic search, local LLM, and chat surfaces remain missing.
- Keep parser-backed advanced search operators covered:
  - regex mode
  - `attendee:`
  - `duration>30m`
  - `notes:yes` / `body:yes`
  - `due<+7d`
  - list/tag/calendar/status/priority combinations
- Harden custom-filter DSL:
  - boolean explain/validation QA
  - relative dates
  - saved-query UX polish
  - validation and explain output
- Add local semantic search layered on existing search:
  - evaluate `sqlite-vec` vs SQLite `Vec1` for packaging stability
  - use a worker-backed embedding path, starting with `Xenova/all-MiniLM-L6-v2` / `@huggingface/transformers` if packaging is acceptable
  - store 384-dimensional embeddings with entity kind/id, source text hash, model id, and generated-at metadata
  - store embeddings for tasks, events, notes, lists, and calendars locally
  - background embedding/index refresh after edits and sync
  - hybrid ranking with current FTS/DSL results
  - local/private model and no remote embedding calls by default
  - model download/cache controls, rebuild controls, and disabled-state UI when the model or vector extension is unavailable
  - diagnostics for stale/missing embeddings
- Add opt-in local LLM provider hook:
  - support user-configured Ollama and llama.cpp/OpenAI-compatible local endpoints
  - default disabled; prefer `127.0.0.1` / `localhost` endpoints unless the user explicitly opts into a remote URL
  - summarize long notes, suggest task breakdowns, draft event agendas, and explain plans through existing MCP read/write tools
  - route writes through dry-run previews and confirmation IDs; no silent task/event/note mutations
  - redact tokens/secrets, enforce context budgets, timeouts, cancellation, rate limits, and audit logs
  - show model/provider health, last error, and privacy status in Settings/Diagnostics
- Add in-app conversational planning sidebar:
  - act as an MCP client to HCB's local tools/resources/prompts and a user-configured model
  - answer planning questions like "what should I do next?" using Today/search/calendar/task context
  - surface proposed writes through the Pending agent action tray
  - keep chat history local, exportable, clearable, and excluded from remote services by default
  - include prompt-injection guardrails for note/event/task content used as context
- Finish pinned filters in the menu-bar popover with count badges if sidebar/command-palette coverage is not enough.
- Split quick switcher and quick-add mental model if current command palette remains one surface:
  - `Cmd+O` for go/open
  - `Shift+Cmd+P` for do/action
  - command IDs remain discoverable
- Add leader-key chord bindings with conflict detection.
- Add which-key HUD overlay for chord discovery.

## 5. User customisation layer

- Status: `Partial` for built-in appearance/theme, event color overrides, and in-app hotkeys; `Missing` for user CSS snippets, app-data JSON config/keymaps, and sandboxed extensions.

### CSS tokens and snippets

- Audit renderer styles and publish stable CSS custom properties for colors, typography, spacing, radii, shadow, and motion.
- Add user snippets directory under app data, e.g. `<userData>/snippets/*.css`.
- Add snippet loader with enable/disable/reload/error handling.
- Add Settings UI for snippets:
  - detected snippets
  - enable/disable
  - load errors
  - open snippets folder
  - reset defaults
- Add `docs/customization/theming.md` with public tokens, scoping rules, stability guarantees, and sample snippets.
- Add tests for token presence, snippet loading, snippet errors, and CSP regression.

### JSON config and keymaps

- Note: built-in keybinding settings and conflict detection exist; this item is specifically external app-data JSON config/keymap support.
- Add app-data `settings.json` for layout, density, panel visibility/order, default view, sidebar contents, and safe feature toggles.
- Add app-data `keymap.json`:
  - keys
  - command id
  - `when` predicate
- Add JSON Schemas under `docs/customization/schemas/`.
- Add a typed settings store with defaults, deep merge, validation errors, and change events.
- Add Settings UI for opening/resetting config files and surfacing validation errors.
- Parse `when` predicates without `eval` or `new Function`.
- Add tests for schemas, merge precedence, predicate parser, and keybinding conflicts.

### Sandboxed extensions

- Add user extension directory: `<userData>/extensions/<id>/{manifest.json,main.js}`.
- Run extension views as sandboxed renderer iframes or equivalent isolated web contents with no Node/Electron/fs/net/child_process access.
- Expose only a versioned, capability-gated bridge.
- Initial host API:
  - `registerCommand`
  - `onEvent`
  - `contributeView`
  - `getSetting` for whitelisted keys
- Make plugin UI communicate only through a reduced preload/host bridge with schema validation, rate limits, and explicit capability grants.
- Block remote code loading by default; require local packaged extension files and a strict extension CSP.
- Add manifest capabilities and first-load user consent.
- Add per-extension enable/disable, logs, requested capabilities, and safe mode.
- Add sandbox escape tests, bridge contract tests, capability tests, and safe-mode tests.
- Add `docs/customization/extensions.md` with security model and sample extension.

## 6. Data, import/export, and local files

- Status: `Partial`; portable `.hcbexport` export/preview/import now writes manifest/state/Attachments, deterministic table JSON, SHA-256 checks, bundled attachment copies, skipped pointer reporting, destructive import preview, pre-import backup, and attachment relinking.
- Harden portable `.hcbexport` / `.hcb2export` workflow:
  - richer item-level preview
  - local pointer repair UI
  - `.hcb2export` naming/version decision
  - manual migration QA on a real profile copy
- Verify/finish local file attachments for notes, tasks, and events:
  - image/file refs
  - app-owned attachment storage
  - download/copy actions
  - portable metadata
- Add local-pointer repair UI for broken attachment paths.
- Add ICS calendar import and watched ICS subscriptions:
  - import local `.ics` files into cached calendar writes or a read-only local calendar source
  - subscribe to user-configured `https://` / `webcal://` ICS URLs with refresh intervals and ETag/Last-Modified caching where available
  - parse RFC 5545 `VEVENT`, `RRULE`, `RDATE`, `EXDATE`, time zones, all-day events, cancellations, and updates
  - keep subscribed calendars read-only unless explicitly copied into HCB/Google
  - show refresh status, parse errors, stale feeds, and last successful sync in Settings/Diagnostics
  - avoid sending subscribed ICS data to Google unless the user explicitly imports/copies it
- Add local export/report flows that are still missing after current print support.

## 7. Security, native Mac integration, and release polish

- Status: `Partial`; base macOS-native shell, diagnostics, History/Sync Issues, MCP loopback/resources/prompts, Keychain-backed secrets, sync modes, retention settings, updater metadata/docs, local backups, and notifications scaffolding exist, but the items below still need product hardening.
- Verify/finish local cache encryption as an opt-in, data-safety-gated feature:
  - keep unencrypted SQLite as the default until encrypted-cache migration is proven by tests and manual recovery drills
  - evaluate `better-sqlite3-multiple-ciphers` against current Electron/Node/macOS packaging, maintenance, license, prebuild, and deprecation risk
  - prefer a SQLCipher-compatible cipher mode only if compatibility and long-term support are acceptable
  - store a random database key in macOS Keychain through the existing secret-store layer; keep key material outside SQLite and out of renderer IPC
  - do not encrypt a plaintext database in place; create a backup, checkpoint WAL, copy/export into a new encrypted database, verify, then atomically swap
  - run `PRAGMA integrity_check`, schema checks, row-count/hash checks, and app-level read smoke checks before deleting or archiving the plaintext original
  - retain rollback copies until the encrypted DB has opened successfully across restart and sync replay
  - support explicit decrypt/export recovery while the user still has Keychain access
  - document key-loss behavior clearly: encrypted cache is unrecoverable without the stored key, but Google source data can be re-synced after reconnect
  - do not ship the settings toggle until migration, downgrade, backup restore, corrupt-key, missing-Keychain, and interrupted-write tests pass
- Sync mode selector:
  - Status: `Done` by static evidence; keep live scheduler QA before release sign-off.
  - manual
  - balanced
  - near-real-time
- Past-event retention cutoff:
  - Status: `Done` by static evidence; `0` means keep forever.
- Past-task cleanup settings:
  - Status: `Partial`; completed-task retention exists, but overdue cleanup behavior still needs product/implementation audit.
- Verify/finish in-app GitHub Releases update checker:
  - version compare
  - latest release state
  - recoverable network errors
  - manual download prompt
  - no silent insecure update
- Add native discovery helper for Spotlight, Raycast, and Alfred.
  - tiny Swift/ObjC helper packaged with the Electron app
  - index sanitized task/event/note/list titles into private on-device CoreSpotlight
  - route Spotlight results back through `hcb://task/...`, `hcb://event/...`, `hcb://note/...`, and `hcb://today`
  - keep bodies out of Spotlight by default; expose body indexing only behind an explicit privacy setting
  - add reindex/repair controls and diagnostics
  - add Raycast support via extension or script commands for search, today, quick capture, and open result
  - add Alfred workflow support with script filters/actions for search, today, quick capture, and open result
  - route Raycast/Alfred actions through `hcb://`, the CLI, or authenticated loopback MCP without exposing bearer tokens
- Add App Intents / Shortcuts helper.
  - expose App Shortcuts for Open Today, Quick Capture, What's Next, create task, create event, open task/event/note, and run saved search
  - route helper actions back into Electron through deep links, the CLI, MCP tools, or a hardened local IPC bridge
  - keep helper permissions narrow and avoid direct Google OAuth token access
- Add macOS Share Extension for quick capture.
  - accept selected text and URLs from host apps
  - create task or note drafts
  - prefer App Group drop file / queue if HCB is not running
  - optionally call authenticated loopback MCP only when server is enabled and reachable
  - sanitize shared input and surface failures without leaking source app data
- Verify dock badge behavior end to end if only settings exist.
- Add rich notification actions.
  - actions: Snooze 10m, Complete, Open
  - wire Snooze to `local_snooze_until`
  - wire Complete through existing task/event complete handlers and pending mutation queue
  - keep destructive actions confirmable where needed
  - support background handling when the window is closed
- Finish notification UX:
  - permission primer separate from onboarding if still absent
  - configurable lead times
  - task due-date notification defaults
  - event notification defaults
  - 64-notification cap behavior
  - reschedule diagnostics
- Renderer History / Sync Issues:
  - Status: `Done` for Diagnostics tabs and command-palette entry points.
  - Add a separate window only if later UX requires it.
- Expand agent-native MCP, CLI, and local automation surface:
  - Note: base MCP/CLI read/write CRUD, sync, queue, undo/redo, and convert tools are already done.
  - add `hcb_brief` read tool/resource returning one structured today summary with blocking tasks, overdue items, conflicts, suggested reorder, sync risk, and next events
  - expand `promptRegistry.ts`; current prompts cover sync/debug/today/week/support, while day planning, inbox triage, standup summaries, reschedule planning, and duplicate review remain open
  - add an in-app floating Pending agent action tray for queued `confirmationId`s, with approve/reject/expiry states and sanitized dry-run summaries
  - add `hcb tail` CLI for live sync/log/mutation state, polling first and SSE only if the MCP transport grows stream support
  - add `hcb plan` CLI that reads piped markdown, parses tasks/events/notes through shared NL parsing, previews candidates by default, and applies only with `--apply`
  - add opt-in loopback webhooks for local POSTs on planner events such as task created/completed, event starting, mutation failed, and sync completed
  - restrict webhook URLs to `127.0.0.1` / `localhost`, sign payloads with a local secret, rate-limit delivery, retry safely, and omit private bodies by default
  - keep all agent/CLI/webhook output redacted and context-budgeted
  - add tests for resource discovery, prompt discovery, prompt args, `hcb_brief` schema stability, confirmation tray approvals, `hcb tail`, `hcb plan`, and webhook validation/delivery
- Audit MCP tool catalogue parity with original:
  - Status: `Partial`; current tool registry is broad and tested, but original parity must be checked explicitly before closing this.
  - exact tool names
  - aliases such as `hcb_today`, `hcb_week`, `hcb_search`, `hcb_create_task`
  - per-tool dry-run / confirm-write / allow-write modes
  - docs and tests

## 8. Performance, tests, and docs

- Add low-power-mode and constrained-network detection feeding sync backoff multipliers.
- Add large-account regression coverage:
  - 15k-event target
  - prepared event indexes/snapshots where still missing
  - startup and calendar navigation timings
- Run frontend reference pass before major visual work:
  - Apple Calendar
  - Notion Calendar
  - current HCB2 before screenshots
  - extract layout/density/navigation lessons only
  - do not copy branding, exact icons, copy, or proprietary artwork
- Maintain security posture:
  - no credential leaks
  - no weakened CSP
  - no remote code loading
  - no unsafe SQL/string query construction
  - no permission bypass
- Preserve Google Tasks/Calendar sync semantics and offline replay.
- Add focused tests for:
  - parsers
  - migrations
  - reducers/stores
  - IPC contracts
  - search/filter DSL
  - semantic embeddings/vector search
  - local LLM provider adapters
  - MCP conversational sidebar action approvals
  - keybindings
  - import/export verification
  - deterministic portable export diff stability
  - ICS import/subscription parsing and refresh
  - encryption
  - multi-account sync and mutation isolation
  - notification scheduling
  - calendar recurrence
  - extension sandboxing
- Add Playwright/manual QA for:
  - Today
  - Kanban/areas/tags
  - calendar views
  - advanced search/pinned filters
  - semantic search
  - local LLM summaries/plans
  - conversational planning sidebar
  - settings/customisation
  - import/export/attachments
  - git-friendly `.hcb2export` output
  - ICS imports/subscriptions
  - multi-account merged Today and per-account filters
  - update checker
  - Spotlight/Raycast/Alfred discovery
  - App Intents/Shortcuts
  - Share Extension
  - rich notification actions
  - pending agent action tray
  - `hcb tail` and `hcb plan`
  - loopback webhook delivery
  - share/intent flows where locally testable
- Each completed slice must report:
  - implemented items
  - deferred items with approved reason
  - commands run and results
  - manual QA evidence
  - migrations/data-safety notes
  - remaining risk

## 9. Ports last

Run only after Mac v1 work above is stable. Do not run Linux and Windows first-pass port work in parallel.

### Cross-platform adapter audit

- Identify Mac-only assumptions in paths, credentials, tray, menu, shortcuts, notifications, protocol, autostart, updater, diagnostics, OAuth, MCP, packaging, and tests.
- Refine shared adapter interfaces for platform capabilities.
- Expose capability-report DTOs through preload/settings where appropriate.
- Add adapter contract tests runnable without Linux or Windows.
- Keep platform-specific logic out of renderer components.
- Do not claim non-Mac support.

### Linux technical preview

- Implement Linux adapter implementations or stubs for:
  - app paths
  - Secret Service/libsecret credentials
  - tray/status area
  - global shortcuts
  - notifications
  - custom protocol
  - autostart
  - updater metadata
  - external open behavior
  - diagnostics
- Add capability detection for Secret Service, tray support, X11 vs Wayland, portal shortcuts, notifications, and protocol status.
- Add Linux settings/diagnostics status surfaces.
- Add Linux adapter tests, using mocks where not running on Linux.
- Package AppImage first.
- Add desktop metadata, icons, categories, keywords, and StartupWMClass.
- Add Linux install/run/uninstall docs, manual QA checklist, and performance smoke instructions.
- Do not enable plaintext credential fallback.
- Do not claim universal Linux parity.

### Windows technical preview

- Implement Windows adapter implementations or stubs for:
  - app paths
  - credential storage
  - tray
  - global shortcuts
  - notifications
  - custom protocol
  - autostart
  - updater metadata
  - external open behavior
  - diagnostics
- Add stable AppUserModelID/app identity wiring early in startup.
- Add Windows settings/diagnostics status surfaces for tray, shortcuts, notifications, protocol, updater, signing, and SmartScreen where known.
- Add Windows adapter tests, using mocks where not running on Windows.
- Package NSIS first.
- Add executable name, installer display name, Start Menu shortcut, protocol registration, and icon metadata.
- Add signing plan docs:
  - unsigned internal preview
  - Microsoft Store MSIX option
  - Azure Artifact Signing / Trusted Signing
  - OV certificate
  - self-signed dev-only behavior
- Add Windows install/run/uninstall docs, manual QA checklist, and performance smoke instructions.
- Do not claim public Windows readiness without signing and runtime QA.
- Do not commit certificates, passwords, tokens, or signing secrets.

### Cross-platform release hardening

- Audit adapters for duplicated logic, drift, unsafe fallbacks, and renderer platform branching.
- Verify capability reports are consistent in Settings and Diagnostics.
- Verify install/update/uninstall docs match actual package behavior.
- Verify performance smoke reports exist or are explicitly blocked per platform.
- Verify manual QA checklists exist for macOS, Linux, and Windows.
- Update roadmap/docs to distinguish supported, technical preview, and unsupported features by platform.
- Do not add new platform scope.
- Do not weaken security, credential storage, or MCP local-only guarantees to simplify a port.
