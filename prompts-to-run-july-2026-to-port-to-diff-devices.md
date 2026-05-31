```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: close the feature-parity gaps documented in stuff-missing-from-hcb2-to-add-july-2026.md, after first producing an implementation plan and conducting a focused user interview. Do not start code changes until the plan is reviewed and the interview answers are incorporated.

Read first:
- stuff-missing-from-hcb2-to-add-july-2026.md
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/03-database-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md

Phase 0 - verify and interview before implementation:
- Audit the current repo and ../hot-cross-buns where needed. Re-classify each item in stuff-missing-from-hcb2-to-add-july-2026.md as Present, Partial, Missing, or Deferred-with-reason.
- Inspect these critical files before finalizing the plan: src/main/mcp/toolRegistry.ts, src/renderer/src/features/core/inspectors/TaskInspectorBody.tsx, src/renderer/src/features/core/screens/settings/AdvancedSettingsTab.tsx, src/renderer/src/features/core/screens/calendar/CalendarEventForm.tsx, src/main/sync/readSyncRepository/recurrence.ts, src/main/native/notificationScheduling.ts.
- Conduct a user interview before coding. Ask about priority, acceptable slices, UX expectations, platform scope, data migration tolerance, security/encryption expectations, testing depth, and whether any gap should be deferred.
- Produce a dependency-aware implementation plan with slices, migrations, UI surfaces, IPC/contracts, tests, manual QA, and rollback/data-safety notes.
- After plan approval, implement in small reviewed slices. Keep changes scoped to the approved gaps.

Implement or explicitly resolve every Confidently Missing gap:
- Task management: Kanban view; first-class tags with tag repository, tag-task many-to-many, tag colors, tag CRUD, and @tag extraction; hierarchical Areas with area sort/color; natural-language task/event parsing for due dates and times; task starring/flagging; bulk task operations for multi-select complete/reschedule/move/tag with coalescing; task/event duplication actions; duplicate-task detection and duplicate-review window.
- Calendar: Year view with 4x3 mini-month heatmap; configurable 2-7 day multi-day view; single-day grid view; drag-to-create on calendar grids; attendee management UI with RSVP, response status, and invitations; Google Meet/Hangouts attachment on event create; custom event reminders editor; visibility/transparency controls for busy/free and public/private; recurring-event scope picker for this, this-and-future, and all; day-agenda popover from month/week click; RRULE editor UI instead of raw recurrence handling only.
- Search and quick actions: regex and field-operator advanced search including attendee:, duration>30m, has:notes, due<+7d; custom-filter DSL with list:, tag:, AND/OR/NOT, relative dates, and saved queries; pinned filters in sidebar and menu-bar popover with count badges; Spotlight indexing for tasks and events; split quick switcher/quick-add model with Cmd+O for go and Shift+Cmd+P for do.
- Keyboard and shortcuts: leader-key Cmd+K chord bindings; which-key HUD overlay; per-action keybinding customization UI backed by a chord-capable engine.
- Settings, distribution, and platform integrations: local cache encryption with AES-256-GCM and PBKDF2 or Argon2 passphrase plus session unlock sheet; per-surface font customization across six surfaces by family/size/weight; custom color-scheme editor beyond presets; Dock badge with overdue count; sync-mode selector for manual, balanced, and near-real-time; past-event retention cutoff where 0 means keep forever; past-task/overdue cleanup behavior configuration; in-app update checker using GitHub Releases polling, version comparison, and download prompt; macOS Share extension to quick task; App Intents for Shortcuts to open task editor, open event editor, and open Today; Today print export.
- Data import/export and attachments: portable .hcbexport package with manifest, state, bundled attachments, SHA-256 verification, and dry-run import diff; ICS calendar import; local file attachments for notes/events with image/file refs; local-pointer-repair UI for broken attachment paths.
- Today/Home surface: dedicated Today view showing overdue, due-today, and upcoming events while respecting sidebar filters.
- Performance and ops: low-power-mode and constrained-network detection feeding sync backoff multipliers; prepared snapshots/pre-bucketed event indexes for large accounts with a 15k-event regression suite target; notification permission primer screen separate from generic onboarding.
- Localisation: string catalogue/i18n scaffold equivalent to the original app's .xcstrings coverage for the React app.

Complete every Partial item or re-classify it with evidence:
- Snooze: surface inspector controls and any missing snooze UX around local_snooze_until/snoozeUntil.
- Task templates/Event templates: implement expander logic and template-instantiation UX, including {{today}}, {{+Nd}}, {{prompt:Label}}, and {{clipboard}}.
- Local notification scheduling: surface customizable lead times such as 9 AM due-date task notifications and 15-minute event notifications, and document/handle the 64-notification cap behavior.
- History: add renderer history-window UI for mutation logs beyond MCP audit.
- Subtask hierarchy: expose hierarchical edits in the task inspector while preserving Google Tasks parent/child sync.

Resolve every Genuinely Unclear item with runtime/static evidence:
- MCP tool catalogue parity vs original, including exact tool names such as hcb_today, hcb_week, hcb_search, hcb_create_task, and per-tool dry-run/confirm-write/allow-write permission modes.
- Snooze UX depth.
- Template engine behavior.
- Recurrence editing depth in CalendarEventForm.tsx and recurrence sync code.
- Subtask UX depth.

Implementation requirements:
- Add migrations and typed IPC/contracts where schema or renderer/main boundaries change.
- Keep security posture intact: no credential leaks, no weakened CSP, no remote code loading, no unsafe SQL/string query construction, no silent permission bypass.
- Preserve existing Google Tasks/Calendar sync semantics and offline replay behavior.
- Add focused unit/integration tests for parsers, migrations, reducers/stores, IPC, search/filter DSL, keybindings, import/export verification, encryption, notification scheduling, and calendar recurrence behavior.
- Add Playwright/manual QA coverage for major user workflows: Today, Kanban, tags/areas, calendar views, advanced search/pinned filters, settings, import/export, attachments, update checker, and share/intent flows where locally testable.
- Update docs and the gap file as each item is implemented or re-classified.

Do not:
- Claim parity until every listed gap is implemented, verified, or explicitly deferred by the user.
- Auto-refactor unrelated modules.
- Start Linux/Windows port work from this prompt.
- Copy protected UI, branding, exact copy, icons, or proprietary behavior from reference apps.
- Hide unresolved static-read uncertainty; label it with evidence and next action.

Acceptance checks:
- Run install/build/typecheck/unit tests relevant to the implemented slices.
- Run Playwright smoke/regression flows for changed UI.
- Run any migration/import/export/encryption verification commands added by the implementation.
- Manually verify the highest-risk workflows from the user-approved plan.
- Final summary must include implemented gaps, deferred gaps with user-approved reasons, test commands/results, manual QA evidence, migration/data-safety notes, and any remaining risk.
```

