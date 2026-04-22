# URGENT-TODO

Active work remaining for Hot Cross Buns as a daily-driver Google Tasks / Calendar client. Ordered by what blocks shipping or what the next maintainer should pick up first. For shipped work see `COMPLETED.md`.

Core invariant: Google Tasks + Google Calendar are the source of truth. Every feature below round-trips to Google or is explicitly local-only app config (keybindings, templates, themes, cache). Nothing invents a data field Google cannot see without a deliberate, documented notes-marker encoding.

Ranking principle:

1. **§0** — immediate next task: full macOS-native design audit.
2. **§1–§5** — setup + QA that block a shippable build. Cannot ship without these.
3. **§7–§8** — visual polish / perf / battery passes.
4. **§9** — deprioritized extended-interop work.
5. **§10** — cybersecurity hardening.
6. **§11** — least-priority: daily local backup (implement last).
7. **§12–§14** — carve-outs / deferred roadmap / known residual risks. Reference only.

## 0. [Next task] macOS-native design audit + refactor

**Do this immediately, before any other §-numbered work below.**

Sequence is strict:

1. **Git commit the current HEAD state first.** The audit will touch many files; a clean snapshot lets us revert any individual finding's fix without losing others. Single commit, message: `chore: checkpoint before macOS-native design audit`. No code changes in this commit — just stage + commit whatever is currently uncommitted.

2. **Hand the audit off to Codex.** Do NOT run this audit with Claude Code. Give Codex explicit latitude to take as much time as it needs. The prompt below is the contract — copy it verbatim into the Codex task.

### Codex prompt (verbatim)

