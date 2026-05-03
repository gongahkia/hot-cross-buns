# Hot Cross Buns — Linux Port

A faithful port of the Hot Cross Buns macOS app (`apps/apple/`) to Linux. Same product, same behavior, native Linux feel. This document is the standalone brief for an agent to execute the port without re-deriving the macOS feature surface.

> Sibling document: `HOT-CROSS-BUNS-WINDOWS.md`. Both ports are fully separate codebases — no shared runtime, no FFI bridge. Logic gets re-implemented natively per platform; data formats and Google API surfaces are identical so users with an account on multiple devices see consistent state.

---

## 0. TL;DR for an Implementing Agent

- **Stack:** Rust (stable) + GTK4 + libadwaita, built with Meson + Cargo, packaged as Flatpak (primary) and AppImage + .deb + .rpm (secondary).
- **Target:** Ubuntu 22.04+ / Fedora 38+ / Arch / GNOME 44+. KDE/XFCE supported via Adwaita theming. No Wayland-only or X11-only assumptions.
- **Source of truth:** Google Tasks API + Google Calendar API. Identical to macOS.
- **On-disk format:** Identical JSON schema to macOS (`CachedAppState`). Cache lives in `$XDG_DATA_HOME/hot-cross-buns/cache.json`.
- **Auth:** OAuth 2.0 Loopback flow only (no embedded SDK; Google does not ship an official Linux desktop SDK). Tokens in libsecret (Secret Service API).
- **Notifications:** Freedesktop `org.freedesktop.Notifications` via `notify-rust` or zbus.
- **Tray:** AppIndicator (StatusNotifierItem) via `ksni` crate. Degrade gracefully on GNOME without an extension installed.
- **Global hotkey:** `org.freedesktop.portal.GlobalShortcuts` (Wayland-safe portal). Fallback to X11 `XGrabKey` only when running on X11 and portal is unavailable.
- **Search integration:** GNOME Shell search provider (`org.gnome.Shell.SearchProvider2`) instead of CoreSpotlight.
- **Distribution:** Flathub for the masses; GitHub Releases for AppImage + .deb + .rpm; one-line installer mirroring `install-macos-preview.sh`.

If the agent is told "build the Linux port," they should be able to scaffold from §5, then walk §9 milestones in order.

---

## 1. Mission

Linux users get the same product macOS users get:
- Tasks + Calendar synced with Google as source of truth.
- Local cache, offline mutations, conflict-tolerant sync.
- Tray-resident with three glanceable surfaces (Detailed/Weekly/Compact).
- Command palette, leader-key shortcuts, quick-capture floating window.
- Local notes (markdown).
- Local notifications, Spotlight-equivalent shell search, share-target equivalent.
- Updater that points at GitHub Releases.

Non-goals for v1: KDE Plasma "deep" integration (beyond Adwaita rendering), Snap packaging (use Flatpak), Lomiri/UBports.

---

## 2. Stack Decision

| Layer | Choice | Rationale |
| --- | --- | --- |
| Language | **Rust (stable, edition 2021)** | Memory-safe, great Linux ecosystem, single-binary distribution, matches the long-term core-extraction story. |
| UI toolkit | **GTK4 + libadwaita** via `gtk4-rs` and `libadwaita-rs` | Native GNOME look; libadwaita gives macOS-comparable typography, dark mode, dynamic colors, list-row patterns. Renders correctly on KDE/XFCE with Adwaita theme. |
| UI architecture | **Relm4** | Elm-ish reactive model on top of gtk4-rs. Familiar shape if you know SwiftUI/Combine. Alternative: raw gtk4-rs + manual signal wiring (more code, more control). |
| Async runtime | **Tokio** (multi-thread, "rt-multi-thread" feature) | Standard. GTK main loop bridged via `glib::MainContext::spawn_local` for UI work. |
| HTTP | **reqwest** (rustls-tls) | Avoid OpenSSL system dependency surface; rustls is bundled and consistent across distros. |
| JSON | **serde + serde_json** | — |
| Crypto | **ring** (AES-GCM, PBKDF2) | Same primitives as macOS CryptoKit; matching key derivation parameters keeps the cache file format cross-platform compatible. |
| Secrets | **secret-service crate** → libsecret D-Bus API | Token storage, encryption-key storage. Equivalent to macOS Keychain. |
| Notifications | **notify-rust** | Freedesktop notifications. |
| Tray | **ksni** | StatusNotifierItem; works on KDE, XFCE, and GNOME-with-extension. |
| Global hotkey | **ashpd** (XDG portal client) for `GlobalShortcuts` portal; fallback to **x11-rs** for X11 only | Wayland-safe. |
| Markdown | **pulldown-cmark** + custom renderer into `gtk::TextView` (or `sourceview5` for the live editor) | Match macOS markdown surface. |
| Build | **Meson + Cargo** (Meson orchestrates Cargo + i18n + resources + desktop file) | GNOME standard; required for Flatpak. |
| Packaging | **Flatpak (Flathub)**, **AppImage** (`cargo-appimage` or manual), **.deb** (`cargo-deb`), **.rpm** (`cargo-generate-rpm`) | Coverage. Flatpak is primary. |
| Tests | **`cargo test` + gtk4-rs test harness + Mockito** for HTTP | — |

