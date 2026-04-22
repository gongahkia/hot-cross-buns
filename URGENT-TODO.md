# URGENT-TODO

Active work remaining for Hot Cross Buns as a daily-driver Google Tasks / Calendar client. Ordered by what blocks shipping or what the next maintainer should pick up first. For shipped work see `COMPLETED.md`.

Core invariant: Google Tasks + Google Calendar are the source of truth. Every feature below round-trips to Google or is explicitly local-only app config (keybindings, templates, themes, cache). Nothing invents a data field Google cannot see without a deliberate, documented notes-marker encoding.

Ranking principle:

1. **§1–§5** — setup + QA that block a shippable build. Cannot ship without these.
2. **§7–§8** — visual polish / perf / battery passes.
3. **§9** — deprioritized extended-interop work.
4. **§10** — cybersecurity hardening.
5. **§11** — least-priority: daily local backup (implement last).
6. **§12–§14** — carve-outs / deferred roadmap / known residual risks. Reference only.

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

Still to do:
- Profile `AppModel` observable republishing — @Observable bottom-up invalidation may be republishing every consumer on any field change.
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

## 15. See-how / maybe

- **Rename "Hot Cross Buns"** — consider swapping for a Korean or Japanese romanized word related to time (e.g. *jikan*, *toki*, *sigan*, *ima*). See-how only; not committed.
- **Landing page + walkthrough** — build a Hot Cross Buns landing page, host on GitHub Pages, and record an end-to-end app walkthrough with Recordly once everything else is done.
- **Obsidian-style cursor-line reveal for markdown editor** — current live-preview editor dims syntax uniformly across every line. Obsidian's behaviour instead hides syntax on all non-cursor lines (rendered-only, like reading mode) and reveals the full raw syntax only on the line the cursor currently sits on, switching as the cursor moves. Implement by hooking `NSTextViewDelegate.textViewDidChangeSelection` in `Design/MarkdownLiveEditor.swift`, tracking the cursor's current line range, and re-applying `MarkdownHighlighter` attributes with that line treated as "source-visible" and all other lines treated as "syntax hidden".
- **Competitive UI teardown → rip off best-in-class patterns.** Thorough investigation of Things 3, OmniFocus 4, Notion, and Apple Calendar. Capture exactly what each does well on: task-capture flow, inbox triage, date parsing UX, project/area navigation, calendar grid density, drag-rearrange ergonomics, overdue treatment, inspector panels, review flow, empty states, first-run. For each adopted pattern produce a file-specific proposal (which HCB view would change, which tokens to reuse, which pattern to port verbatim vs adapt). Next tasking to pick up when the current batch settles; explicitly deprioritized below shipping blockers but above other speculative work.
- **Universal portable format + user-hosted sync.** Extend HCB to first-class support a portable interchange format for tasks/notes/events on top of the current Google-2-way path. Options: (a) CalDAV/CardDAV-style open standard so any CalDAV server can sync; (b) an HCB-native serializable schema (JSON/protobuf) that's fully round-trippable. Either way, serialize + deserialize all HCB-visible state, let users point at their own backend (self-hosted sync server, object store, Syncthing, etc.) for multi-device replication without depending on Google. Scope includes: schema versioning, conflict resolution strategy mirroring our etag path, import/export tooling, and a decision on push vs pull topology. Deprioritized — implement only after Google parity is locked in.
- **Menu-bar app rework — visible icon + live counter.** The current menu-bar extra is unreliable; the icon intermittently isn't visible and the overdue/today counter doesn't actually update in real time. Rework so: the status-bar icon is always registered and visible when `settings.showMenuBarExtra` is on (guard against NSStatusItem recycling); a running counter badge reflects `model.datedOpenTaskCount` + today's upcoming event count, updated on every mirror mutation and every sync tick; the dropdown panel honors `menuBarStyle` and renders without lag on open. Cover: cold launch, sleep/wake, appearance changes, counter rollover at midnight.
- **Right-click / context-menu coverage across all interactable surfaces.** Currently right-click is a no-op in most of the UI. Add `.contextMenu` (SwiftUI) / `NSMenu` support on every surface where the user interacts with an event, task, or note: day/week/month/timeline event tiles; Kanban task cards; Notes grid cards; task inspector rows; Forecast/Review entries; Today dashboard items. Base menu per kind: Duplicate, Convert…, Edit…, Delete, Copy as Markdown, Open in Google (deep link), and kind-specific extras (recurring scope pickers on events, list move on tasks, date-set on notes). Left-click behavior stays as-is (primary action = open inspector); right-click adds the secondary affordance. Audit every tile-renderer to catch the long tail (menu-bar panel items, Spotlight results, palette hits).
