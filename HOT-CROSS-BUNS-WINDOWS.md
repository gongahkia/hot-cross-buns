# Hot Cross Buns — Windows Port

A faithful port of the Hot Cross Buns macOS app (`apps/apple/`) to Windows. Same product, same behavior, native Windows feel. This document is the standalone brief for an agent to execute the port without re-deriving the macOS feature surface.

> Sibling document: `HOT-CROSS-BUNS-LINUX.md`. Both ports are fully separate codebases — no shared runtime, no FFI bridge. Logic gets re-implemented natively per platform; data formats and Google API surfaces are identical so users with an account on multiple devices see consistent state.

---

## 0. TL;DR for an Implementing Agent

- **Stack:** C# 12 + .NET 8 + WinUI 3 (via WindowsAppSDK 1.5+). MSBuild + `dotnet` CLI.
- **Target:** Windows 11 22H2+ as primary; Windows 10 1809+ supported via WinUI 3's stated minimum. x64 + arm64.
- **Source of truth:** Google Tasks API + Google Calendar API. Identical to macOS.
- **On-disk format:** Identical JSON schema to macOS (`CachedAppState`). Cache lives in `%LOCALAPPDATA%\HotCrossBuns\cache.json`.
- **Auth:** OAuth 2.0 Loopback flow primarily. Embedded path uses `WebAuthenticationBroker` only as a fallback; Google does not ship a Windows native sign-in SDK comparable to macOS.
- **Notifications:** `Microsoft.Toolkit.Uwp.Notifications` (toast notifications via `ToastNotificationManagerCompat`).
- **Tray:** `H.NotifyIcon.WinUI` (community library; no first-party WinUI 3 tray API yet).
- **Global hotkey:** `RegisterHotKey` Win32 API via P/Invoke.
- **Search integration:** Indexer via `Windows.Storage.Search` is not appropriate (file-system oriented). Instead, register a **PowerToys Run plugin** (community) and ship Windows Search-equivalent via custom URI handler + Start Menu jump list.
- **Distribution:** MSIX (signed) via GitHub Releases + winget manifest. Optional Microsoft Store submission post-1.0.

If the agent is told "build the Windows port," they should be able to scaffold from §5, then walk §9 milestones in order.

---

## 1. Mission

Windows users get the same product macOS users get:
- Tasks + Calendar synced with Google as source of truth.
- Local cache, offline mutations, conflict-tolerant sync.
- Tray-resident with three glanceable surfaces (Detailed/Weekly/Compact).
- Command palette, leader-key shortcuts, quick-capture floating window.
- Local notes (markdown).
- Toast notifications, jump list integration, share-target equivalent.
- Updater that points at GitHub Releases.

Non-goals for v1: ARM32, Windows on ARM with x86 emulation tuning beyond what .NET 8 gives us, UWP-style sandboxing beyond MSIX defaults, Xbox/HoloLens.

---

## 2. Stack Decision

| Layer | Choice | Rationale |
| --- | --- | --- |
| Language | **C# 12** on **.NET 8** | First-class Windows ecosystem, async/await, mature tooling. |
| UI toolkit | **WinUI 3** via WindowsAppSDK 1.5+ | Native Windows 11 look (Mica, Acrylic, Fluent), best modern UX. Replaces UWP/XAML Islands. |
| UI architecture | **MVVM** with `CommunityToolkit.Mvvm` (source generators for `[ObservableProperty]`, `[RelayCommand]`) | Familiar shape if you know SwiftUI/Combine. |
| Async | **Task / async-await** + `IAsyncEnumerable` for streaming sync | — |
| HTTP | **`HttpClient`** via `IHttpClientFactory` with **Polly** for retries + circuit breaker | Polly handles backoff/jitter; mirrors `GoogleAPITransport`. |
| JSON | **`System.Text.Json`** with source-generated serializers | Faster than `Newtonsoft.Json`; AOT-friendly. |
| Crypto | **`System.Security.Cryptography.AesGcm`** + `Rfc2898DeriveBytes` (PBKDF2) | Match macOS CryptoKit primitives + iteration count. |
| Secrets | **Windows Credential Manager** via `CredentialManagement` NuGet OR Win32 `CredRead`/`CredWrite` P/Invoke | Equivalent to macOS Keychain. Tokens scoped to current user. |
| Data Protection (encryption key wrapping) | **`ProtectedData`** (DPAPI) for the cache encryption key | Belt-and-suspenders alongside Credential Manager. |
| Notifications | **`Microsoft.Toolkit.Uwp.Notifications`** + `ToastNotificationManagerCompat` | Persistent scheduled toasts via `ToastNotificationHistoryCompat`. |
| Tray | **`H.NotifyIcon.WinUI`** | Community lib; tray + popup window combo. Replace if Microsoft ships a first-party API. |
| Global hotkey | Win32 `RegisterHotKey` + `WM_HOTKEY` via window-message hook | Standard. Avoid global low-level keyboard hook (triggers AV heuristics). |
| Markdown | **`Markdig`** + custom WinUI rendering into `RichTextBlock` (or `WebView2` for live preview) | — |
| WebView (Maps) | **`Microsoft.Web.WebView2`** | Replaces WKWebView. |
| Map fallback | Bing Maps via `Microsoft.UI.Xaml.Controls.MapControl` is gone in WinUI 3 (deprecated). Use **Windows.Services.Maps** for geocoding + WebView2 for visual. | Document the loss vs MapKit. |
| Build | `dotnet build`, `dotnet publish`, MSBuild | — |
| Packaging | **MSIX** (signed, single-instance, MSIX-AppInstaller for sideload updates) | Modern Windows app distribution. |
| Tests | **xUnit** + **FluentAssertions** + **Moq** for HTTP mocking | — |

