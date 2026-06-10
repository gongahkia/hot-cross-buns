# TODO for HCB2 - July 2026

Consolidated from:

- `stuff-missing-from-hcb2-to-add-july-2026.md`
- `prompts-to-run-july-2026-to-port-to-diff-devices.md`
- `proposed-optimisations-for-hcb2-july-2026.md`

Open tasks only. Ports stay last.

Last static repo audit for this file: 2026-06-10.

Audit limits: static repo/source/test evidence plus local smoke harnesses only. No live Google API, external MCP client, packaged-app, or manual UI QA was performed.

2026-06-10 delta: tags/recurrence/search-command/MCP/duplicate QA items below were implemented or harnessed locally. Live Google and real-profile runs remain env-gated by the smoke harness.

Status key:

- `Partial`: implemented enough to use, but named hardening/depth remains.
- `Missing`: no static repo evidence found during this audit.
- `Verify`: adjacent code exists, but a feature-specific audit is needed before code.
- `Deferred`: intentionally parked.

## Recommended next implementation order

1. Portable export/import verification:
   - Status: `Partial`.
   - Open: manual migration QA on a real profile copy.
2. Agent-native MCP/CLI v2:
   - Status: `Partial`.
   - Open: webhook retry/rate-limit hardening, event-starting/mutation-failed emit sources, external MCP client QA, deeper approval-tray UI QA.
3. Release hardening:
   - Open: live Google smoke, external MCP client QA, rich notification actions, updater, packaging/signing checks.

## Done / harnessed on 2026-06-10

- First-class tags: tag analytics perf coverage added to `pnpm test:perf`; real-profile auto-tag smoke is env-gated in `pnpm hcb:july-smoke`.
- Recurrence: future-series and missing-master local smoke covered; live Google recurrence smoke is env-gated in `pnpm hcb:july-smoke`.
- Search/commands/MCP: custom-filter explain output, semantic model settings/IPC/rebuild diagnostics, menu-bar pinned filters, quick switcher/action split, leader chords/which-key HUD, and MCP/CLI smoke coverage added.
- Duplicates: generated task/event/note duplicate cleanup tests remain focused coverage; real-profile duplicate cleanup smoke is env-gated in `pnpm hcb:july-smoke`.

## 0. Planning gate

- Re-audit current repo and `../hot-cross-buns` before any implementation slice.
- For the selected slice, classify each item as `Present`, `Partial`, `Missing`, or `Deferred-with-reason` before code.
- Inspect at minimum:
  - `src/main/mcp/toolRegistry.ts`
  - `src/renderer/src/features/core/inspectors/TaskInspectorBody.tsx`
  - `src/renderer/src/features/core/screens/settings/AdvancedSettingsTab.tsx`
  - `src/renderer/src/features/core/screens/calendar/CalendarEventForm.tsx`
  - `src/main/sync/readSyncRepository/recurrence.ts`
  - `src/main/native/notificationScheduling.ts`
  - `src/renderer/src/features/core/viewModelSource/loader.ts`
  - `src/renderer/src/features/core/viewModelSource/provider.tsx`
- Confirm priorities, acceptable slice size, UX expectations, migration tolerance, security expectations, platform scope, test depth, and explicit deferrals before broad code.
- Produce a dependency-aware implementation plan with migrations, UI surfaces, IPC/contracts, tests, manual QA, and rollback/data-safety notes.
- Keep each slice scoped; update this todo when an item is implemented, verified present, or deferred.

## 1. Accounts and sync scope

- Status: `Partial`.
- Add per-account filters for search and diagnostics.
- Make create/update flows choose an explicit target account/calendar/list when ambiguity remains after destination selection.
- Verify disconnected/reauth-required accounts do not block healthy accounts.
- Add/expand migration tests for existing single-account caches and replay tests for per-account pending mutations where the selected implementation touches them.
- Run live multi-account QA.

## 2. Tasks and organisation

