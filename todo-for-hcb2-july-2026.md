# TODO for HCB2 - July 2026

Consolidated from:

- `stuff-missing-from-hcb2-to-add-july-2026.md`
- `prompts-to-run-july-2026-to-port-to-diff-devices.md`
- `proposed-optimisations-for-hcb2-july-2026.md`

This is the single July 2026 planning todo. Items with current static evidence of being present were omitted. Ports stay last.

## 0. Planning gate

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

- Defer `calendar.scheduleSuggest` until after first useful render.
  - Initial snapshot should render tasks, calendar, notes, settings, sync status, Google status, and native status without waiting for suggestions.
  - Today/schedule UI needs stable pending and empty states.
  - Update tests that assume startup waits on `scheduleSuggest`.
- Add one bootstrap IPC snapshot for initial app load.
  - Replace startup IPC fan-out with one typed bootstrap endpoint where safe.
  - Keep paging and lazy calendar range loading separate.
  - Treat bootstrap contract changes as high blast-radius.
- Trigger near-immediate pending-mutation queue drain after CRUD.
  - Debounce and batch drains.
  - Respect offline mode, disconnected accounts, sync-paused state, and app quit/startup sync.

## 2. Core planner feature gaps

### Tasks and organisation

- Verify/finish Kanban parity beyond the current Google-list board if original `KanbanGrouping` behavior is not covered.
- Add first-class tags:
  - tag repository
  - tag-task many-to-many table
  - tag colors
  - tag CRUD
  - `@tag` extraction
  - tag filters and saved views
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
- Add duplicate detection and duplicate-review UI for tasks, events, and notes.
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

### Calendar

- Verify/implement Year view if not present in renderer calendar view modes.
  - 4x3 mini-month grid
  - heatmap/count indicators
  - keyboard navigation
- Verify/finish drag-to-create on calendar grids.
- Add month/week day-agenda popover from cell/day click.
- Finish recurring-event edit scope:
  - this event
  - this and future
  - all events
  - safe Google mutation semantics
- Finish RRULE editor depth if current UI does not cover all supported recurrence fields.
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

- Verify dedicated Today/Home surface coverage.
- If incomplete, add overdue, due-today, scheduled, next-up, upcoming events, and sidebar-filter-aware sections.
- Add forecast/review summary builders if still missing from original parity.

## 3. Linked markdown and knowledge graph

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

- Add advanced search operators:
  - regex mode
  - `attendee:`
  - `duration>30m`
  - `has:notes`
  - `due<+7d`
  - list/tag/calendar/status/priority combinations
- Add custom-filter DSL:
  - `list:`
  - `tag:`
  - `AND` / `OR` / `NOT`
  - relative dates
  - saved queries
  - validation and explain output
- Add pinned filters in sidebar and menu-bar popover with count badges.
- Split quick switcher and quick-add mental model if current command palette remains one surface:
  - `Cmd+O` for go/open
  - `Shift+Cmd+P` for do/action
  - command IDs remain discoverable
- Add leader-key chord bindings with conflict detection.
- Add which-key HUD overlay for chord discovery.

## 5. User customisation layer

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
- Run extensions in an isolated context with no Node/Electron/fs/net/child_process access.
- Expose only a versioned, capability-gated bridge.
- Initial host API:
  - `registerCommand`
  - `onEvent`
  - `contributeView`
  - `getSetting` for whitelisted keys
- Add manifest capabilities and first-load user consent.
- Add per-extension enable/disable, logs, requested capabilities, and safe mode.
- Add sandbox escape tests, bridge contract tests, capability tests, and safe-mode tests.
- Add `docs/customization/extensions.md` with security model and sample extension.

## 6. Data, import/export, and local files

- Verify/finish portable `.hcbexport` / `.hcb2export` workflow:
  - manifest
  - state
  - bundled attachments
  - SHA-256 verification
  - dry-run import diff
  - pre-import backup
  - item-level preview
  - path relinking
- Verify/finish local file attachments for notes, tasks, and events:
  - image/file refs
  - app-owned attachment storage
  - download/copy actions
  - portable metadata
- Add local-pointer repair UI for broken attachment paths.
- Add ICS calendar import into cached calendar writes.
- Add local export/report flows that are still missing after current print support.

## 7. Security, native Mac integration, and release polish

- Verify/finish local cache encryption:
  - AES-256-GCM or approved equivalent
  - PBKDF2/Argon2 passphrase derivation if passphrase-based
  - session unlock sheet
  - key material outside SQLite
  - migration/backup safety
- Add sync mode selector:
  - manual
  - balanced
  - near-real-time
- Add past-event retention cutoff where `0` means keep forever.
- Add past-task/overdue cleanup behavior settings.
- Verify/finish in-app GitHub Releases update checker:
  - version compare
  - latest release state
  - recoverable network errors
  - manual download prompt
  - no silent insecure update
- Add Spotlight indexing where Electron/macOS permits it.
- Add macOS Share target or documented share-target alternative for quick task capture.
- Add App Intents/App Shortcuts only if a native helper is approved; otherwise document as non-goal.
- Verify dock badge behavior end to end if only settings exist.
- Finish notification UX:
  - permission primer separate from onboarding if still absent
  - configurable lead times
  - task due-date notification defaults
  - event notification defaults
  - 64-notification cap behavior
  - reschedule diagnostics
- Add renderer History / Sync Issues window if diagnostics history is insufficient.
- Audit MCP tool catalogue parity with original:
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
  - keybindings
  - import/export verification
  - encryption
  - notification scheduling
  - calendar recurrence
  - extension sandboxing
- Add Playwright/manual QA for:
  - Today
  - Kanban/areas/tags
  - calendar views
  - advanced search/pinned filters
  - settings/customisation
  - import/export/attachments
  - update checker
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