> You are auditing `Hot Cross Buns` — a native macOS SwiftUI app at `apps/apple/HotCrossBuns/` — for adherence to macOS-native design conventions. Do NOT rush. Take as long as you need.
>
> **Phase 1 — Research (read-only, no code changes).**
>
> Before examining any of this repo's code, research and internalize what "a native macOS app" looks like. Read Apple's Human Interface Guidelines for macOS (<https://developer.apple.com/design/human-interface-guidelines/>), SwiftUI on macOS specifics, AppKit-to-SwiftUI bridging idioms, and examine the visual + interaction patterns used by Apple Calendar, Reminders, Mail, Notes, Messages, System Settings, Finder, Console, Shortcuts, and the stock Settings-app chrome. Catalog:
>
> - Window chrome conventions (toolbar placement, title bar buttons, toolbar item grouping, `.windowStyle`, `.windowToolbarStyle`).
> - Sidebar / NavigationSplitView conventions, row heights, sidebar item styling, source-list vs unified.
> - Control metrics: `.controlSize` defaults, `.bordered` vs `.borderedProminent` vs `.plain` button usage, `.toggleStyle(.button)` vs `.switch`, Picker styles.
> - Form conventions: `.formStyle(.grouped)`, `Section` with footers, `LabeledContent`, native-looking row rhythm.
> - List conventions: `.listStyle(.inset)` vs `.plain` vs `.sidebar`, row separators, hover affordances, disclosure chevrons, context menus.
> - Typography: system font weights per hierarchy, `.monospacedDigit()` placement, `.font(.title3.weight(.semibold))` conventions.
> - Color: system accent color usage, `.secondary` / `.tertiary` semantic tints, avoiding app-specific brand colors for structural chrome (reserve them for genuinely branded elements).
> - Dark-mode behavior, `.preferredColorScheme` propagation, materials (`.regularMaterial`, `.thinMaterial`), vibrancy.
> - Popovers + sheets: when each is appropriate, arrowEdge conventions, sizing norms, Form-inside-popover vs bare VStack.
> - Keyboard: `.keyboardShortcut`, `.defaultAction` / `.cancelAction` on alert buttons, Esc/Return routing, tab traversal, focus rings.
> - Animation: subtlety bar — native macOS animations are shorter and less bouncy than iOS.
> - Accessibility: `.accessibilityLabel`, Voice Over rotor support, keyboard-only navigation.
> - Context menus: `.contextMenu` on every surface users can interact with, standard menu items (Open, Duplicate, Delete, Convert, Copy as Markdown, Show in Finder equivalents).
> - Drag & drop: `.draggable` / `.dropDestination` conventions, drag preview styling.
> - Menu bar extra apps: monochromatic status-bar icons, compact dropdown panels, system-consistent spacing.
> - Native idioms that HCB might be reinventing with custom chrome.
>
> Document what you learned in `docs/MACOS_DESIGN_REFERENCE.md` (new file, in the repo). This is the reference you'll audit against.
>
> **Phase 2 — Audit (read-only, produce a report).**
>
> With the reference document in hand, walk every view under `apps/apple/HotCrossBuns/Features/` and `apps/apple/HotCrossBuns/Design/` and `apps/apple/HotCrossBuns/App/`. For each view, note every place HCB deviates from the macOS idiom. Categorize findings:
>
> - **Critical** — the app looks or behaves unlike a native macOS app in a way a user will immediately notice (e.g., non-native chrome, iOS-flavored components, custom-drawn controls instead of system ones, wrong typography scale, custom accent colors replacing system accent where system accent is the convention).
> - **High** — deviations that a discerning Mac user would flag (e.g., custom capsule toggles instead of `.toggleStyle(.button)`, non-standard row heights, missing hover affordances on clickable rows, non-standard sheet/popover sizing).
> - **Medium** — polish items (micro-inconsistencies in padding, font weight mismatches, color token misuse in non-chrome surfaces, missing context menus where platform expectation is to have one).
> - **Low** — style nits that don't measurably affect perceived nativeness.
>
> For each finding: cite the specific file path + line number range, describe the deviation, state the native convention, and propose a concrete fix (which SwiftUI modifier / API / restructuring). Write the report as `docs/MACOS_DESIGN_AUDIT.md`.
>
> **Phase 3 — Refactor (code changes).**
>
> Work through the findings Critical → High → Medium. For each finding, apply the proposed fix as its own git commit so every change can be reverted independently. Commit message format: `fix(ui/macos-audit): <short description of the finding>`. Keep the `hcbFont` / `hcbScaledPadding` / `hcbScaledFrame` / `AppColor` design-token system intact where it already matches native conventions; replace only the tokens that deviate. Do not touch Low findings unless Critical/High are all resolved.
>
> Build after every commit (`xcodebuild` via the repo's Makefile) so the branch never has a broken intermediate state. If a finding can't be fixed without a larger restructure, record it in `docs/MACOS_DESIGN_AUDIT.md` under a "Deferred" section with the reason.
>
> **Constraints.**
>
> - Preserve all existing functionality. This is a pure-chrome pass — no behavioral changes.
> - Preserve the existing `HCBColorScheme` / per-surface font override system; those are intentional user-facing customizations, not deviations.
> - Preserve the existing `.withHCBAppearance` propagation pattern for detached Window scenes; that's correct.
> - Stay faithful to the user's custom color schemes (`notion`, etc. in `ColorSchemes.swift`) — don't replace them with system-only colors. The deviation to flag is when *structural* chrome (toolbar backgrounds, sidebar backgrounds, selection highlights) uses a brand color where the system accent or a material would be more native. Content-level accents (task dots, calendar colors, duplicate badges) are legitimate brand uses.
> - Keep the deployment target at macOS 14.0; don't use macOS 15+ APIs without a `@available` guard.
>
> Report back when done with: (a) the total number of findings per category, (b) the number addressed vs deferred, (c) the commit range.

## 1. Google OAuth wiring

Cannot be done from repo code alone. `apps/apple/Configuration/GoogleOAuth.xcconfig` is still absent (only `.example` present), so `GoogleAuthService.isConfigured` returns false and sign-in is disabled.

- Create or choose a Google Cloud project for Hot Cross Buns.
- Enable the Google Tasks API and Google Calendar API in that project.
- Configure OAuth consent for personal/internal use.
- Create an OAuth client ID for the macOS bundle ID `com.gongahkia.hotcrossbuns.mac`.
- Copy `apps/apple/Configuration/GoogleOAuth.example.xcconfig` to `GoogleOAuth.xcconfig` (already in `.gitignore`) and fill in:
  ```
  GOOGLE_MACOS_CLIENT_ID = <client id>.apps.googleusercontent.com
  GOOGLE_MACOS_REVERSED_CLIENT_ID = com.googleusercontent.apps.<reversed id>
  ```
- In Xcode, attach that xcconfig to the `HotCrossBunsMac` target's Debug + Release configurations.
- Verify sign-in, disconnect, reconnect, and incremental scope grant behavior with a real Google account.

## 2. Sparkle auto-update provisioning

`SUPublicEDKey` is still missing from `apps/apple/HotCrossBuns/Support/Info-macOS.plist`. Sparkle will refuse updates without it.

- Run Sparkle's `generate_keys` (bundled in the SwiftPM package's derived-data directory, or downloadable from the Sparkle GitHub release) once per machine.
- Paste the **public** key into `Info-macOS.plist` under `SUPublicEDKey` via a build setting or direct edit.
- Store the **private** key as GitHub Actions secret `SPARKLE_PRIVATE_KEY`.
- Enable GitHub Pages on the `gh-pages` branch so `https://gongahkia.github.io/hot-cross-buns/appcast.xml` serves.
- Confirm the first release publishes an appcast entry and that a previously installed build picks it up via in-app "Check for Updates".

See `docs/RELEASING.md` for the end-to-end flow.

## 3. Apple Developer ID + notarization

GitHub Actions release workflow references these secrets (not yet set); without them the DMG ships unsigned and Gatekeeper warns on first open.

- Enroll or sign in with the intended Apple Developer account.
- Create/export a Developer ID Application certificate as a `.p12` for website DMG distribution.
- Add these GitHub Actions secrets for release signing in CI:
  - `MACOS_DEVELOPER_ID_P12_BASE64`
  - `MACOS_DEVELOPER_ID_P12_PASSWORD`
  - `MACOS_DEVELOPER_ID_APPLICATION`
  - `KEYCHAIN_PASSWORD`
  - `APPLE_ID`
  - `APPLE_TEAM_ID`
  - `APP_SPECIFIC_PASSWORD`
  - `NOTARIZE_MACOS_DMG` set to `1`
- Download the CI DMG and confirm Gatekeeper opens it without unsigned-app warnings.

### 3a. Undo the local-QA entitlements workaround before shipping

During live QA on a machine without an Apple Developer team, `make run` / `make build` were pointed at a stripped-down **`HotCrossBuns-Dev.entitlements`** (network client only, **sandbox disabled**) so GoogleSignIn's Keychain write wouldn't fail. Ad-hoc signed + sandboxed builds hit `GIDSignIn Code=-2 "keychain error"` because the team-prefix access group expansion needs a real provisioning profile.

Before cutting a production DMG:

- Restore `CODE_SIGN_ENTITLEMENTS` in the `Makefile` back to `HotCrossBuns/Support/HotCrossBuns.entitlements` (or remove the override so Xcode's default from `project.yml` applies).
- Re-add the two entitlements that were stripped from `HotCrossBuns.entitlements` during local QA:
  - `com.apple.security.application-groups` → `group.com.gongahkia.hotcrossbuns` (Share Extension ↔ main app handoff)
  - `keychain-access-groups` → `$(AppIdentifierPrefix)com.gongahkia.hotcrossbuns.mac` (proper Keychain scope once we have a team ID)
- Re-add the matching `application-groups` to `HotCrossBunsShareExtension.entitlements`.
- Delete `HotCrossBuns/Support/HotCrossBuns-Dev.entitlements` after confirming the prod build signs cleanly with the Developer ID cert.
- Verify sign-in still works on a release build (the GoogleSignIn Keychain path should then succeed because the team-prefixed access group resolves against the real provisioning profile).

### 3b. Clean up Google Cloud project after QA

Post-QA / before handing off to other users, revisit <https://console.cloud.google.com/auth/clients>:

- Audit the existing OAuth client for unused redirect URIs / platforms.
- Decide whether to keep the app in **Testing** mode (caps at ~100 test users, no verification needed) or submit for **Production** verification (required for any public distribution — Google reviews the scopes).
- If multiple throwaway clients were created during QA, delete the unused ones so the Credentials list stays clean.
- Confirm the enabled APIs list is still just **Tasks API** + **Calendar API** — nothing else should have been enabled accidentally.

## 4. Single-window + 2-tab sidebar on-device verification

On-device checks still outstanding:

- `open build/apple/DerivedData/Build/Products/Debug/HotCrossBunsMac.app` twice in a row — second launch should just foreground the existing window, not create a new one.
- Cmd+N invokes "New Task" (our override), not "New Window".
- Sidebar lists Calendar / Store and renders badges for Calendar (today's event count) and Store (open task count).
- Cmd+, opens the dedicated Settings window (separate scene).
- Cmd+Shift+P opens the "Print Today" sheet.

## 5. Live product QA

Dogfood with a real account for at least one workday on macOS. Smoke checklist:

1. Sign in with real Google account via Settings → Google account → Connect Google.
2. Refresh; confirm task lists + calendars populate.
3. Create a task → confirm it appears in Google Tasks web UI.
4. Verify task edit / complete / reopen / delete round-trips against Google Tasks web UI.
5. Create an all-day event and a timed event → confirm they appear in Google Calendar web UI with the configured reminder.
6. Verify event edit / delete, all-day event behavior, and popup reminders against Google Calendar web UI.
7. Delete a task in the web UI; trigger Refresh in-app; verify the task disappears (tombstone purge working).
8. Confirm selected task lists/calendars persist across app relaunches and sync cycles.
9. Confirm local reminders are neither duplicated nor stale after edits/deletes.
10. Toggle `Menu bar extra` off/on in Settings → confirm the menu bar icon hides/shows.
11. Toggle `Dock badge for overdue tasks` off → confirm badge clears; on → matches overdue count.
12. Spotlight for a task title → confirm a result appears and clicking opens the task detail inside the app.
13. Confirm menu bar extra popover renders and quick-add works.
14. Sync menu → Check for Updates → confirm Sparkle dialog opens (will show "no updates" until an appcast entry is published).
15. ~~Recurring event single-occurrence edit (originalStartTime check).~~ — Verified passing in live QA (both title-edit and drag-reschedule paths). See `COMPLETED.md`.
16. **Share Extension round-trip.** In Safari, pick a web page → Share → Hot Cross Buns. App should foreground and open QuickAdd with the page URL prefilled. If the extension doesn't appear in Safari's Share menu, log out/in (or Finder → kill and relaunch) — macOS is finicky about picking up new share extensions on first install.
17. **Services menu round-trip.** Select text anywhere (TextEdit, a web page) → right-click → Services → "Create Hot Cross Buns task". App should foreground and open QuickAdd with the selection prefilled.
18. **.ics drop.** Export a Google Calendar to `.ics` (Settings → Import/Export) and drag onto the Calendar view. Should create events on the first writable calendar. Drop the same file a second time — alert should say "skipped N duplicates, imported 0".

## 7.01 Visual reference — shipped

All four phases of the frontend refactor landed. See `COMPLETED.md` § "§7.01 Visual reference — frontend refactor" for the shipped scope.

## 7.02. Performance optimisation and RAM / memory usage

First pass landed: CalendarMirror retention window (Settings → Sync → "Keep past events", clamped to [0, 3650] days, default 365; 0 = keep-forever) + MonthGridView per-pass hoist of `filteredEvents` / `eventsByDay` so week bands don't re-iterate the whole events list per row. Pruning in `SyncScheduler.mergeEvents` preserves pending optimistic writes and recently-updated events so a user opening a past meeting to edit notes doesn't see it vanish.

Second pass shipped (Phase A + B per perf-investigation notes, 2026-04-22):
- A1: `AppModel.scheduleCacheSave()` debounces cache writes to 500ms; sync-flush bursts coalesce into a single disk hit. `flushPendingCacheSave()` is bound to scenePhase background to guarantee no in-flight write is lost on suspend.
- A2: `AppModel.eventsByCalendar` index built once per `rebuildSnapshots()`, consumed by Month/Week/Day grid `visibleEvents` / `filteredEvents` so per-render filters operate on already-bucketed events instead of the full corpus (~17k+ → ~3k typical).
- A3: `AppModel.scheduleRebuildSnapshots()` coalesces upsert/remove-driven rebuilds via `DispatchQueue.main.async` — multiple rapid mutations (e.g. a sync flush of dozens of upserts) collapse to one rebuild per runloop tick.
- B2: `LocalCacheStore` splits events into `cache-events.json` sidecar; main `cache-state.json` no longer carries events. `lastEventsHash` gates sidecar writes so settings/task-only mutations never touch the multi-MB blob. Legacy monolithic-format cache files migrate transparently on first save. Encrypted setups encrypt main + sidecar independently. Tests in `LocalCacheStoreSplitTests` cover split, merge, hash skip, etag-bust, legacy migration, encrypted roundtrip, and corrupt-sidecar fallback.

Still to do (Phase C — deprioritized, do only if perceived perf is still sluggish after A+B):

### Phase C — Split AppModel into per-resource @Observable stores

`AppModel` is currently one `@Observable` class holding all state (~20 published properties: tasks, events, calendars, settings, syncState, etc.). Any change to any property invalidates every view that observes AppModel via `@Environment(AppModel.self)`. So a sync writing events causes Tasks/Notes/Settings views to re-evaluate even though they don't read events.

Goal: split AppModel along resource boundaries so each view subscribes only to what it actually reads.

Proposed shape:
- `EventStore: @Observable` — events, eventsByCalendar, calendarSnapshot, calendars selection.
- `TaskStore: @Observable` — tasks, taskLists, taskSections, taskListCompletionStats, todaySnapshot.
- `SettingsStore: @Observable` — AppSettings + per-tab list filters + view modes.
- `SyncStore: @Observable` — syncState, authState, pendingMutations, syncCheckpoints, lastMutationError, isSyncPaused.
- `AppModel` remains as a coordinator that holds references to all stores and provides the public API (createEvent, updateTask, etc.). Mutations flow through AppModel which dispatches to the right store(s).

Why deprioritized:
- Phase A+B already cuts the worst-case work per render by ~95% via pre-bucketing + coalesced rebuilds + cache split. If user-perceived launch / scroll perf is acceptable after A+B (especially after a cold-launch with the 15 MB cache), Phase C may not be worth the diff.
- Estimated diff is ~30 file touches. Every view that reads `model.X` needs to be reconnected to the right store via a new `@Environment` key.
- Some logic that crosses resource boundaries (e.g., `rebuildSnapshots` populates both task and event snapshots) needs careful extraction so the stores don't end up tightly coupled again.

Trigger criteria — start Phase C only when one of these holds:
- Cold launch from a >50k event cache exceeds 4s to interactive.
- Calendar scroll drops below 30fps during an active sync flush.
- Profiling shows an `@Observable` republish chain longer than ~6 hops on any single mutation.

Phase C plan once triggered:
1. Extract `EventStore` first (largest and most isolated). Move `events`, `eventsByCalendar`, `calendarSnapshot`, `calendars`. Wire grid views to `@Environment(EventStore.self)`. AppModel keeps a reference and proxies mutation API.
2. Extract `TaskStore` next. Move tasks/taskLists/taskSections/snapshots. Wire Tasks/Notes views.
3. Extract `SettingsStore` last. Move `settings` and `setX` setters. Pure config — least likely to thrash.
4. `SyncStore` if needed — `syncState` already invalidates AppStatusBanner only, may not justify its own store.

Audit after each extraction: `git grep "@Environment(AppModel.self)"` should shrink as views migrate.

Other still-to-do items unrelated to Phase C:
- Image caching for `LocationMapPreview` / map snapshots.
- Lazy-loading for large Store task lists (verify `List` is lazy; confirm Kanban / Timeline columns don't instantiate every card up-front).
- Measure first-paint and scroll jank on a real account before optimising blindly.

## 8. Battery optimisation

Ensure foreground polling + background refresh don't drain battery. Includes: respecting `NetworkMonitor` low-power mode, throttling polling when window unfocused, suspending calendar grid animations off-screen, checking Spotlight indexer load.

## 9. Deprioritized extended interop

Implement only after §6 and §7/§8. Order within this section flexible.

### 9.1 Multi-format import / export

Readers + writers beyond the existing ICS path. All imports create real Google Tasks/Events; all exports are read-only snapshots. No parallel local store.

- **Readers:** Things 3 (SQLite db or JSON export), Todoist (JSON/CSV API export), Apple Reminders (EventKit), OmniFocus (OFOCUS archive or taskpaper export), TaskPaper (plain text), org-mode (plain text + PROPERTIES), Microsoft To Do, Google Keep lists.
- **Writers:** Markdown (per-task and digest), TaskPaper, org-mode, OPML, CSV, JSON.
- Progress UI for long imports with per-item failure reporting.
- Dedup on re-import (same as ICS flow).

### 9.2 Optional CLI surface (`hcb`)

Thin CLI that talks to the running app via local IPC (Unix socket or XPC) — does not open a second Google session. Commands: `add`, `list`, `complete`, `search`, `agenda`, `open <id>`. Read paths query the mirror; write paths dispatch through the same `OptimisticWriter`.

### 9.3 MCP servers for AI agent integration

Expose the mirror + mutation surface as an MCP server so external AI agents (Claude Desktop, others) can read tasks/events and propose changes. Every write still flows through the confirmation-gated path in §9.4. No background agent writes to Google without user approval.

### 9.4 Optional BYOK AI manager

User supplies their own API key (Anthropic / OpenAI). Natural-language input + image upload. Every interpreted action is presented as a diff-style confirmation before any Google write. Never auto-executes. Never stores API keys in plaintext — Keychain only. Deprioritized because it's additive, not blocking.

### 9.5 Telegram bot layer

Essentially a wrapper around the core functionality of hot cross buttons that allows users to plug in their telegram and call it as a bot and get updates. ensure there's hardening, sufficient hardening, especially since this is a remote endpoint. Clarify further is required, but I think that's a rough idea for now. 

## 10. Cybersecurity hardening

Pass 1 shipped (URL-scheme + NL parser audits clean; Shared Inbox trust model + os_log privacy fixed — see `COMPLETED.md` § "§10 Cybersecurity hardening — audit pass 1").

Remaining:
- Verify all Google API responses are decoded against strict Codable schemas; no eval-style paths. (Large surface — separate focused pass.)
- Verify Keychain access groups are correctly scoped post-§3a. Blocked until a real Apple Developer team-ID lands (see §3a).
- Dependency vulnerability scan on SwiftPM graph (GoogleSignIn, Sparkle, etc.). Requires external tooling (e.g., GitHub Dependabot, `swift package audit` when stable).

## 11. Daily local backup (least priority — implement last)

Defensive copy. Only exists for the case where Google loses user data on both surfaces (web + HCB cache). Not a sync target. Not a SoT.

- Off by default. Settings toggle + interval picker (off / daily / every N hours / on-launch only).
- Storage location: user-configurable, default `~/Library/Application Support/HotCrossBuns/backups/` with day-stamped files. User can redirect to iCloud Drive / external disk.
- Retention: user-configurable (keep last N / keep N days). Default: keep last 14.
- **Schema priorities:**
  1. **Storage-compact.** Must stay small with thousands of events + tasks. Use a binary-ish layout: MessagePack or CBOR top-level, per-record field interning for repeated strings (list IDs, calendar IDs, tag names), varint timestamps, gzip the outer file. Target <1MB per 10k entries before compression.
  2. **Round-trippable to JSON / the §9.1 export formats.** Ship a transpiler: `backup.hcbpack → JSON/Markdown/OPML/org/CSV`. Transpilation is a nice-to-have, not a hot path.
  3. **Versioned.** Include a schema-version header; refuse to load unknown-version files rather than silently mis-decode.
- Restore path: explicit user action in Diagnostics → "Restore from backup…". Never auto-restores on launch. Restore = diff against current mirror, preview, then write missing entries to Google (so backup → Google, not backup → local SoT).
- Custom schema is acceptable here **only because** it never leaves the local device and never substitutes for Google as SoT. If Google is reachable and has newer data, Google wins.

## 12. Carve-outs explicitly deferred (not in scope)

Previously considered, deliberately not implemented.

- **`⌘\` task drawer alternate binding.** `⌘J` already handles the same action; second shortcut is redundant.
- **Drag-out event tile to Finder.** Shipped "Export .ics…" right-click entry instead. Combining `.draggable(DraggedEvent)` with a file-drag conflicts with the reschedule-drag gesture. Revisit with a modifier-key gate if users ask.
- **Cross-calendar series-split.** See §13 "This and following" — scope too big to fold in previously.

## 13. Deferred roadmap

Not actively scheduled. Each is substantial enough to be its own focused push.

- ~~**"This and following" recurring-event edit**~~ — deliberately NOT implemented. Users rarely check past events; the cheaper fix shipped in 8698bfe: flag "Every event in the series" as destructive with copy that explicitly names the retroactive effect, and point users at Delete → This and following + re-create as the workaround. Reopen only if a real user complains about past-event mutation in practice.
- ~~**Cross-calendar drag for recurring `thisAndFollowing` scope**~~ — not needed. Move dialog's "Every event in the series" now carries the same retroactive warning as edit/delete.
- **Push-via-APNs relay** — requires a server, violates "Google is the backend" principle. Reconsider only if foreground polling proves inadequate in practice.
- **Rich metadata in Calendar private extended properties** — cross-client fragility; app-only annotations would disappear outside Hot Cross Buns.
- **SQLite migration for the local cache** — current JSON snapshot is adequate for one user's data volume. Reconsider if the cache grows past ~50MB or needs indexed queries.
- **Windows / Linux / Android ports** — out of scope by product decision.

## 14. Known residual risks

No open items at this time. The audits haven't surfaced anything new since the last pass, and both previously-tracked risks are now resolved:

- Single-occurrence recurring-event PATCH (the `originalStartTime` question) — verified during live QA on a weekly recurring series via both the title-edit path and the drag-to-reschedule path. Google's API correctly infers the occurrence from the instance-ID suffix; "This event only" updates exactly one instance and leaves the rest of the series untouched. No DTO change needed. Recorded in `COMPLETED.md`.
- Tasks watermark derived from local clock — resolved by reading Google's response `Date` header and using it as the next `updatedMin`. Falls back to local clock with a 300s slack only when the header is absent. Recorded in `COMPLETED.md`.

For residual risks that have been fixed, see `COMPLETED.md` § "Residual risks fixed since the last audit pass".

## 14b. [Highest priority] Encrypt the audit log at rest

The `MutationAuditLog` (`Services/Logging/MutationAuditLog.swift`) writes
`audit.log` as plaintext JSON to `~/Library/Application Support/<bundleID>/audit.log`.
With the history-log expansion it now persists:

- Every task / note / event title and a copy of notes body on edit and delete
- `priorSnapshotJSON` / `postSnapshotJSON` blobs for operations that record
  their pre/post state (so the history window can offer a "Copy snapshot"
  affordance for non-reversible ops)
- Bulk-action summaries including the first resource's title
- Sync-diff counts

This file is readable by any process the user launches. We already encrypt the
local cache (§6.12 `cacheEncryptionEnabled`) — the audit log deserves parity.
Implement by:

1. Adding `auditLogEncryptionEnabled` + key to the existing Keychain-backed
   passphrase flow (reuse `EncryptionSection.swift`'s UI).
2. AES-256-GCM-wrap each persisted snapshot via `CryptoKit.SymmetricKey`
   derived from the passphrase (Argon2 or PBKDF2-SHA256 ≥ 100k iters) —
   same pattern as the local cache encryption already in the codebase.
3. Lazy-migrate on first read: if the loaded file lacks a `v2` header, treat
   as plaintext, re-wrap on next `persist()`.
4. Surface enable/change/disable in `Features/Settings/EncryptionSection.swift`
   next to the existing cache toggle so users don't hunt for two separate
   switches.

Until this ships, anyone with filesystem access can reconstruct the user's
task + event titles months back — far more privacy-revealing than the
session ID stash we already guard.

## 15. See-how / maybe

- **Rename "Hot Cross Buns"** — consider swapping for a Korean or Japanese romanized word related to time (e.g. *jikan*, *toki*, *sigan*, *ima*). See-how only; not committed.
- **Landing page + walkthrough** — build a Hot Cross Buns landing page, host on GitHub Pages, and record an end-to-end app walkthrough with Recordly once everything else is done.
- **Obsidian-style cursor-line reveal for markdown editor** — current live-preview editor dims syntax uniformly across every line. Obsidian's behaviour instead hides syntax on all non-cursor lines (rendered-only, like reading mode) and reveals the full raw syntax only on the line the cursor currently sits on, switching as the cursor moves. Implement by hooking `NSTextViewDelegate.textViewDidChangeSelection` in `Design/MarkdownLiveEditor.swift`, tracking the cursor's current line range, and re-applying `MarkdownHighlighter` attributes with that line treated as "source-visible" and all other lines treated as "syntax hidden".
- **Competitive UI teardown → rip off best-in-class patterns.** Thorough investigation of Things 3, OmniFocus 4, Notion, and Apple Calendar. Capture exactly what each does well on: task-capture flow, inbox triage, date parsing UX, project/area navigation, calendar grid density, drag-rearrange ergonomics, overdue treatment, inspector panels, review flow, empty states, first-run. For each adopted pattern produce a file-specific proposal (which HCB view would change, which tokens to reuse, which pattern to port verbatim vs adapt). Next tasking to pick up when the current batch settles; explicitly deprioritized below shipping blockers but above other speculative work.
- **Universal portable format + user-hosted sync.** Extend HCB to first-class support a portable interchange format for tasks/notes/events on top of the current Google-2-way path. Options: (a) CalDAV/CardDAV-style open standard so any CalDAV server can sync; (b) an HCB-native serializable schema (JSON/protobuf) that's fully round-trippable. Either way, serialize + deserialize all HCB-visible state, let users point at their own backend (self-hosted sync server, object store, Syncthing, etc.) for multi-device replication without depending on Google. Scope includes: schema versioning, conflict resolution strategy mirroring our etag path, import/export tooling, and a decision on push vs pull topology. Deprioritized — implement only after Google parity is locked in.
- **Menu-bar app rework — visible icon + live counter.** The current menu-bar extra is unreliable; the icon intermittently isn't visible and the overdue/today counter doesn't actually update in real time. Rework so: the status-bar icon is always registered and visible when `settings.showMenuBarExtra` is on (guard against NSStatusItem recycling); a running counter badge reflects `model.datedOpenTaskCount` + today's upcoming event count, updated on every mirror mutation and every sync tick; the dropdown panel honors `menuBarStyle` and renders without lag on open. Cover: cold launch, sleep/wake, appearance changes, counter rollover at midnight.
- **Right-click / context-menu coverage across all interactable surfaces.** Currently right-click is a no-op in most of the UI. Add `.contextMenu` (SwiftUI) / `NSMenu` support on every surface where the user interacts with an event, task, or note: day/week/month/timeline event tiles; Kanban task cards; Notes grid cards; task inspector rows; Forecast/Review entries; Today dashboard items. Base menu per kind: Duplicate, Convert…, Edit…, Delete, Copy as Markdown, Open in Google (deep link), and kind-specific extras (recurring scope pickers on events, list move on tasks, date-set on notes). Left-click behavior stays as-is (primary action = open inspector); right-click adds the secondary affordance. Audit every tile-renderer to catch the long tail (menu-bar panel items, Spotlight results, palette hits).