- Status: `Verify` for Kanban parity; `Partial` for remaining bulk tag parser/perf hardening.
- Verify/finish Kanban parity beyond the current Google-list board if original `KanbanGrouping` behavior is not covered.
- Finish bulk tag/untag QA beyond the current bulk tag apply path.
- Add batched/coalesced mutation-entry perf QA for large bulk edits.
- Harden Quick Add parser edge cases:
  - time zones
  - broader ambiguous date/time QA
  - count-limit and RRULE round-trip QA beyond current focused parser tests

## 3. Calendar

- Status: `Partial`.
- Harden recurring-event edit scope beyond the env-gated smoke harness as live Google coverage becomes available.
- Deferred: attendee invitation/status editing beyond guest email writes. RSVP/status metadata is read/displayed; local writes avoid inventing attendee response state.

## 4. Linked markdown and knowledge graph

- Status: `Mostly implemented`.
- Done:
  - shared wikilink parser for note/task/event/list/calendar links, aliases, and `#id` targets
  - clickable wikilinks in note bodies, task notes, and event descriptions
  - read-only transclusion embeds with broken-target and depth-limit states
  - universal entity-link graph table with source/target kind/id, source field, link type, alias, raw text, and broken state
  - graph-backed outgoing links, backlinks, and broken-link visibility for note/task/event/list/calendar entities
  - focused parser/index/renderer/regression tests
- Still open:
  - broken-link repair UI beyond note bodies
  - live/manual QA after Google sync edits on large real datasets

## 5. Search, filters, and command surfaces

- Status: `Partial`.
- Done / harnessed:
  - boolean/custom-filter explain output and validation display
  - semantic model registry/settings controls, install/uninstall state, rebuild controls, and stale/missing diagnostics
  - pinned filters in the menu-bar popover with count detail
  - quick switcher/action palette split: `Cmd+O` for go/open, `Shift+Cmd+P` for do/action
  - leader-key chord bindings, conflict detection, and which-key HUD
  - MCP/CLI-only action proposal smoke through `pnpm hcb:smoke`
- Defer in-app/local LLM work:
  - no app-frontend chat surface
  - no local or remote LLM provider settings/adapters
  - keep agent reasoning external through MCP/CLI tools such as `brief`, `plan`, `search`, `today`, `week`, and confirmable write tools
  - route future action proposals through MCP/CLI plus the existing pending-action/confirmation queue

## 6. User customisation layer

- Status: `Partial` for built-in appearance/theme, event color overrides, and in-app hotkeys; `Missing` for user CSS snippets, app-data JSON config/keymaps, and sandboxed extensions.

### CSS tokens and snippets

- Document and publicly stabilize existing CSS custom properties for snippet authors.
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

## 7. Data, import/export, and local files

- Status: `Partial`.
- Harden portable `.hcbexport` workflow:
  - manual migration QA on a real profile copy
  - decide only if a future `.hcb2export` alias/version is needed
- Finish user-facing local file attachments for notes, tasks, and events beyond portable pointer scan/export/import backend:
  - add/paste/drop/picker UI where missing
  - open/download/copy actions
  - visible missing/corrupt pointer states outside repair settings
- Add ICS calendar import and watched ICS subscriptions:
  - import local `.ics` files into cached calendar writes or a read-only local calendar source
  - subscribe to user-configured `https://` / `webcal://` ICS URLs with refresh intervals and ETag/Last-Modified caching where available
  - parse RFC 5545 `VEVENT`, `RRULE`, `RDATE`, `EXDATE`, time zones, all-day events, cancellations, and updates
  - keep subscribed calendars read-only unless explicitly copied into HCB/Google
  - show refresh status, parse errors, stale feeds, and last successful sync in Settings/Diagnostics
  - avoid sending subscribed ICS data to Google unless the user explicitly imports/copies it
- Add local export/report flows that are still missing after current print support.