### 2.1 Rejected alternatives

- **Electron** — bundle size, ideological mismatch with HCB's "native" identity.
- **Tauri** — viable but ties Windows UI to WebView2 and requires reimplementing all native Win11 patterns; loses Mica/Acrylic for free.
- **WPF** — works but stale visually; Windows 11 Fluent design is not idiomatic here.
- **MAUI** — designed for cross-platform; on Windows it produces a WinUI 3 host anyway, with extra abstraction cost. Just use WinUI 3 directly.
- **Flutter Windows** — desktop is improving but native integrations (tray, jump list, toast) require platform channels; net-net more work than C# native.
- **Avalonia** — viable, cross-platform, but smaller ecosystem and less native-feeling than WinUI 3 on Windows specifically.

### 2.2 Why not share a Rust core (or anything) with Linux?

[Inference] Same reasoning as the Linux doc: an FFI seam doubles build infra. Re-implement business logic per platform; rely on **identical Google API contracts and identical on-disk JSON schema** to keep behavior consistent. Future option: extract a `hcb-core` (Rust or .NET) crate post-1.0 if duplication becomes painful.

---

## 3. Feature Mapping (macOS → Windows)

The table below mirrors the macOS feature audit. "Maps to" is the concrete Windows replacement; "Notes" flags porting risk.

### 3.1 App shell & windowing

| macOS | Windows | Notes |
| --- | --- | --- |
| SwiftUI `Window(id:)` scenes (8 windows) | One `Microsoft.UI.Xaml.Window` per window, owned by `Microsoft.UI.Xaml.Application`. | Each macOS scene → one MVVM Window in WinUI 3. |
| Window state restoration (UserDefaults) | Persist `WindowState` (x, y, w, h, maximized, monitor index) in `%LOCALAPPDATA%\HotCrossBuns\windows.json`. Use `AppWindow.Position` + `AppWindow.Size`. | Multi-monitor: store monitor device-id; clamp to primary if monitor missing on next launch. |
| Dock badge + dock menu | **Taskbar overlay icon** via `TaskbarManager.Instance.SetOverlayIcon` (Win32) for overdue badge. **Jump List** for "New Task", "New Event", "Open Calendar", "Open Store". | Set via `JumpList.CreateJumpList()`. |
| `NSStatusItem` (menu bar item with three modes) | Tray icon + popup window via `H.NotifyIcon.WinUI`. | See §3.10. |
| Floating panels (`NSPanel`) | `Window` with `OverlappedPresenter.IsAlwaysOnTop = true`, no titlebar via `ExtendsContentIntoTitleBar = true` and hidden caption buttons. | Quick-capture and command palette as borderless popups. |
| `NSApplicationDelegate` lifecycle | `Application.OnLaunched`, `Application.OnSuspending`, `Application.UnhandledException`. | — |
| Multi-window restoration | Re-spawn windows on launch from saved state. | — |
| Mica / Acrylic backdrop | Apply `MicaController` to main window for Win11 native feel. Fallback to solid color on Windows 10. | Not in macOS; add on Windows for native idiom. |

### 3.2 Auth