## July 2026 Frontend Reference Prompts

Run these before the platform port prompts. Each visual prompt should be run with screenshots attached in the chat or placed under the suggested local folders:

- `artifacts/reference-screenshots/apple-calendar/`
- `artifacts/reference-screenshots/notion-calendar/`
- optional current Hot Cross Buns 2 before screenshots: `artifacts/reference-screenshots/hcb-before/`

Use Apple Calendar and Notion Calendar as reference products only. Extract layout, density, navigation, interaction, and performance lessons. Do not copy protected branding, exact icons, exact copy, product names in UI, or proprietary artwork. Do not add other reference products unless they are explicitly re-added later.

## P0 User-Facing Customization Layer

Run these three prompts (P0A, P0B, P0C) sequentially before any cross-platform adapter or port work. They establish a layered customization surface that lets end users reconfigure look, layout, and behavior of the app.

### Approach decision and rationale

Researched analogues: VS Code (JSON theme files + `workbench.colorCustomizations` + CSS variables in webviews), Obsidian (CSS snippets folder with hot-reload + CSS variables + TS plugin API), Discord mods BetterDiscord/Vencord (raw `*.theme.css` files + documented CSS variables like `--background-tertiary`, with explicitly unsandboxed JS plugins), Zed (layered JSON `settings.json`/`keymap.json` with context predicates), Neovim (full Lua + declarative `setup()` DSL pattern), Emacs (full elisp; the `setup`/`use-package` DSL retrospective explicitly warns that bespoke DSLs grow into ~3500 LOC of hard-to-extend code).

Decision: do not invent a new DSL. Use the dominant industry pattern, layered:

1. Theming: documented CSS custom properties (design tokens) + user-authored CSS snippets with hot-reload (Obsidian/BetterDiscord model). CSS already has IDE tooling, hot-reload, scoping, and a huge skill base.
2. Layout, density, panel order, keybindings: JSON config with JSON Schema validation and layered precedence (VS Code/Zed model). Declarative, diffable, machine-editable.
3. Behavior: a narrow sandboxed JS extension API with explicit extension points (VS Code/Obsidian plugin model, BUT with a real sandbox — BetterDiscord's lack of sandbox is the failure mode we explicitly reject).

Rejected alternatives: inventing a new theme DSL (extra surface area, no tooling, Emacs `setup` retrospective lesson), Lua/Wren/Rhai embedded interpreter (extra runtime weight, no clear user demand), unsandboxed JS like BetterDiscord (security model incompatible with credential storage and MCP local-only guarantees).

### P0A Theming Tokens And User CSS Snippets

Run alone first.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: ship the visual theming surface as documented CSS custom properties (design tokens) plus a user CSS snippets folder with hot-reload. Model: Obsidian CSS snippets + BetterDiscord-style documented CSS variables. Do not invent a new theme DSL.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md

Implement:
- Audit current renderer styles and lift all colors, typography, spacing, radii, shadow, and motion values into CSS custom properties on :root (and a [data-theme="dark"] variant if dark mode exists). Name them with a stable, documented prefix (e.g., --hcb-color-bg, --hcb-color-fg, --hcb-radius-sm) — this is the public theming contract.
- A user snippets directory under the platform-appropriate app data path (e.g., <userData>/snippets/*.css). Loader watches the directory and applies/removes <style> tags live. Production builds require explicit reload-on-change toggle in Settings; dev builds can hot-reload by default.
- Settings UI surface: list of detected snippets with enable/disable toggles, load-error display, "Open snippets folder" button, "Reset to defaults" button.
- A docs/customization/theming.md page that documents every public CSS custom property, scoping rules, and stability guarantees. Include 2-3 starter example snippets (e.g., compact density, high-contrast, alt accent color).
- Tests: token-presence test (no hard-coded colors remain in tracked component styles for the audited surfaces), snippet loader unit tests (enable/disable/reload/error surfacing), and a CSP regression test confirming user snippets load under the existing Content Security Policy.

Do not:
- Invent a new theme DSL, theme JSON format, or theme transpiler.
- Allow user CSS to escape its <style> scope to run script (verify CSP disallows inline JS and that loaded snippets are treated as text/css only).
- Break the existing default look and feel for users who add no snippets.
- Copy Discord, Obsidian, or any other product's variable names, branding, asset names, or copy verbatim. The prefix and token names must be original to this project.
- Ship remote-fetched themes, a theme marketplace, or auto-update of snippets in this prompt.

Acceptance checks:
- Run typecheck/build.
- Run unit tests for snippet loader and CSP regression.
- Manually drop a sample snippet in the folder; confirm live apply, disable via Settings, and reset-to-defaults.
- Summarize the public token list, snippet loader behavior, and any tokens still missing from the audit.
```

### P0B Declarative Config For Layout And Keybindings

Run alone after P0A.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: ship a JSON-based user config layer for layout, density, panel arrangement, and keybindings, with JSON Schema validation and layered precedence. Model: VS Code settings.json/keymap.json + Zed's context-aware keymap and settings layering. Do not invent a new DSL.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md
- docs/customization/theming.md (produced by P0A)

Implement:
- A settings.json file under the platform app data path covering: density preset, panel visibility, panel ordering, default view, sidebar contents, and feature toggles that are safe to expose. Defaults live in code; user file overrides via deep merge.
- A keymap.json file with an array of bindings ({ "keys": "...", "command": "...", "when": "..." }). The "when" predicate is a small, documented boolean expression over a fixed set of context atoms (e.g., focus.editor, view.calendar). Use a parser, not eval.
- JSON Schemas for both files, published under docs/customization/schemas/ and pointed to via $schema for editor IntelliSense.
- A SettingsStore that merges defaults <- settings.json with clear precedence, exposes typed accessors, and emits change events.
- Settings UI surface: open settings.json / keymap.json, view validation errors inline, reset-to-defaults per section.
- Command palette wired to the keymap so users can discover command IDs.
- Tests: schema validation (valid + invalid fixtures), precedence/merge behavior, "when" predicate parser unit tests, keybinding conflict detection.

Do not:
- Use eval() or new Function() for the "when" predicate — write a tiny tokenizer/parser limited to identifiers, &&, ||, !, parentheses.
- Expose settings that compromise security posture (credential paths, CSP, MCP local-only guarantees, updater feed URL) through user config.
- Allow user config to silently override permission prompts, credential dialogs, or updater prompts.
- Invent a YAML/TOML/custom syntax — JSON only, to match VS Code/Zed conventions and existing tooling.

Acceptance checks:
- Run typecheck/build.
- Run unit tests for schema, merge, predicate parser, and conflict detection.
- Manually edit settings.json and keymap.json; confirm live reload (or explicit reload prompt), validation error surfacing, and reset.
- Summarize the public setting and command IDs exposed, plus any settings deliberately withheld for security.
```

### P0C Sandboxed Extension API For Behavior

Run alone after P0B.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: ship a narrow, sandboxed JS extension API for user-authored behavior (commands, event hooks, view contributions). Model: VS Code/Obsidian extension API shape, BUT with a real sandbox — BetterDiscord/Vencord's unsandboxed model is explicitly rejected because it is incompatible with credential storage and MCP local-only guarantees.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md
- docs/customization/theming.md (P0A)
- docs/customization/schemas/ (P0B)

Implement:
- A user extensions directory (<userData>/extensions/<id>/{manifest.json,main.js}). Manifest declares id, name, version, requested capabilities, and entrypoint.
- A sandbox: extensions run in a dedicated isolated context (Electron utility process or sandboxed BrowserWindow with contextIsolation: true, nodeIntegration: false, no preload exposing Node). No fs, net, child_process, electron, or remote module access. All host calls go through a versioned, capability-gated message bridge.
- A minimal host API exposed via the bridge: registerCommand(id, handler), onEvent(name, handler) for a fixed event set, contributeView(extensionPoint, descriptor), getSetting(key) for whitelisted keys only. No setSetting in v1.
- Capability declaration in manifest gated by user consent in Settings on first load. Deny by default. Per-extension enable/disable, view logs, view requested capabilities.
- A "safe mode" launch flag that disables all user extensions and snippets, surfaced both in Settings and as a CLI flag, for recovery.
- Tests: sandbox escape tests (attempt to access window.require, process, fs, electron — must fail), bridge contract tests, capability gating tests, safe-mode tests.
- docs/customization/extensions.md covering the API surface, stability tier (experimental), security model, and a "hello-command" sample extension.

Do not:
- Expose Node, Electron, fs, net, child_process, or any IPC channel beyond the documented bridge.
- Allow extensions to read credentials, exfiltrate data, modify the updater feed, weaken CSP, or bypass MCP local-only guarantees.
- Ship a plugin marketplace, remote install, or auto-update of extensions in this prompt.
- Permit extensions to override security-relevant UI (permission prompts, credential dialogs, update prompts, MCP consent).
- Copy VS Code, Obsidian, or BetterDiscord API shapes verbatim — design the host API minimally for this app's actual extension points.

Acceptance checks:
- Run typecheck/build.
- Run sandbox escape tests, bridge contract tests, capability tests.
- Manually load the hello-command sample; confirm command palette registration, capability consent prompt, disable/enable, and safe-mode flag behavior.
- Summarize the host API surface, sandbox boundaries, capabilities defined, and which extension points are deferred to a later prompt.
```

## Future Platform Prompts

Run these only after Mac v1 is stable and after P0 has landed. Do not run Linux and Windows port work in parallel for the first pass. Linux is the first non-Mac port; Windows follows after the Linux adapter lessons are incorporated.

### P8A Cross-Platform Adapter Audit

Run alone after Mac v1.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: audit and prepare the shared platform adapter layer before Linux and Windows port work begins.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/ports/cross-platform-porting.md
- docs/ports/linux-port.md
- docs/ports/windows-port.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/03-database-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md

Implement:
- Identify current Mac-only assumptions in platform paths, credentials, tray, menu, shortcuts, notifications, custom protocol, autostart, updater, diagnostics, OAuth, MCP, packaging, and tests.
- Create or refine shared adapter interfaces for the platform capabilities listed in docs/ports/cross-platform-porting.md.
- Add capability-report DTOs exposed through preload/settings where appropriate.
- Add adapter contract tests that can run without Linux or Windows.
- Use docs/improvements/ to classify parity items as platform implementation, shared backend/database work, tests, release docs, manual QA, or backlog.
- Update docs if the adapter contract changes.

Do not:
- Break macOS behavior.
- Implement Linux or Windows packaging in this prompt.
- Claim non-Mac platform support.
- Put platform-specific logic directly into renderer components.

Acceptance checks:
- Run shared tests.
- Run typecheck/build.
- Summarize Mac-only assumptions found, adapter contracts added, and blockers for Linux.
```

### P8B Linux Port Foundation

Run alone after P8A.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement the Linux platform foundation without claiming broad Linux release readiness.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/ports/cross-platform-porting.md
- docs/ports/linux-port.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md

Implement:
- Linux adapter implementations or stubs for app paths, credentials, tray/status area, global shortcuts, notifications, custom protocol, autostart, updater metadata, external open behavior, and diagnostics.
- Capability detection for Secret Service/libsecret availability, tray support, X11 vs Wayland, portal global shortcut availability where feasible, notification support, and protocol registration status.
- Linux settings/diagnostics surfaces that show capability status and caveats.
- Linux-specific automated tests that can run on non-Linux via adapter mocks, plus Linux-only tests where appropriate.
- Use the improvement docs to keep feature parity Electron-native and to separate platform blockers from shared backend blockers.
- Documentation updates for any implementation choices that differ from docs/ports/linux-port.md.

Do not:
- Break macOS behavior.
- Claim universal Linux parity.
- Enable plaintext credential fallback.
- Enable in-place auto-update before package behavior is verified.

Acceptance checks:
- Run shared tests.
- Run typecheck/build.
- Run Linux adapter tests.
- Summarize Linux capabilities, unsupported features, manual checks required, and remaining packaging blockers.
```

### P8C Linux Packaging And Desktop QA

Run alone after P8B. Run on Linux if possible; otherwise produce config/docs and mark runtime checks as blocked.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: create and verify the Linux technical preview packaging path, starting with AppImage.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/ports/linux-port.md
- docs/ports/cross-platform-porting.md
- docs/release/distribution.md
- docs/performance/build-and-test-performance.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Implement:
- electron-builder Linux config for AppImage first.
- Desktop file metadata, icon configuration, categories, keywords, and StartupWMClass where needed.
- Custom protocol registration configuration if supported by the chosen package target.
- Linux install/run/uninstall notes in release docs.
- Linux manual QA checklist document under docs/release or docs/ports if it does not already exist.
- Linux performance smoke instructions for AppImage and installed package paths.
- Reference the improvement docs when adding release, updater, native lifecycle, test, or manual QA instructions.
- Optional DEB/RPM docs only if AppImage baseline is already clear.

Do not:
- Claim automatic Linux updates unless package/update behavior is implemented and tested.
- Claim GNOME/KDE/Wayland/X11 parity without manual evidence.
- Store signing or release secrets in the repo.

Acceptance checks:
- Run typecheck/build.
- Run Linux package command if on a suitable Linux environment.
- Run Playwright launch smoke on Linux if possible.
- Run performance smoke report on Linux if possible.
- Record pass/fail/manual-blocked status for tray, global shortcut, notifications, OAuth, MCP, protocol links, desktop integration, and AppImage launch.
```

### P9A Windows Port Foundation

Run alone after the Linux technical preview work has landed.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: implement the Windows platform foundation without claiming broad Windows release readiness.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/specs/platforms.md
- docs/ports/cross-platform-porting.md
- docs/ports/windows-port.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/performance/build-and-test-performance.md
- docs/testing/qa-plan.md
- docs/improvements/01-user-facing-feature-parity.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md
- docs/improvements/06-frontend-ux-ui-competitive-improvements.md

Implement:
- Windows adapter implementations or stubs for app paths, credential storage, tray, global shortcuts, notifications, custom protocol, autostart, updater metadata, external open behavior, and diagnostics.
- Stable AppUserModelID/app identity wiring early in startup.
- Windows settings/diagnostics surfaces that show tray, shortcut, notifications, protocol, updater, signing, and SmartScreen status where known.
- Windows-specific automated tests that can run on non-Windows via adapter mocks, plus Windows-only tests where appropriate.
- Use the improvement docs to keep feature parity Electron-native and to separate platform blockers from shared backend blockers.
- Documentation updates for any implementation choices that differ from docs/ports/windows-port.md.

Do not:
- Break macOS or Linux behavior.
- Claim Windows release readiness until installer, notification, protocol, OAuth, MCP, and performance checks run on Windows.
- Enable automatic updates before installer identity, signing, and release metadata are tested.
- Store certificates or signing secrets in the repo.

Acceptance checks:
- Run shared tests.
- Run typecheck/build.
- Run Windows adapter tests.
- Summarize Windows capabilities, unsupported features, manual checks required, signing blockers, and packaging blockers.
```

### P9B Windows Packaging And Signing QA

Run alone after P9A. Run on Windows if possible; otherwise produce config/docs and mark runtime checks as blocked.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: create and verify the Windows technical preview packaging path, starting with NSIS, and document signing/SmartScreen expectations.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/ports/windows-port.md
- docs/ports/cross-platform-porting.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/build-and-test-performance.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Implement:
- electron-builder Windows config for NSIS first.
- AppUserModelID, executable name, installer display name, Start Menu shortcut, protocol registration, and icon metadata.
- Windows install/run/uninstall notes in release docs.
- Signing plan documentation covering unsigned internal preview, Microsoft Store MSIX option, Azure Artifact Signing/Trusted Signing, OV certificate, and self-signed dev-only behavior.
- Windows manual QA checklist document under docs/release or docs/ports if it does not already exist.
- Windows performance smoke instructions for installed NSIS builds.
- Reference the improvement docs when adding release, updater, native lifecycle, test, or manual QA instructions.

Do not:
- Commit certificates, passwords, tokens, or signing secrets.
- Claim public Windows distribution readiness without a signing plan.
- Claim SmartScreen will not warn unless the chosen distribution path proves that.
- Enable in-place auto-update before signed installer/update metadata are verified.

Acceptance checks:
- Run typecheck/build.
- Run Windows package command if on a suitable Windows environment.
- Run Playwright launch smoke on Windows if possible.
- Run performance smoke report on Windows if possible.
- Record pass/fail/manual-blocked status for installer, Start Menu launch, taskbar grouping, tray, global shortcut, notifications, OAuth, MCP, protocol links, uninstall, and SmartScreen/signing expectations.
```

### P10 Cross-Platform Release Hardening

Run alone after Linux and Windows technical preview work has landed.

```text
You are Codex 5.5 running with extra-high reasoning in /Users/gongahkia/Desktop/coding/projects/hot-cross-buns-2.

Goal: harden the cross-platform release story after macOS, Linux, and Windows preview paths exist.

Read first:
- docs/README.md
- docs/agents/workflow.md
- docs/ports/cross-platform-porting.md
- docs/ports/linux-port.md
- docs/ports/windows-port.md
- docs/specs/platforms.md
- docs/release/distribution.md
- docs/security/privacy-and-threat-model.md
- docs/performance/performance-strategy.md
- docs/testing/qa-plan.md
- docs/improvements/02-backend-optimizations.md
- docs/improvements/04-test-coverage-parity.md
- docs/improvements/05-general-parity-and-release-polish.md

Tasks:
- Audit platform adapters for duplicated logic, drift, unsafe fallbacks, and renderer platform branching.
- Verify all platform capability reports are exposed consistently in Settings and Diagnostics.
- Verify install/update/uninstall docs match actual package behavior.
- Verify performance smoke reports exist or are explicitly blocked per platform.
- Verify manual QA checklists exist for macOS, Linux, and Windows.
- Use the improvement docs to classify unresolved parity work as shared backend, tests, release polish, platform caveat, or explicit backlog.
- Update roadmap/docs to distinguish supported, technical preview, and unsupported features by platform.

Do not:
- Add new platform scope.
- Claim parity where platform caveats remain unresolved.
- Weaken security, credential storage, or MCP local-only guarantees to simplify a port.

Acceptance checks:
- Run full available test suite.
- Run typecheck/build.
- Run packaging checks available on the current host.
- Produce or update a cross-platform release readiness report with blockers per platform.
```