## 8. Security, native Mac integration, and release polish

- Status: `Partial`.
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
- Audit overdue cleanup behavior against completed-task retention.
- Verify/finish in-app GitHub Releases update checker:
  - version compare
  - latest release state
  - recoverable network errors
  - manual download prompt
  - no silent insecure update
- Add native discovery helper for Spotlight, Raycast, and Alfred:
  - tiny Swift/ObjC helper packaged with the Electron app
  - index sanitized task/event/note/list titles into private on-device CoreSpotlight
  - route Spotlight results back through `hcb://task/...`, `hcb://event/...`, `hcb://note/...`, and `hcb://today`
  - keep bodies out of Spotlight by default; expose body indexing only behind an explicit privacy setting
  - add reindex/repair controls and diagnostics
  - add Raycast support via extension or script commands for search, today, quick capture, and open result
  - add Alfred workflow support with script filters/actions for search, today, quick capture, and open result
  - route Raycast/Alfred actions through `hcb://`, the CLI, or authenticated loopback MCP without exposing bearer tokens
- Add App Intents / Shortcuts helper:
  - expose App Shortcuts for Open Today, Quick Capture, What's Next, create task, create event, open task/event/note, and run saved search
  - route helper actions back into Electron through deep links, the CLI, MCP tools, or a hardened local IPC bridge
  - keep helper permissions narrow and avoid direct Google OAuth token access
- Add macOS Share Extension for quick capture:
  - accept selected text and URLs from host apps
  - create task or note drafts
  - prefer App Group drop file / queue if HCB is not running
  - optionally call authenticated loopback MCP only when server is enabled and reachable
  - sanitize shared input and surface failures without leaking source app data
- Add rich notification actions:
  - Snooze 10m
  - Complete
  - Open
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
- Expand agent-native MCP, CLI, and local automation surface:
  - event-starting and mutation-failed emit sources
  - webhook retry/backoff/rate-limit hardening
  - richer prompt coverage for day planning/inbox triage/standups/reschedule/duplicate review
  - external MCP client QA
  - redacted/context-budgeted output
  - tests for webhook delivery retry paths, event-starting/mutation-failed emits, richer prompts, and external MCP client behavior
- Audit MCP tool catalogue parity with original:
  - exact tool names
  - aliases
  - per-tool dry-run / confirm-write / allow-write modes
  - docs and tests

## 9. Performance, tests, and docs

- Add low-power-mode and constrained-network detection feeding sync backoff multipliers.
- Add large-account regression coverage:
  - 15k-event target
  - prepared event indexes/snapshots where still missing
  - startup and calendar navigation timings
- Maintain security posture:
  - no credential leaks
  - no weakened CSP
  - no remote code loading
  - no unsafe SQL/string query construction
  - no permission bypass
- Preserve Google Tasks/Calendar sync semantics and offline replay.
- Add focused tests for:
  - multi-account sync/filter/mutation isolation gaps
  - external keymap JSON and `when` predicate parsing
  - ICS import/subscription parsing and refresh
  - encryption
  - rich notification actions and cap diagnostics
  - extension sandboxing
  - webhook retry/emit coverage
- Add Playwright/manual QA for:
  - menu-bar Today data
  - Kanban/tags remaining scope
  - MCP/CLI-generated summaries/plans
  - settings/customisation
  - import/export/attachments
  - portable export/import migration
  - ICS imports/subscriptions
  - multi-account per-account filters
  - update checker
  - Spotlight/Raycast/Alfred discovery
  - App Intents/Shortcuts
  - Share Extension
  - rich notification actions
  - pending agent action tray
  - `hcb tail` and `hcb plan`
  - loopback webhook delivery/retry
  - share/intent flows where locally testable
- Each completed slice must report:
  - implemented items
  - deferred items with approved reason
  - commands run and results
  - manual QA evidence
  - migrations/data-safety notes
  - remaining risk

## 10. Ports last

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