| macOS | Windows | Notes |
| --- | --- | --- |
| Embedded GoogleSignIn SDK (path B) | **Removed.** Google does not ship a Windows-native sign-in SDK comparable to GoogleSignIn-iOS. | Path A (loopback) is the canonical flow. |
| Custom `OAuthLoopbackServer` on localhost | `HttpListener` on `http://127.0.0.1:0/` (random port), PKCE S256, identical state machine. | Identical behavior to macOS path A. |
| Tokens in Keychain | **Windows Credential Manager** under target name `HotCrossBuns/oauth-token/<account-id>`. Wrap with DPAPI before storing for defense-in-depth. | Per-user; roams with user profile. |
| Scopes: tasks + calendar | Identical. | — |
| Sign-out clears Keychain + cache | Same flow against Credential Manager + cache file. | — |
| Keychain health probe | Credential Manager is always available on Windows; probe at startup but do not expect failure. Surface DPAPI errors instead (rare; usually means corrupt user profile). | — |

### 3.3 Networking

| macOS | Windows | Notes |
| --- | --- | --- |
| `GoogleAPITransport` (URLSession) | `HttpClient` (one shared instance, configured via `IHttpClientFactory`) + Polly retry policy. | Match retry policy bit-for-bit. |
| `GoogleTasksClient`, `GoogleCalendarClient` | Re-implement with same method signatures, same watermark (`updatedMin`) semantics. | Snapshot the macOS request/response shapes in fixtures and reuse for tests. |
| `NetworkMonitor` via `NWPathMonitor` | `NetworkInformation.NetworkStatusChanged` (UWP API still available via WinAppSDK) + `NetworkInformation.GetInternetConnectionProfile`. | Reliable on Win10/11. |
| Updater client (GitHub Releases) | Same `HttpClient` calls; download MSIX → trigger AppInstaller. | See §3.18. |

### 3.4 Sync engine

Re-implement `SyncScheduler` as a class managing an internal `Channel<SyncCommand>` (System.Threading.Channels). Preserve:
- `SyncMode { Full, Incremental }`.
- Per-list `SyncCheckpoint { ListId, ResourceType, UpdatedMin, SyncedAt }`.
- `PendingMutation` queue with `AttemptCount` + exponential backoff replay (Polly).
- Tombstone semantics (Tasks `deleted=true`, Calendar `status=cancelled`).
- Last-write-wins on `updatedAt` from Google.
- Parallel fan-out using `Task.WhenAll`.

The on-disk JSON for `CachedAppState` MUST be byte-compatible with the macOS schema. Use `JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }` and explicit `[JsonPropertyName]` overrides where macOS uses idiosyncratic names. Verify with a fixture round-trip test.

### 3.5 Local persistence

| macOS | Windows | Notes |
| --- | --- | --- |
| `~/Library/Application Support/Hot Cross Buns/cache.json` | `%LOCALAPPDATA%\HotCrossBuns\cache.json` | Non-roaming. Use `Environment.GetFolderPath(SpecialFolder.LocalApplicationData)`. |
| `cache-events.json` sidecar | Same | — |
| `cache-state.salt` | Same | — |
| AES-GCM 256 with PBKDF2-derived key, key in Keychain | `AesGcm` + `Rfc2898DeriveBytes` (matching iteration count from macOS — verify `HCBCacheCrypto.swift`), key in Credential Manager and additionally DPAPI-wrapped at rest. | Cross-platform-portable cache requires identical KDF params. |
| 3 rotating snapshots | Same | — |
| Atomic writes (`.atomic` option) | `File.Replace(temp, final, backup)` for atomic rename + backup. | — |
| `LocalBackupService` zip export | `FileSavePicker` (WinAppSDK) + `System.IO.Compression.ZipArchive`. | — |
| `CacheSchemaMigrator` | Port migrators verbatim as pure functions over `JsonNode`. | Add regression test loading macOS-produced fixtures from each historical schema version. |

### 3.6 Models

All `Codable` Swift structs become C# records with `[JsonSerializable]` source-generated context. Property names (camelCase JSON) MUST match the macOS JSON exactly — this is the cross-platform contract.

### 3.7 Tasks UI

