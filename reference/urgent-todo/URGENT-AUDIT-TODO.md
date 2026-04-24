# Urgent Audit TODO

User-facing gaps found in a 2026-04-24 audit of Hot Cross Buns. Ordered by user-value impact. Items are concrete, file-addressed, and scoped so another coding agent can pick them up cold.

## Repo Orientation (for drop-in agents)

- **Canonical app**: `apps/apple/` — native macOS SwiftUI planner, Google Tasks + Calendar as source of truth. Mac-only. Older Tauri/sync-server work already removed.
- **Build**: `make gen` (XcodeGen) → `make build` / `make rerun` / `make test`. CLI signing is flaky; for edit loop use `make open` + ⌘R in Xcode. See Makefile header for the "No Account for Team" caveat.
- **Project spec**: `apps/apple/project.yml` (XcodeGen). After adding/removing source files run `make gen`.
- **Entry point**: `apps/apple/HotCrossBuns/App/HotCrossBunsApp.swift`. Main shell: `MacSidebarShell.swift`. Central state: `App/AppModel.swift` (~152k lines, single file — do not refactor as part of these tasks).
- **Services**: `HotCrossBuns/Services/{Auth,Google,Sync,Notifications,Persistence,Updates,Feedback,...}`.
- **Tests**: `apps/apple/HotCrossBunsMacTests/` (48 test files; Swift Testing + XCTest mix).
- **Marketing/docsite**: `docs/` (served at https://gongahkia.github.io/hot-cross-buns/). Install script: `docs/install-macos-preview.sh`.
- **CI**: `.github/workflows/{ci.yml,release.yml}`. CI runs the test suite on push/PR. Release triggers on `v*` tag.
- **OAuth config**: `apps/apple/Configuration/GoogleOAuth.{xcconfig,example.xcconfig,local.xcconfig}`. Local file gitignored, CI injects from secrets.
- **Global conventions**: see root `CLAUDE.md` — terse, no auto-refactor outside task scope, in-line comments only, fail fast.

## Notation

- [Inference] / [Speculation] / [Unverified] mark claims not directly read. Direct file:line refs are sourced unless labeled.
- "Agent should:" marks the acceptance criteria.

---

## P0 — Trust & Safety (ship blockers for public use)

### 1. Publish privacy / scope disclosure

- **Symptom**: `docs/index.html` and `apps/apple/README.md:43` never name the OAuth scopes, where data lives locally, how to revoke, or whether telemetry exists. For an app that reads the user's calendar + tasks, this is a trust blocker.
- **Files to touch**:
  - `docs/index.html` — add a linked `privacy.html` (or inline section) reachable from header nav AND the download modal.
  - `docs/styles.css` — style for the new page.
  - `apps/apple/README.md:43` — replace "requests Google Tasks plus Google Calendar scopes" with the literal scope strings.
- **Content to include**:
  - Exact OAuth scopes requested by `Services/Auth/GoogleAuthService.swift` (read the file and list them verbatim — do not guess).
  - Local cache path: `~/Library/Application Support/com.gongahkia.hotcrossbuns.mac/` [Inference — confirm by reading `Services/Persistence/LocalCacheStore.swift`].
  - Revocation: link to https://myaccount.google.com/permissions.
  - Telemetry statement: confirm by grepping for network calls outside `Services/Google/`; if none, state "No analytics, crash reports, or telemetry leaves your Mac."
  - Encryption: `Services/Persistence/HCBCacheCrypto.swift` exists — describe what it protects.
- **Agent should**: read the auth service + cache store first to ground every claim, then write the page. No invented text. Link from docsite footer and download modal.

### 2. Verify install-script download integrity

- **Symptom**: `docs/install-macos-preview.sh:87` runs `curl -fL ... -o "$dmg"` then installs. No SHA256 check, no signature. Users pipe `curl | bash` on unsigned binaries — supply-chain trust gap.
- **Fix**:
  - Release workflow `.github/workflows/release.yml` must emit `HotCrossBuns-macOS.dmg.sha256` alongside the DMG and attach it to the GitHub Release.
  - `docs/install-macos-preview.sh` must download the `.sha256` next to the DMG, compute `shasum -a 256` on the downloaded file, and abort on mismatch.
  - Failure path must be loud: delete the bad download, exit non-zero, print the expected vs actual hash.
- **Agent should**: add a `sha256_verify()` helper in the script, gate the `ditto`/install step on it, and add a release-workflow step that writes the checksum. Do not introduce GPG — overkill here.

### 3. Kill silent permission / sign-in failures

Three distinct silent-failure paths. Fix all three; they share a pattern.

**3a. Google sign-in sheet dismissed** — `Services/Auth/GoogleAuthService.swift` [Unverified line] flips state `.authenticating → .signedOut` with no surfaced error when the user closes the sheet. In `Features/Onboarding/OnboardingView.swift` and settings account card, the button just "doesn't do anything." Users think the button is broken.

- Agent should: in the sign-in completion handler, detect the user-cancel case (GIDSignIn returns `kGIDSignInErrorCodeCanceled` / `.canceled`) and distinguish it from other errors. Surface a transient inline hint ("Sign-in was cancelled — tap Connect Google to try again"), not a red error banner.

**3b. Notification permission denied** — `Services/Notifications/LocalNotificationScheduler.swift:145-149` calls `requestAuthorization` once and returns false silently. Only surfaces later in `Features/Settings/DiagnosticsView.swift:192-198`.

- Agent should: when the Settings toggle `Features/Settings/SettingsView.swift:86-109` enables reminders, await the authorization result. On `.denied`, flip the toggle back off and show a sheet/alert: "macOS blocked notifications for Hot Cross Buns. Open System Settings → Notifications → Hot Cross Buns to allow." Include a button that opens `x-apple.systempreferences:com.apple.preference.notifications?id=com.gongahkia.hotcrossbuns.mac`.

**3c. Global-hotkey accessibility permission** — `App/GlobalHotkey.swift:13` and `App/AppDelegate.swift:87-96` install the Carbon hotkey with no error path. If accessibility is denied, the "keyboard-first" headline silently doesn't work.

- Agent should: check `AXIsProcessTrustedWithOptions` before `install()`. If untrusted, show a one-time explainer sheet describing why the permission is needed, then open System Settings → Privacy & Security → Accessibility. If the user declines, flip the Settings toggle off with a visible reason.

### 4. Keep the GitHub Releases update path honest

- **Symptom**: update surfaces can drift between the app, the website, and the install script. The current product promise is not "silent auto-update"; it is "check GitHub Releases, download the DMG, then replace the app manually."
- **Files to keep aligned**:
  - `apps/apple/HotCrossBuns/Services/Updates/UpdaterController.swift`
  - `apps/apple/HotCrossBuns/Features/Settings/UpdatesSection.swift`
  - `apps/apple/HotCrossBuns/Features/Help/HelpView.swift`
  - `docs/index.html`
  - `docs/install-macos-preview.sh`
  - `.github/workflows/release.yml`
- **Agent should**: if the updater behavior changes, update all of those surfaces in the same PR so user-facing copy does not drift from the real install flow.

---

## P1 — Resilience & Discoverability

### 5. Distinguish offline / rate-limited / 5xx in the banner

- **Symptom**: `Features/Status/AppStatusBanner.swift:133-141` renders a single amber "Sync paused — tap Retry" for offline, 429, and 5xx. `Services/Sync/NetworkMonitor.swift` already tracks reachability but `AppStatusBanner.failureContext` never reads it.
- **Fix**: inject `NetworkMonitor.reachability` into the banner's failure switch. Copy:
  - Offline → "You're offline. Changes are queued locally and will sync when you reconnect."
  - 429 → "Google is rate-limiting requests. Retrying automatically."
  - 5xx → "Google Calendar/Tasks is briefly unavailable. Retrying…"
  - Auth → existing "Reconnect Google" (keep).
- **Agent should**: pass the monitor into the banner via the same pattern the view already uses for other model deps (check the parent's `environmentObject`/`@ObservedObject` wiring). Add a test in `HotCrossBunsMacTests/` [Unverified — no existing `AppStatusBanner` test] covering each branch.

### 6. Global-hotkey rebind + toggle UI

- **Symptom**: `App/GlobalHotkey.swift:13` is fixed to `⌘⇧Space`. `Features/Settings/KeybindingsSection.swift` handles in-app chords but not the global hotkey. No on/off toggle visible in Settings.
- **Fix**:
  - Add a `GlobalHotkeySection` to `Features/Settings/` with: enable toggle, key recorder, current-binding display, and an inline accessibility-permission status row.
  - Persist via `@AppStorage("hcb.globalHotkey.keyCode")` + modifiers.
  - Re-call `GlobalHotkey.install(keyCode:modifiers:)` on change. Tear down prior registration.
- **Agent should**: gate rebinding on accessibility-permission success (see item 3c). Add test for encode/decode of the persisted key.

### 7. Document chord system, deep links, NLP grammar in Help

- **Symptom**: `App/HCBChord.swift:33-45` (leader chords), `App/HCBDeepLinkRouter.swift` (URL scheme), and `Features/Calendar/NaturalLanguageEventParser.swift` + quick-add NLP parser all have zero user-facing reference. Power features are invisible.
- **Files to edit**: `Features/Help/HelpView.swift` (currently ~7.6k). Add three new sections:
  1. **Chords** — render the chord tree from `HCBChord.swift` so it stays in sync. Do not hardcode; read the same source of truth the chord matcher uses.
  2. **Deep links** — list every route from `HCBDeepLinkRouter.swift` (`task/<id>`, `event/<id>`, `new/task?...`, `new/event?...`, `search?q=`), each with one example URL.
  3. **Quick-add grammar** — render the accepted tokens (`tmr`, `tdy`, `tnt`, `eom`, `+Nd`, `next monday`, `#list`) pulled from the parser's token definitions. [Inference] The parser likely has a static list of keywords — use it.
- **Agent should**: introspect the source enums/tables to generate the help content at runtime so the docs cannot drift from the code. No literal copying.

### 8. Release smoke test

- **Symptom**: `.github/workflows/release.yml:70-142` builds and publishes the DMG without ever launching it. Crashy builds can ship.
- **Fix**: after the DMG is built and before attaching it to the release, mount it, copy the `.app` to a temp dir, launch it with `open -W -a ...` under a 15s timeout, assert no crash dump appears in `~/Library/Logs/DiagnosticReports/`, then unmount.
- **Gotcha**: the app will try to complete onboarding and hit Google. Add a launch-arg check in `App/HotCrossBunsApp.swift` (new `--smoke-test` flag) that exits 0 after initial window render without touching the network. Keep the flag out of the release build UI.
- **Agent should**: write a standalone `scripts/smoke-test-dmg.sh` that the release workflow calls. Exit non-zero on any crash log.

### 9. Video captions for WCAG 2.1

- **Symptom**: 4 MP4s in `docs/media/` (`hero-window.mp4`, `views-cycle.mp4`, `keys-palette.mp4`, `menu-bar-apps.mp4`) have no captions. `docs/index.html` uses `<video>` with `aria-label` only — not a substitute.
- **Fix**: write `.vtt` caption files next to each MP4 (since videos are UI demos, captions describe what's happening on screen, not speech). Reference via `<track kind="captions" src="media/hero-window.vtt" default>` in `docs/index.html`.
- **Agent should**: watch each video, write VTT by hand (they're short). Don't use autogenerated captions.

---

## P2 — Polish

### 10. Permanent-failure (400) quarantine path

- **Symptom**: `Services/Sync/OptimisticWriter.swift` mutation-replay — [Inference] bad payloads (400 Bad Request) are treated the same as any non-transient non-conflict error: a banner flash, mutation dropped. User can't diagnose or recover.
- **Fix**: classify 400 distinctly in `Services/Google/GoogleAPITransport.swift` error mapping. Route 400s into the existing quarantine queue (visible in `Features/Settings/DiagnosticsView.swift:247-260`) with the payload preserved, so the user can copy it out or delete it manually. Do not drop.
- **Agent should**: add `case invalidPayload` (or similar) to the `GoogleAPIError` enum, branch on it in OptimisticWriter, and surface in the Diagnostics "Quarantined" section with a "Copy payload" button.

### 11. Update-check feedback

- **Symptom**: `Services/Updates/UpdaterController.swift` calls GitHub Releases directly. If a future refactor removes the manual success/error toasts, the menu action will feel broken again.
- **Fix**: preserve explicit user-visible outcomes for both cases: "You're on the latest version" and "Couldn't reach GitHub Releases."
- **Agent should**: route toasts through whatever global-toast mechanism already exists [Unverified — likely `AppStatusBanner` or a dedicated HUD; grep for `toast`/`Banner`].

### 12. Notes isn't a first-class surface

- **Symptom**: `Features/Store/NotesViewMode.swift` is 888 bytes — it's a view mode of StoreView, not a feature. README positions Notes as one of three "primary surfaces" (alongside Tasks and Calendar). Mismatch.
- **Two acceptable resolutions**:
  - **A**: build out Notes: dedicated sidebar section, empty-state guidance, basic editor (title + markdown body), local persistence via `LocalCacheStore`. Larger scope.
  - **B**: downgrade Notes in README and marketing copy to "undated tasks as a scratch pad" and remove the "three primary surfaces" framing from `README.md:15-19` and `docs/index.html`.
- **Agent should**: confirm the intended direction with the repo owner before building. Default to B if no guidance.

### 13. Onboarding: pre-announce OS permission prompts

- **Symptom**: `Features/Onboarding/OnboardingView.swift` triggers Google OAuth, and — if the user enables reminders or hotkey during setup — cold macOS system dialogs for notifications and accessibility.
- **Fix**: before each `requestAuthorization`-style call in the onboarding flow, show a one-screen primer: icon, one-line why, screenshot of the OS dialog the user is about to see, "Continue" button. This is a standard iOS pattern.
- **Agent should**: add a `PermissionPrimerView` reusable in both onboarding and Settings toggles (see item 3b/3c).

### 14. Sync-mode guidance copy

- **Symptom**: `Features/Settings/SettingsView.swift` (sync-mode picker ~line 34-42) offers Manual / Balanced / Near-real-time with no "pick this if…" text.
- **Fix**: one-line hint under each option:
  - Manual → "Only syncs when you tap Refresh. Best for low-bandwidth or API-quota-sensitive setups."
  - Balanced → "Syncs on launch and when you return to the app. Recommended."
  - Near real-time → "Polls every 90 seconds while the app is open. Highest Google API usage."

### 15. Palette: recent commands + argument completion (smaller bite)

- **Symptom**: `App/CommandPaletteView.swift` (~25k) lacks recent-commands and can't accept argument parameters.
- **Minimum viable fix**: recent commands only. Persist last 10 executed command IDs to `@AppStorage`, show them above results when the query is empty.
- **Defer**: argument completion (`new task title:foo due:tmr`) is larger scope — leave for a follow-up.

---

## Non-goals for this pass

- Refactoring `App/AppModel.swift` (152k LOC single file). Known, out of scope.
- Full internationalization (0 `NSLocalizedString` uses today). Product is English-only preview; revisit post-1.0.
- Expanding VoiceOver coverage across 45k-93k-line calendar views. Triage separately.
- Menu bar consolidation (currently 3 variants in `MenuBarExtraScene.swift`). [Speculation] Likely should collapse to one, but needs product decision first.

## Suggested execution order

1. (P0) Items 1, 2, 4 — can be done in parallel; all docs/scripts, no Swift changes.
2. (P0) Item 3 — three related Swift fixes sharing the permission-primer pattern.
3. (P1) Item 5 — small, well-scoped; landable in one PR.
4. (P1) Items 7, 9 — docs/help content, parallelizable with 5.
5. (P1) Items 6, 8 — require new UI + workflow plumbing; schedule after the above.
6. (P2) Items 10–15 — pick up as capacity allows.

## Verification checklist (for any PR touching the above)

- `make test` passes locally and in CI.
- Manual check: build via `make open` + ⌘R, exercise the specific flow fixed.
- For permission paths (item 3, 13): reset permissions with `tccutil reset All com.gongahkia.hotcrossbuns.mac` between runs.
- For banner/status changes (item 5): toggle Wi-Fi off mid-sync to trigger offline path.
- For release/install changes (item 2, 4, 8): dry-run the workflow on a throwaway tag before cutting a real release.