### 2.1 Rejected alternatives

- **Electron** — bundle size, RAM, ideological mismatch with HCB's "native" identity.
- **Tauri** — viable but ties Linux UI to webkit2gtk which has uneven distro support and lags Chromium feature-wise. GTK4 native is cleaner.
- **Qt/QML** — fine, but pulls in a non-GTK ecosystem on a primarily GNOME-targeted port. Adwaita styling on Qt is poor.
- **Flutter Linux** — desktop is still beta-tier; missing tray/portal stories.
- **Slint** — promising but smaller ecosystem, no libadwaita parity.

### 2.2 Why not share a Rust core between Linux and Windows?

[Inference] It is tempting. Skip it for v1: the moment you add an FFI seam, the Windows port (which we want in C#/WinUI for native feel — see sibling doc) needs a `.dll` build of the core, and you ship two sets of build infra. Re-implement business logic per platform; rely on **identical Google API contracts and identical on-disk JSON schema** to keep behavior consistent. If duplication becomes painful post-1.0, extract a `hcb-core` Rust crate and bind to it from both sides.

---

## 3. Feature Mapping (macOS → Linux)

The table below mirrors the macOS feature audit. "Maps to" is the concrete Linux replacement; "Notes" flags porting risk.

### 3.1 App shell & windowing

| macOS | Linux | Notes |
| --- | --- | --- |
| SwiftUI `Window(id:)` scenes (8 windows: main, settings, help, history, sync issues, diagnostics, update, duplicate review) | `adw::ApplicationWindow` per window, owned by the `adw::Application` | Each macOS scene becomes one window struct in Relm4. |
| Window state restoration (UserDefaults) | Persist `WindowState` (x, y, w, h, maximized) in `$XDG_CONFIG_HOME/hot-cross-buns/windows.json` | GTK gives geometry via `Surface::default_size()` + monitor info. |
| Dock with overdue badge + dock menu | Tray icon (StatusNotifierItem) + tray menu. No taskbar badge; instead, set window urgency hint on overdue. | Linux has no per-app dock badge concept. |
| `NSStatusItem` (menu bar item with three modes) | StatusNotifierItem via `ksni` + a popover window | See §3.10. |
| Floating panels (`NSPanel` quick-capture, command palette) | `gtk::Window` with `set_decorated(false)`, `set_modal(false)`, layer-shell on Wayland for "always-on-top" + skip taskbar | Use `gtk4-layer-shell` crate; on X11 fall back to `_NET_WM_STATE_ABOVE`. |
| `NSApplicationDelegate` lifecycle | `adw::Application` `activate`, `command_line`, `shutdown` signals | — |
| Multi-window restoration | Re-spawn windows on launch from saved state | — |

### 3.2 Auth

| macOS | Linux | Notes |
| --- | --- | --- |
| Embedded GoogleSignIn SDK (path B) | **Removed.** No official Google Sign-In SDK for Linux. | Path A (loopback) becomes the only supported flow. |
| Custom `OAuthLoopbackServer` on localhost | Same: `tiny_http` or `axum` listening on `127.0.0.1:0` (random port), PKCE S256 | Identical behavior to macOS path A. |
| Tokens in Keychain (`Security` framework) | Tokens in libsecret via `secret-service` crate, schema attribute `service=hot-cross-buns,kind=oauth-token` | Encrypted at rest by the user's login keyring. |
| Scopes: tasks + calendar | Identical | — |
| Sign-out clears Keychain + cache | Same flow against libsecret + cache file | — |
| Keychain health probe | libsecret availability probe at startup. Surface UI if no keyring daemon (rare on full DE; common on minimal WMs) | Show "Set up keyring" guidance pointing at gnome-keyring or kwallet bridge. |

### 3.3 Networking

| macOS | Linux | Notes |
| --- | --- | --- |
| `GoogleAPITransport` (URLSession) | `reqwest::Client` with `rustls-tls`, exponential backoff (`backoff` crate) | Match retry policy bit-for-bit so sync replays are interoperable. |
| `GoogleTasksClient`, `GoogleCalendarClient` | Re-implement with same method signatures, same watermark (`updatedMin`) semantics | Snapshot the macOS request/response shapes in fixtures and reuse for tests. |
| `NetworkMonitor` via `NWPathMonitor` | `zbus` listener on `org.freedesktop.NetworkManager` `StateChanged`; fallback to periodic reachability ping | NetworkManager is near-universal; gracefully degrade to "always assume online" if absent. |
| Updater client (GitHub Releases) | Same `reqwest` calls; download `.AppImage` / `.flatpak` / `.deb` / `.rpm` based on detected install kind | See §3.18. |

### 3.4 Sync engine

Re-implement `SyncScheduler` as an actor in Rust (`tokio::sync::mpsc` command channel + owned state). Preserve:
- `SyncMode { Full, Incremental }`.
- Per-list `SyncCheckpoint { list_id, resource_type, updated_min, synced_at }`.
- `PendingMutation` queue with `attempt_count` + exponential backoff replay.
- Tombstone semantics (Tasks `deleted=true`, Calendar `status=cancelled`).
- Last-write-wins on `updatedAt` from Google.
- Parallel fan-out using `futures::future::join_all` for task lists / calendars.

The on-disk JSON for `CachedAppState` MUST be byte-compatible with the macOS schema. A user copying their `cache.json` from macOS to Linux should see the same data.

### 3.5 Local persistence

| macOS | Linux | Notes |
| --- | --- | --- |
| `~/Library/Application Support/Hot Cross Buns/cache.json` | `$XDG_DATA_HOME/hot-cross-buns/cache.json` (default `~/.local/share/hot-cross-buns/cache.json`) | Use `directories` crate. |
| `cache-events.json` sidecar | Same path, same name | — |
| `cache-state.salt` | Same | — |
| AES-GCM 256 with PBKDF2-derived key, key in Keychain | AES-GCM 256 via `ring`, PBKDF2 (matching iteration count from macOS — verify `HCBCacheCrypto.swift`), key in libsecret | Cross-platform-portable cache requires identical KDF params. |
| 3 rotating snapshots | Same | — |
| Atomic writes (`.atomic` option) | Write to `cache.json.tmp` then `rename(2)` (atomic on same-fs POSIX) | — |
| `LocalBackupService` zip export via NSSavePanel | `gtk::FileDialog` (GTK4) save action; `zip` crate for archive | — |
| `CacheSchemaMigrator` | Port schema-version table verbatim; migrators are pure functions over `serde_json::Value`. | Add a regression test loading macOS-produced fixtures from each historical schema version. |

### 3.6 Models

All `Codable` Swift structs become `#[derive(Serialize, Deserialize)]` Rust structs in a `models` module. Field names (`#[serde(rename_all = "camelCase")]`) MUST match the macOS JSON exactly — this is the cross-platform contract. Enumerate from `apps/apple/HotCrossBuns/Models/SyncModels.swift` and friends.

### 3.7 Tasks UI

| macOS | Linux |
| --- | --- |
| Store view (Kanban + List) | `adw::ViewSwitcher` with two pages. Kanban = horizontal `gtk::Box` of `gtk::ListView`s, drag-drop via `gtk::DragSource` / `DropTarget`. List = `gtk::ColumnView` with sortable columns. |
| Task inspector | `adw::NavigationSplitView` content pane; markdown editor uses `sourceview5` with custom HCB scheme. |
| Inline edit, bulk ops | Same affordances; bulk via multi-selection on `ListView`. |
| Search (`FuzzySearcher`) | Port `FuzzySearcher` to Rust (it's a small algorithm); used by command palette + Store search. |
| Custom filters | Port the rule struct + matcher; persist in cache. |
| Natural language task parsing | Port `NaturalLanguageTaskParser` to Rust; parses free-text like "call mom tomorrow 3pm" into a structured task + due date. Used by the quick-add input row and command palette. |
| Query DSL | Port the query rule struct + evaluator to Rust; drives SmartList predicates and advanced search. Persist saved queries in cache. |
| Tag extraction | Port `TagExtractor`; strips `#tag` tokens from task titles and surfaces them as a filterable dimension in Store search and SmartList. |
| SmartList | `adw::NavigationSplitView` sidebar entry per saved list; renders a filtered `gtk::ColumnView` driven by a stored Query DSL predicate. CRUD for saved lists in `$XDG_DATA_HOME/hot-cross-buns/cache.json` (same field as macOS). |

### 3.8 Calendar UI

GTK has no calendar widget that matches `WeekGridView`. Build:
- **Month:** `gtk::Calendar` for the navigator + custom `gtk::DrawingArea` grid with event chips.
- **Week:** Custom `gtk::DrawingArea` (or composite `gtk::Grid` of hour rows × 7 day columns) with event blocks rendered via Cairo. Drag-drop using `gtk::GestureDrag`.
- **Day/Agenda:** `gtk::ListBox` ordered by start time.
- **Recurrence editor:** Form with `adw::ComboRow` for freq/interval, `gtk::Calendar` for "until", multi-select for byday.
- **Map:** Replace MapKit + Google Maps Embed with a `webkit6gtk` `WebView` loading the Google Maps Embed URL (when key present); fallback to a static "Open in browser" button (no native map widget on Linux). Document the loss vs macOS.

### 3.9 Notes

`sourceview5` for live markdown editing. `pulldown-cmark` for preview rendering into a `webkit6gtk::WebView` or styled `gtk::TextView`. Auto-save on every keystroke (debounce 500ms via Tokio interval).

### 3.10 Tray

This is the biggest porting risk on Linux.

- **Implementation:** `ksni` crate exposes a StatusNotifierItem over D-Bus.
- **Behavior on KDE/XFCE/Cinnamon:** works out of the box.
- **Behavior on GNOME:** GNOME 41+ removed the system tray. Users need the **AppIndicator and KStatusNotifierItem Support** GNOME Shell extension. Detect absence at runtime and surface a one-time onboarding card with installation instructions; do NOT silently disappear.
- **Detail panel:** clicking the tray icon opens a small floating `gtk::Window` (layer-shell on Wayland, override-redirect on X11) anchored near the cursor; renders one of three modes (Detailed/Weekly/Compact) per setting.
- **Quick-add:** input row at the bottom of the panel; submits to the same task-create pipeline.
- **Badge:** StatusNotifierItem supports a `Status::NeedsAttention` and a label string; render `(N)` in the tooltip and use the attention status when overdue > 0.

### 3.11 Spotlight equivalent

| macOS | Linux |
| --- | --- |
| `CoreSpotlight` indexing of tasks + events | **GNOME Shell search provider** implementing `org.gnome.Shell.SearchProvider2` over D-Bus. Activated by typing in the GNOME overview. |
| Domains `…tasks`, `…events` | Single search provider returning typed results. |
| Deep links from results | Same `hotcrossbuns://` scheme; see §3.16. |
| KDE Krunner | [Speculation] consider a Krunner plugin in v1.1; v1 ships GNOME provider only. |

### 3.12 App Intents / Shortcuts

No equivalent. Replace with:
- **D-Bus methods** on `com.gongahkia.HotCrossBuns` for `AddTask`, `AddEvent`, `OpenStore`, `OpenCalendar`. Scriptable from the shell with `gdbus call …`.
- **`.desktop` file actions** (`Actions=` lines) for "New Task", "New Event", "Open Calendar", "Open Store" — surfaces in GNOME app launcher right-click menu.

### 3.13 Share extension

| macOS | Linux |
| --- | --- |
| `HotCrossBunsShareExtension.appex` accepting text + URL from system share sheet | **Implement a portal share target** via `org.freedesktop.portal.OpenURI` reverse — actually, what we want is to **register a `.desktop` MimeType handler** for `text/plain` and `x-scheme-handler/https` so the app appears in "Open With" menus. Plus expose a D-Bus method `ShareText(text)` callable from extensions. |
| App Group `UserDefaults` for inbox handoff | Inbox = a JSON file in `$XDG_RUNTIME_DIR/hot-cross-buns/share-inbox/<ulid>.json` watched by the running app via inotify | — |

### 3.14 Services menu

No equivalent on Linux. Closest analogues:
- **GNOME extensions** can register text actions, but requires the user to install one — not in-scope.
- **`xdg-desktop-portal-gtk`** does not expose a comparable text-services hook.
- **Decision:** drop the Services menu surface; document the loss; expose the same operation via the D-Bus `ShareText` method (§3.13).

### 3.15 URL schemes / deep links

`hotcrossbuns://` registered via `.desktop` file `MimeType=x-scheme-handler/hotcrossbuns;` line. Application receives the URL via `g_application_command_line_get_arguments`. Routing logic ports verbatim from `HCBDeepLinkRouter.swift`.

### 3.16 Notifications

`notify-rust` for one-shot notifications. For scheduled reminders we need persistence:
- macOS uses `UNCalendarNotificationTrigger` which the OS persists.
- Linux notifications are immediate-only. We must run our own scheduler.
- **Implementation:** Tokio task that wakes at the next reminder time, fires `notify_rust::Notification`. Persisted across restarts by reading the cache + recomputing schedule on launch. Cap at 64 active reminders to mirror macOS behavior.
- **Caveat:** if the app is not running, no notifications fire. Document explicitly. Optional v1.1: a tiny `systemd --user` timer service that wakes the app at upcoming reminder times.

### 3.17 Updater

| macOS | Linux |
| --- | --- |
| GitHub Releases poll → DMG download → SHA-256 verify → user opens DMG | Detect install kind at runtime: |
| | - **Flatpak:** show "Update available" with link to `flatpak update com.gongahkia.HotCrossBuns`; do not self-update. |
| | - **AppImage:** download new AppImage to `$XDG_DATA_HOME/hot-cross-buns/updates/`, verify SHA-256, replace current via `AppImageUpdate`-style swap on next launch. |
| | - **deb/rpm:** show "Update available" with the package URL; do not auto-install (requires sudo). |
| | - **Source/cargo:** disabled. |

Detection: check whether `$APPIMAGE` env var is set (AppImage), `/.flatpak-info` exists (Flatpak), `dpkg -S "$0"` succeeds (deb), `rpm -qf "$0"` succeeds (rpm).

### 3.18 Diagnostics

Port the entire DiagnosticsView surface 1:1. Add Linux-specific rows:
- libsecret availability + keyring backend name.
- Notification daemon detection (`notify-send --version` or D-Bus introspection).
- Tray detection (StatusNotifierItem registered? GNOME extension installed?).
- Portal availability (`org.freedesktop.portal.Desktop` reachable?).
- Display server (X11 vs Wayland) and compositor (`XDG_CURRENT_DESKTOP`).
- Crash reports: read from `~/.cache/abrt/` if present (Fedora) + `coredumpctl` listing for our PID; otherwise omit.

### 3.19 Accessibility

| macOS | Linux |
| --- | --- |
| Dynamic Type | GTK respects desktop font scale (`gsettings get org.gnome.desktop.interface text-scaling-factor`). Widgets that opt in to Pango automatically resize. |
| Reduce Motion | `gsettings get org.gnome.desktop.interface enable-animations` — gate animations on this. |
| VoiceOver | AT-SPI2 via GTK's built-in accessibility. Set `accessible-name` / `accessible-description` on every actionable widget. |
| Orca screen reader testing | Add to QA checklist. |

### 3.20 Settings

Same surface as macOS Settings window. Implementation: `adw::PreferencesWindow` with one `adw::PreferencesPage` per current macOS section. Persistence: same `AppSettings` struct in cache JSON; non-critical UI state (window positions, last view) in `$XDG_CONFIG_HOME/hot-cross-buns/preferences.json` via `gio::Settings` (GSettings) with our own schema.

### 3.21 Maps / Location

- Google Maps Embed API key path: `webkit6gtk::WebView` displaying the embed URL.
- No-key fallback: there is no native map widget. Show "Open in Google Maps" button and a static "Set up a Google Maps Embed API key for inline previews" hint.

### 3.22 Tests

Mirror the macOS test list (~55 suites). Use `cargo test`. For HTTP, fixtures captured from the macOS `GoogleAPITransport` integration tests should be the wire-format source of truth. For UI, `gtk4-rs` ships with a test harness; smoke-test critical widgets only.

### 3.23 Build & release

| macOS | Linux |
| --- | --- |
| `xcodegen` + `xcodebuild` + Makefile | Meson + Cargo + Makefile. `make build`, `make run`, `make test`, `make flatpak`, `make appimage`, `make deb`, `make rpm`. |
| `scripts/package-macos-dmg.sh` | `scripts/package-flatpak.sh`, `scripts/package-appimage.sh`, `scripts/package-deb.sh`, `scripts/package-rpm.sh`. |
| Code-signed + notarized DMG | Flatpak signed via `flatpak build-sign` with a GPG key; AppImage signed via `appimagetool --sign`; .deb signed via `dpkg-sig`; .rpm signed via `rpm --addsign`. |
| GitHub Releases distribution | Same. Plus Flathub manifest in a separate repo (Flathub policy). |
| `install-macos-preview.sh` | `install-linux-preview.sh` that detects distro, picks the right artifact (Flatpak preferred, AppImage fallback). |

### 3.24 Configuration / entitlements

| macOS | Linux |
| --- | --- |
| `Info.plist`, `*.entitlements`, hardened runtime, sandbox | **Flatpak manifest** (`com.gongahkia.HotCrossBuns.json`) is the analogue. Permissions: `--share=network`, `--socket=fallback-x11`, `--socket=wayland`, `--talk-name=org.freedesktop.secrets`, `--talk-name=org.freedesktop.Notifications`, `--talk-name=org.kde.StatusNotifierWatcher`, `--filesystem=xdg-data/hot-cross-buns`, `--filesystem=xdg-config/hot-cross-buns`, `--device=dri` (for WebKit GPU). |
| `GoogleOAuth.xcconfig` | `config.toml` checked into `apps/linux/Configuration/` with the same shape (client ID + reversed client ID + maps key). Local override file gitignored. |

### 3.25 ICS import/export

| macOS | Linux |
| --- | --- |
| `ICSImporter` / `ICSExporter` in `Services/ICS/`, triggered from `Features/Convert/` | Port to Rust using the `icalendar` crate. Expose as a menu action and D-Bus methods `ImportICS(path: String)` / `ExportICS(path: String)`. |
| File picker via `NSOpenPanel` / `NSSavePanel` | `gtk::FileDialog` (GTK4 async file chooser). Default export path: `$XDG_DOWNLOAD_DIR`. |
| Round-trip fidelity for recurrence, timezones, attendees | Same contract; `ICSImporterTests.swift` fixtures should be ported verbatim as Rust integration tests to verify cross-platform ICS compatibility. |

### 3.26 Portable export / import

| macOS | Linux |
| --- | --- |
| `Features/Export/` — exports full app state (tasks + events + notes + settings) to a versioned ZIP | Port `Exporter` to Rust using the `zip` crate. File picker via `gtk::FileDialog`; default to `$XDG_DOWNLOAD_DIR`. |
| Pre-import dry-run diff showing what would change | Port the diff surface; render in an `adw::MessageDialog` with a scrollable `gtk::TextView`. |
| Back up current data before import replacement | Same: write a dated snapshot to the rotating-snapshot pool before applying any import. |
| Partial filters (import only tasks, only events, etc.) | Port the filter struct; present as `adw::CheckRow` items in a pre-import sheet. |

`ExporterTests.swift` fixtures define the versioned ZIP schema and serve as the cross-platform format contract.

### 3.27 Review

| macOS | Linux |
| --- | --- |
| `Features/Review/` — reflection surface built by `ReviewBuilder` over completed tasks + events in a configurable time window | Port `ReviewBuilder` to Rust (pure function over cache data; no I/O). Render output in an `adw::NavigationPage` with a `gtk::ScrolledWindow` containing styled `gtk::Label` blocks or a read-only `sourceview5` buffer. |
| Triggered from app menu or keyboard shortcut | Same: menu item + command palette entry + `.desktop` `Actions=` line. |
| `ReviewBuilderTests.swift` covers output shape | Port fixtures to Rust; keep as a contract test. |

### 3.28 Forecast

| macOS | Linux |
| --- | --- |
| `Features/Forecast/` — forward-looking summary built by `ForecastBuilder` from upcoming tasks + events | Port `ForecastBuilder` to Rust (same pure-function shape as `ReviewBuilder`). Render in a dedicated `adw::NavigationPage`. |
| Appears as a glanceable surface alongside Tasks and Calendar | Add as a fourth page in the main `adw::ViewSwitcher`. |
| `ForecastBuilderTests.swift` covers output shape | Port fixtures to Rust; keep as a contract test. |

### 3.29 Duplicates detection and merging

| macOS | Linux |
| --- | --- |
| `Features/Duplicates/` + `Services/Duplicates/` — detects near-duplicate tasks/events; surfaces a review window for merge/dismiss | Port the duplicate-detection heuristic to Rust (candidate for `hcb-sync` or a dedicated `hcb-dedup` crate). Render the review list in an `adw::Dialog` with side-by-side `adw::ActionRow` pairs and merge / dismiss actions per pair. |
| Runs as a background pass after each full sync | Same: spawn as a Tokio task post-sync; deliver results to the UI via `glib::MainContext::spawn_local`. |

---

## 4. Repo Layout

This is a separate top-level project. Sibling to `hot-cross-buns/`, not under it.

```
hot-cross-buns-linux/
├── apps/
│   └── linux/
│       ├── Cargo.toml                   # workspace
│       ├── crates/
│       │   ├── hcb-app/                 # main GTK app, Relm4 components
│       │   ├── hcb-google/              # API clients (Tasks + Calendar + transport)
│       │   ├── hcb-sync/                # SyncScheduler, mutations, checkpoints
│       │   ├── hcb-cache/               # LocalCacheStore, crypto, migrations
│       │   ├── hcb-models/              # serde structs (cross-platform JSON contract)
│       │   ├── hcb-notify/              # notification scheduler
│       │   ├── hcb-tray/                # StatusNotifierItem
│       │   ├── hcb-search-provider/     # GNOME shell search provider (separate binary)
│       │   ├── hcb-deeplink/            # URL parser
│       │   └── hcb-fuzzy/               # FuzzySearcher port
│       ├── data/
│       │   ├── com.gongahkia.HotCrossBuns.desktop
│       │   ├── com.gongahkia.HotCrossBuns.SearchProvider.ini
│       │   ├── com.gongahkia.HotCrossBuns.service          # D-Bus
│       │   ├── icons/hicolor/{16,22,32,48,64,128,256,512}/apps/com.gongahkia.HotCrossBuns.png
│       │   └── com.gongahkia.HotCrossBuns.metainfo.xml     # AppStream
│       ├── flatpak/
│       │   └── com.gongahkia.HotCrossBuns.json             # manifest
│       ├── meson.build
│       ├── meson_options.txt
│       └── Configuration/
│           ├── config.example.toml
│           └── config.toml                                  # local, gitignored
├── docs/                                # docsite (mirror HCB)
├── scripts/
│   ├── package-flatpak.sh
│   ├── package-appimage.sh
│   ├── package-deb.sh
│   ├── package-rpm.sh
│   └── install-linux-preview.sh
├── reference/                            # link / submodule of macOS HCB for parity checks
├── Makefile
├── README.md
└── TODO.md
```

---

## 5. Build Sequence (ordered milestones)

The agent should execute these in order. Each milestone is a shippable internal checkpoint.

1. **Scaffold.** Cargo workspace, Meson, GTK4 + libadwaita "hello world" with one window. CI builds on Ubuntu 22.04 and Fedora 39.
2. **Models + cache.** Port `hcb-models` and `hcb-cache`. Round-trip a macOS-produced `cache.json` fixture. Encryption + migrations covered by tests.
3. **Auth.** `hcb-google` transport + loopback server. Sign in to Google, persist tokens in libsecret, refresh works.
4. **Sync — read path.** `GoogleTasksClient` + `GoogleCalendarClient`. SyncScheduler full sync writes to cache. No UI yet beyond a debug pane.
5. **Tasks UI v1.** Store view, list mode only. Inline edit. CRUD against Google.
6. **Calendar UI v1.** Month + agenda views. Event create/edit. No drag-drop yet.
7. **Sync engine v2.** Incremental sync, checkpoints, pending mutations, offline queue, tombstones.
8. **Tray.** StatusNotifierItem, Detailed panel (other modes follow).
9. **Notifications.** In-process scheduler + libnotify.
10. **Command palette + global hotkey.** Portal-based hotkey with X11 fallback.
11. **Deep links + .desktop actions + D-Bus methods.**
12. **GNOME search provider** (separate binary).
13. **Conflict UI, diagnostics, recovery.**
14. **Calendar UI v2.** Week view, drag-drop.
15. **Notes (markdown).**
16. **Polish: Kanban, custom filters, templates, accessibility passes.**
17. **Updater.**
18. **Packaging:** Flatpak first (Flathub PR), then AppImage, then .deb/.rpm.
19. **Docsite + install script + GitHub Releases flow.**

Stop at each milestone and validate against the macOS app behavior on the same Google account.

---

## 6. Things to Keep Ahead Of (Linux-specific gotchas)

An agent doing this port will hit each of these. Listed roughly by "hours lost when ignored."

1. **Wayland vs X11.** Test both from day one. Layer-shell, global hotkeys, screen positioning, drag-drop, and clipboard all behave differently. Prefer portals (`ashpd`) so the same code path works on both.
2. **GNOME has no system tray.** §3.10. Never assume tray works; always provide a window-based fallback path (e.g., main window can do everything the tray does).
3. **libsecret may be absent.** Headless installs, some minimal WMs. Detect at startup; if absent, refuse to store tokens — do NOT fall back to plaintext on disk. Show an error card pointing at gnome-keyring.
4. **Notification daemon may be absent.** Detect via D-Bus; if absent, surface a warning and silently no-op scheduled notifications rather than crashing.
5. **Flatpak sandbox limits filesystem access.** Plan permissions explicitly. The cache lives in `$XDG_DATA_HOME` which Flatpak rewrites to `~/.var/app/com.gongahkia.HotCrossBuns/data/`. Users cannot trivially share a `cache.json` between a macOS install and a Flatpak install — document the path remap.
6. **GTK4 requires Adwaita 1.4+ for some patterns** (`adw::ToolbarView`, `adw::NavigationSplitView`). Ubuntu 22.04 ships older. Either bump min target to 23.10 / 24.04, or feature-gate those widgets, or ship libadwaita statically (Flatpak path). Decide before milestone 1.
7. **Single-instance behavior.** Use `gio::ApplicationFlags::HANDLES_COMMAND_LINE` + `register_session=true` so a second `hot-cross-buns hotcrossbuns://task/123` invocation forwards to the running instance. macOS gets this for free; GTK requires explicit setup.
8. **Locale / RTL.** GTK handles RTL automatically but only if you do not hardcode left/right in CSS. Use `start`/`end`.
9. **HiDPI + fractional scaling.** Wayland fractional scaling in GNOME 46 is finally usable; verify rendering at 1.25× and 1.5×. Cairo-drawn calendar grid needs to multiply by `scale_factor()`.
10. **Dark mode.** `adw::StyleManager::default().color_scheme()` follows the system. Calendar custom drawing must theme via `style_context` colors, not hardcoded.
11. **D-Bus name collisions.** Use the reverse-DNS bundle ID `com.gongahkia.HotCrossBuns` as the well-known name. The search provider needs its own service file pointing back at the main binary or a dedicated provider binary.
12. **`Tokio` and `glib::MainContext` interplay.** Pick one rule and stick to it: I/O on Tokio, UI on glib. Bridge via `glib::MainContext::spawn_local` for results that need to touch widgets. Crashes happen when async code captures `gtk::Widget` across threads — `gtk::Widget` is `!Send`.
13. **AppIndicator API churn.** `ksni` works, but keep an eye on the StatusNotifierItem ecosystem; if it regresses, fall back to a borderless always-on-top mini window in the corner of the screen as a last-resort tray.
14. **AppImage updater needs `AppImageUpdate`.** Bundle `appimageupdatetool` or implement zsync ourselves. Easier to instruct users to re-download from GitHub Releases for v1.
15. **Flathub review can take weeks.** Submit early; iterate on PR comments. Do NOT block GA on Flathub publication — ship AppImage first.
16. **Crash dumps.** No equivalent of macOS's `~/Library/Logs/DiagnosticReports/`. Ship with `sentry-rust` (self-hosted Sentry or disabled by default) or read from `coredumpctl`. Make telemetry off by default with explicit opt-in.
17. **Snap is intentionally not supported.** Snap's confinement model breaks D-Bus session bus access patterns we rely on. Document this; redirect Snap users to Flatpak.
18. **Path A vs Path B OAuth.** Linux is path A only (loopback). Make this clear in onboarding so users do not look for a "Sign in with Google" button.
19. **Maps fallback is degraded.** No native map widget. Acceptable; warn during onboarding if no Maps Embed API key is set.
20. **Cross-platform JSON contract is sacred.** Any field rename, casing change, or enum-tag change must land in macOS and Linux simultaneously. Write a contract test that loads fixture JSON from both platforms.

---

## 7. Distribution

- **Primary:** Flathub. Verified publisher under `com.gongahkia.HotCrossBuns`.
- **Secondary:** GitHub Releases hosts:
  - `HotCrossBuns-linux-x86_64.AppImage` + `.sha256`
  - `hot-cross-buns_<version>_amd64.deb` + `.sha256`
  - `hot-cross-buns-<version>.x86_64.rpm` + `.sha256`
- **Install script:** `https://gongahkia.github.io/hot-cross-buns/install-linux-preview.sh` detects distro/format preference and grabs the right artifact.
- **arm64:** v1.1. Build infra via `cross` or native ARM runners.

---

## 8. License & Identity

- License of HCB itself is unresolved on macOS. Match whatever HCB lands on — DO NOT pick a different license for the Linux port.
- Reverse-DNS app ID: `com.gongahkia.HotCrossBuns` (the dot-cased form is required for Flatpak).
- AppStream metadata required for Flathub: `com.gongahkia.HotCrossBuns.metainfo.xml` with screenshots, description, OARS rating, releases changelog.

---

## 9. Open Questions (for the human, before milestone 1)

1. **Min target distro.** Ubuntu 22.04 (libadwaita 1.0, missing some widgets) vs 24.04 (libadwaita 1.5)? Affects what UI patterns we can use.
2. **GNOME-only or KDE-equal-citizen?** Affects whether we ship a Krunner plugin alongside the GNOME search provider in v1.
3. **Telemetry.** Sentry or none? Default off either way.
4. **arm64 in v1?** Doubles CI cost.
5. **Snap stance.** Confirm dropping Snap is OK given some Ubuntu users default to it.