| macOS | Windows |
| --- | --- |
| Store view (Kanban + List) | `NavigationView` with two pivots. Kanban = horizontal `ItemsRepeater` of `ListView`s, drag-drop via WinUI 3 drag/drop API. List = `DataGrid` (CommunityToolkit) or `ItemsView` (WinUI 1.5+) with sortable columns. |
| Task inspector | Side pane via `TwoPaneView`; markdown editor uses `Markdig` + a `WebView2` for live preview. |
| Inline edit, bulk ops | Same affordances; bulk via multi-selection. |
| Search (`FuzzySearcher`) | Port `FuzzySearcher` to C# (small algorithm); used by command palette + Store search. |
| Custom filters | Port the rule struct + matcher; persist in cache. |

### 3.8 Calendar UI

WinUI 3 has `CalendarView` for date selection but nothing matching `WeekGridView`. Build:
- **Month:** `CalendarView` for navigation + custom `Canvas`-backed grid with event chips.
- **Week:** Custom `Grid` (hour rows × 7 day columns) with event blocks rendered as themed `Border`s. Drag-drop via WinUI drag/drop.
- **Day/Agenda:** `ListView` ordered by start time.
- **Recurrence editor:** Form with `ComboBox` for freq/interval, `CalendarDatePicker` for "until", multi-select for byday.
- **Map:** `WebView2` loading the Google Maps Embed URL when key present; fallback to a static "Open in browser" button. The old `MapControl` is deprecated in WinUI 3 — do not use.

### 3.9 Notes

`Markdig` for parsing. Live editor: a custom `RichEditBox`-style control or a `WebView2` hosting a CodeMirror 6 page (acceptable here since this is one isolated surface, not the whole app). Auto-save on every keystroke with 500ms debounce.

### 3.10 Tray

| macOS NSStatusItem | Windows tray |
| --- | --- |
| Three modes (Detailed/Weekly/Compact) | Implement as three XAML user controls hosted in the tray popup window provided by `H.NotifyIcon.WinUI`. |
| Popup attached to status item | `H.NotifyIcon.WinUI`'s `TaskbarIcon` with `ContextFlyout` for the menu and `LeftClickCommand` opening the popup window. |
| Quick-add input | Bottom row of the popup; submits to task-create pipeline. |
| Badge (overdue count) | Tray icon supports a badge overlay via dynamic icon generation: render the number onto a 16×16 icon at runtime. |
| Right-click context menu | `MenuFlyout` with "Open", "Settings", "Refresh", "Keep Panel Open", "Quit". |
| "Keep panel open" pin | Track in view model; when pinned, the popup does not auto-close on focus loss. |

[Speculation] Microsoft may ship a first-party tray API in a future WinAppSDK; if so, swap `H.NotifyIcon.WinUI` for it.

### 3.11 Spotlight equivalent

Windows has multiple search surfaces, none ideal:
- **Windows Search** indexes files. Not a fit.
- **Start menu search** indexes apps + UWP-registered protocols. Limited.
- **PowerToys Run** (community) is the closest spiritual match. Ship a **PowerToys Run plugin** (`Community.PowerToys.Run.Plugin.HotCrossBuns`) that queries the running app via local IPC and returns task/event matches.
- **Jump List** + URI handlers cover "New Task", "New Event" without a search box.

For v1: PowerToys Run plugin (optional install) + jump list. Document this as a known gap vs CoreSpotlight.

### 3.12 App Intents / Shortcuts

No direct equivalent. Replace with:
- **AppExecutionAlias** in the MSIX manifest so `hotcrossbuns.exe new-task --title "Buy milk"` works from PowerShell.
- **Protocol activation** for `hotcrossbuns://` (see §3.15).
- **Jump list** entries for the four canonical "open" actions.
- [Speculation] Voice activation via Cortana is dead post-Win11; skip.

### 3.13 Share extension

| macOS | Windows |
| --- | --- |
| `HotCrossBunsShareExtension.appex` accepting text + URL from share sheet | Register the app as a **Share Target** in the MSIX manifest (`uap:Extension Category="windows.shareTarget"` declaring `Text`, `Uri`, `WebLink`). The OS share UI invokes the app with the payload. |
| App Group `UserDefaults` for inbox handoff | Direct activation: `OnActivated` with `ShareTargetActivatedEventArgs` reads the payload and pushes it through the same task-create pipeline. No inbox file needed; if the app is already running, the share lands directly. |

### 3.14 Services menu

No equivalent on Windows. Closest analogues:
- **"Send To" Start Menu folder** — register a shortcut so right-click → Send To → Hot Cross Buns works for files. Limited usefulness for arbitrary text selection.
- **Share Target** (§3.13) covers the modern path.
- **Decision:** drop the Services menu surface; document the loss.

### 3.15 URL schemes / deep links

`hotcrossbuns://` registered via MSIX manifest `uap:Extension Category="windows.protocol"`. Application receives the URI via `OnActivated` with `ProtocolActivatedEventArgs`. Routing logic ports verbatim from `HCBDeepLinkRouter.swift`.

### 3.16 Notifications

| macOS UNUserNotifications | Windows |
| --- | --- |
| `UNCalendarNotificationTrigger` persisted by OS | `ToastNotification` with `DeliveryTime` set; scheduled via `ToastNotifier.AddToSchedule()`. The OS persists scheduled toasts and fires them even if the app is not running. |
| 64-pending cap | Windows has no documented hard cap but recommends ≤ 4096 scheduled toasts; mirror macOS at 64 for consistency. |
| `LocalNotificationScheduler` actor | Re-implement as a class; on each sync, recompute schedule and call `RemoveFromSchedule` for stale entries. |
| Action buttons (mark done, snooze) | Toast actions via XML payload `<actions><action />`. Map `arguments` back into the same handlers. |
| Notification summary in Diagnostics | Same struct, surfaced in DiagnosticsViewModel. |

Major win vs Linux: scheduled toasts work even with the app closed.

### 3.17 Updater

| macOS | Windows |
| --- | --- |
| GitHub Releases poll → DMG download → SHA-256 verify → user opens DMG | GitHub Releases poll → download `.msix` → SHA-256 verify → invoke **AppInstaller** via `Launcher.LaunchUriAsync("ms-appinstaller:?source=...")` or directly via `PackageManager.AddPackageAsync`. |

The MSIX should be signed with a code-signing certificate (Sectigo, DigiCert, or self-signed for preview builds; users add the cert to Trusted People manually for self-signed). Without a valid signature, AppInstaller refuses to install.

For preview/unsigned builds: ship as a `.zip` with a `.exe` inside (Win11 SmartScreen will warn) and document the SmartScreen "More info → Run anyway" path the same way the macOS docs document Gatekeeper.

### 3.18 Diagnostics

Port the entire DiagnosticsView surface 1:1. Add Windows-specific rows:
- Credential Manager availability + DPAPI health.
- Toast notification platform health (`ToastNotificationManagerCompat.History` count vs cap).
- Tray icon registration status.
- WebView2 runtime version (and "install Evergreen" hint if missing).
- Display DPI / fractional scale per monitor.
- Crash reports: read from `%LOCALAPPDATA%\CrashDumps\` (Windows Error Reporting) for our process name; otherwise omit.

### 3.19 Accessibility

| macOS | Windows |
| --- | --- |
| Dynamic Type | WinUI honors the system text scale (`Windows.UI.ViewManagement.UISettings.TextScaleFactor`). Wire `XamlControlsResources` correctly. |
| Reduce Motion | `UISettings.AnimationsEnabled` — gate animations on this. |
| VoiceOver | Narrator. Set `AutomationProperties.Name`, `AutomationProperties.HelpText` on every actionable element. |
| Screen reader testing | Add Narrator + NVDA to QA checklist. |
| High contrast | `AccessibilitySettings.HighContrast` — provide high-contrast theme resources. |

### 3.20 Settings

Same surface as macOS Settings window. Implementation: a dedicated Settings Window with `NavigationView` left rail, one `Page` per current macOS section. Persistence: same `AppSettings` struct in cache JSON; non-critical UI state in `ApplicationData.Current.LocalSettings` (per-user, per-app).

### 3.21 Maps / Location

- Google Maps Embed API key path: `WebView2` displaying the embed URL.
- No-key fallback: `Windows.Services.Maps.MapLocationFinder` for geocoding the address; show a "Open in Bing Maps" button. No native inline map widget in WinUI 3.

### 3.22 Tests

Mirror the macOS test list (~20 suites). Use `xUnit`. For HTTP, fixtures captured from the macOS `GoogleAPITransport` integration tests are the wire-format source of truth. For UI, WinAppSDK ships `Microsoft.UI.Xaml.Hosting` test helpers; smoke-test critical pages only.

### 3.23 Build & release

| macOS | Windows |
| --- | --- |
| `xcodegen` + `xcodebuild` + Makefile | `dotnet` CLI + MSBuild + `Directory.Build.props` + Makefile (or `nuke` build script). Targets: `make build`, `make run`, `make test`, `make msix`, `make publish`. |
| `scripts/package-macos-dmg.sh` | `scripts/package-msix.ps1`. |
| Code-signed + notarized DMG | MSIX signed with a code-signing certificate. Optional EV cert eliminates SmartScreen warnings sooner. |
| GitHub Releases distribution | Same. Plus a winget manifest in `microsoft/winget-pkgs` (separate repo). |
| `install-macos-preview.sh` | `install-windows-preview.ps1` (PowerShell) that downloads the latest signed MSIX, verifies SHA-256, and invokes `Add-AppxPackage`. |

### 3.24 Configuration

| macOS | Windows |
| --- | --- |
| `Info.plist`, `*.entitlements`, hardened runtime, sandbox | **`Package.appxmanifest`** declares capabilities (`internetClient`, `internetClientServer` for loopback OAuth, `runFullTrust`), protocol activation, share target, jump list, file type associations. |
| `GoogleOAuth.xcconfig` | `appsettings.json` (in MSIX package) for non-secret config; `appsettings.Local.json` (gitignored) for local dev. Same shape as macOS xcconfig: client ID, reversed client ID (unused on Windows), maps key. |
| Hardened runtime | MSIX enforces capability-scoped access; `runFullTrust` because we use Win32 P/Invoke for hotkeys + tray. |

---

## 4. Repo Layout

This is a separate top-level project. Sibling to `hot-cross-buns/`, not under it.

```
hot-cross-buns-windows/
├── apps/
│   └── windows/
│       ├── HotCrossBuns.sln
│       ├── src/
│       │   ├── HotCrossBuns.App/                 # WinUI 3 host, Pages, ViewModels
│       │   ├── HotCrossBuns.Google/              # API clients (Tasks + Calendar + transport)
│       │   ├── HotCrossBuns.Sync/                # SyncScheduler, mutations, checkpoints
│       │   ├── HotCrossBuns.Cache/               # LocalCacheStore, crypto, migrations
│       │   ├── HotCrossBuns.Models/              # records (cross-platform JSON contract)
│       │   ├── HotCrossBuns.Notifications/       # toast scheduler
│       │   ├── HotCrossBuns.Tray/                # NotifyIcon integration
│       │   ├── HotCrossBuns.DeepLink/            # URI parser
│       │   ├── HotCrossBuns.Fuzzy/               # FuzzySearcher port
│       │   ├── HotCrossBuns.Updater/             # GitHub Releases + AppInstaller
│       │   └── HotCrossBuns.PowerToysPlugin/     # optional PowerToys Run plugin (separate output)
│       ├── tests/
│       │   ├── HotCrossBuns.Cache.Tests/
│       │   ├── HotCrossBuns.Sync.Tests/
│       │   ├── HotCrossBuns.Google.Tests/
│       │   └── HotCrossBuns.App.Tests/
│       ├── packaging/
│       │   ├── HotCrossBuns.Package/             # MSIX packaging project
│       │   ├── Package.appxmanifest
│       │   └── Assets/
│       │       └── (Square44x44Logo, etc.)
│       └── Configuration/
│           ├── appsettings.json
│           └── appsettings.Local.json            # gitignored
├── docs/                                          # docsite (mirror HCB)
├── scripts/
│   ├── package-msix.ps1
│   ├── sign-msix.ps1
│   ├── publish-winget.ps1
│   └── install-windows-preview.ps1
├── reference/                                     # link / submodule of macOS HCB for parity checks
├── Makefile                                       # wraps dotnet + powershell
├── README.md
└── TODO.md
```

---

## 5. Build Sequence (ordered milestones)

The agent should execute these in order. Each milestone is a shippable internal checkpoint.

1. **Scaffold.** WinUI 3 project via `dotnet new winui` (or unpackaged WinUI template), single window with Mica backdrop. CI builds on `windows-latest`.
2. **Models + cache.** Port `HotCrossBuns.Models` and `HotCrossBuns.Cache`. Round-trip a macOS-produced `cache.json` fixture. Encryption + migrations covered by tests.
3. **Auth.** `HotCrossBuns.Google` transport + `HttpListener` loopback. Sign in to Google, persist tokens in Credential Manager, refresh works.
4. **Sync — read path.** `GoogleTasksClient` + `GoogleCalendarClient`. SyncScheduler full sync writes to cache. Debug pane only.
5. **Tasks UI v1.** Store view, list mode only. Inline edit. CRUD against Google.
6. **Calendar UI v1.** Month + agenda views. Event create/edit. No drag-drop yet.
7. **Sync engine v2.** Incremental sync, checkpoints, pending mutations, offline queue, tombstones.
8. **Tray.** `H.NotifyIcon.WinUI`, Detailed panel (other modes follow).
9. **Notifications.** Scheduled toasts via `ToastNotifierCompat`.
10. **Command palette + global hotkey.** `RegisterHotKey` P/Invoke.
11. **Deep links + jump list + share target + AppExecutionAlias.**
12. **Conflict UI, diagnostics, recovery.**
13. **Calendar UI v2.** Week view, drag-drop.
14. **Notes (markdown).**
15. **Polish: Kanban, custom filters, templates, accessibility passes.**
16. **Updater.** GitHub Releases → MSIX → AppInstaller.
17. **MSIX signing + winget submission.**
18. **PowerToys Run plugin (optional add-on).**
19. **Docsite + install script + GitHub Releases flow.**

Stop at each milestone and validate against the macOS app behavior on the same Google account.

---

## 6. Things to Keep Ahead Of (Windows-specific gotchas)

An agent doing this port will hit each of these. Listed roughly by "hours lost when ignored."

1. **WinUI 3 is still maturing.** Some patterns (e.g., reliable single-instance, multi-window state save/restore, tray) require community libraries or P/Invoke. Pin WinAppSDK 1.5+ minimum and re-evaluate on each release.
2. **No first-party tray API.** `H.NotifyIcon.WinUI` is the de-facto solution. Audit it before depending on it; have a fallback plan if it goes unmaintained.
3. **Single-instance activation.** WinUI 3 does not give you single-instance for free. Use `AppInstance.GetActivatedEventArgs()` + `AppInstance.FindOrRegisterForKey()` pattern in `Main()` to redirect activation to the existing instance. Required for protocol/share target to land in the running app.
4. **MSIX vs unpackaged.** `runFullTrust` is required for global hotkey + Win32 tray P/Invoke + accessing arbitrary file paths. Plan for **MSIX with full-trust capability**, not full UWP sandbox.
5. **Code signing is non-negotiable for distribution.** Unsigned MSIX cannot install. For preview builds, ship a signed-with-self-signed-cert MSIX + a `.cer` file users import to Trusted People. Document the import step the way macOS docs document Gatekeeper. Plan for an EV cert post-launch to dodge SmartScreen.
6. **WebView2 runtime is not always installed.** Ship the Evergreen Runtime bootstrapper or detect at startup and prompt to install. WinUI 3's WebView2 control will throw if the runtime is missing.
7. **`HttpListener` requires a URL ACL on non-loopback ports.** We only bind `127.0.0.1`, which does not require ACL — but if a future change uses a non-loopback port, `netsh http add urlacl` is needed.
8. **DPAPI keys do not roam.** If a user moves to a new machine, their local cache encryption is lost. Document; the cache is a cache, not the source of truth — re-sync from Google on a fresh machine.
9. **Toast notifications need an AUMID** (Application User Model ID) registered in MSIX. Without it, scheduled toasts fail silently. Register `com.gongahkia.HotCrossBuns` and verify with the Notification Visualizer tool.
10. **Multi-monitor + DPI.** `AppWindow.Position` is in screen coordinates; serialize the monitor's device id alongside. Per-monitor DPI awareness is on by default in WinUI 3 — verify rendering at 125%, 150%, 200% during dev.
11. **Mica + Acrylic are Win11 only.** Detect via `Windows.Foundation.Metadata.ApiInformation.IsTypePresent("Microsoft.UI.Composition.SystemBackdrops.MicaController")`; fall back to solid theme color on Win10.
12. **Defender / SmartScreen heuristics.** Avoid global low-level keyboard hooks (`WH_KEYBOARD_LL`); use `RegisterHotKey` only. Avoid auto-elevating without UAC. Avoid writing to `Program Files` at runtime. These trigger false positives.
13. **`Microsoft.UI.Xaml.Controls.MapControl` is gone.** WinUI 3 removed the map control. Use WebView2 + Google Maps Embed; document the loss. Don't try to bring back UWP `MapControl` — it requires XAML Islands hosting which is being removed.
14. **`System.Text.Json` source generators + Native AOT.** If we ever target Native AOT for startup speed, all serialization must go through source-generated contexts. Plan for it now (use generators from day one) so AOT is a flip later.
15. **Windows 10 EOL Oct 2025.** Decide policy: drop Win10 in v1 to simplify (Mica, modern WinUI patterns), or pay the compatibility tax. Decide before milestone 1.
16. **Path A vs Path B OAuth.** Windows is path A only (loopback). Make this clear in onboarding.
17. **Maps fallback is degraded.** No native map widget; WebView2-only path. Acceptable; warn during onboarding if no Maps Embed API key is set.
18. **Cross-platform JSON contract is sacred.** Any field rename, casing change, or enum-tag change must land in macOS, Linux, and Windows simultaneously. Write a contract test that loads fixture JSON from all platforms.
19. **Antivirus uploads.** Some AV products upload unknown signed binaries to the cloud for analysis on first run. The first install of an unsigned-or-self-signed MSIX may pause for tens of seconds. Document.
20. **Long-path support.** Cache paths are short, but if a user has a long username, `%LOCALAPPDATA%` can exceed 260 chars. Enable `LongPathsEnabled` in the MSIX manifest (`<windowsSettings>` block) and use `\\?\` prefix on file APIs when constructing paths defensively.
21. **WinUI 3 + xUnit interaction.** Some tests need a UI thread. Use `Microsoft.UI.Xaml.Hosting` test fixtures or split UI tests into a separate process. Don't try to run WinUI tests in headless CI without the runtime.
22. **AppInstaller on Win10 vs Win11.** AppInstaller behavior differs between versions; test the update flow on both. On Win10, `ms-appinstaller://` might be disabled by group policy — fall back to direct `Add-AppxPackage` invocation.

---

## 7. Distribution

- **Primary:** GitHub Releases hosting:
  - `HotCrossBuns-windows-x64.msix` + `.sha256`
  - `HotCrossBuns-windows-arm64.msix` + `.sha256`
  - `HotCrossBuns-windows-self-signed.cer` (preview only)
- **winget:** Manifest in `microsoft/winget-pkgs` so `winget install HotCrossBuns` works.
- **Microsoft Store:** Post-1.0. Requires identity association + content review.
- **Install script:** `https://gongahkia.github.io/hot-cross-buns/install-windows-preview.ps1` mirrors the macOS install script.
- **arm64:** v1 if .NET 8 + WinAppSDK ARM64 path is smooth; v1.1 otherwise. Build via cross-compile on x64 runners.

---

## 8. License & Identity

- License of HCB itself is unresolved on macOS. Match whatever HCB lands on — DO NOT pick a different license for the Windows port.
- Package family name (PFN) under MSIX: `com.gongahkia.HotCrossBuns_<publisher hash>`.
- AUMID for toast notifications: `com.gongahkia.HotCrossBuns`.
- Display name: `Hot Cross Buns` (matches macOS).

---

## 9. Open Questions (for the human, before milestone 1)

1. **Min Windows target.** Win10 1809 (broader reach, missing Mica) vs Win11 22H2 (smaller install base, full Fluent). Affects UX fidelity.
2. **arm64 in v1?** Simplifies CI but cuts off Windows on ARM users.
3. **Code-signing certificate.** Self-signed for preview is fine; for GA we need a real cert. Sectigo/DigiCert standard or EV? EV avoids SmartScreen but ~$300/yr more.
4. **PowerToys Run plugin in v1?** Adds value for power users; adds a second deliverable to maintain.
5. **Microsoft Store at GA?** Wider discoverability; subjects us to Store policy (privacy questionnaire, OAuth redirect quirks).
6. **Telemetry.** AppCenter / Sentry / none? Default off either way.

---

## 10. Cross-platform Contract (referenced from §3.4, §3.5, §3.6, §6.18)

The Linux and Windows ports MUST agree on:

- `CachedAppState` JSON shape including all enum tags (e.g., `SyncMode`, `CalendarEventStatus`, `PendingMutation.Type`).
- `cache-events.json` sidecar split criteria.
- `cache-state.salt` format and the PBKDF2 iteration count + KDF output length.
- AES-GCM nonce length (12 bytes) and tag length (16 bytes).
- Schema version sequence — never branch.
- `hotcrossbuns://` URL grammar — never branch.

A user MUST be able to copy `cache.json` + `cache-state.salt` + their passphrase from a macOS install onto Windows (placing them under `%LOCALAPPDATA%\HotCrossBuns\`) and have the app read it without migration. This contract is the single most important invariant of the port.
