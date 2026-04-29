<p align="center">
  <a href="https://gongahkia.github.io/hot-cross-buns/">
    <img src="docs/logo.png" alt="Hot Cross Buns logo" width="144" />
  </a>
</p>

<h1 align="center">Hot Cross Buns</h1>

<h3 align="center">Keyboard-first planning for macOS, backed by Google Tasks and Google Calendar.</h3>

<p align="center">
  <a href="https://gongahkia.github.io/hot-cross-buns/">Website</a> ·
  <a href="https://github.com/gongahkia/hot-cross-buns/releases/latest">Latest Release</a> ·
  <a href="https://gongahkia.github.io/hot-cross-buns/privacy.html">Privacy</a> ·
  <a href="apps/apple/README.md">Apple App</a> ·
  <a href="reference/architecture/ARCHITECTURE.md">Architecture</a>
</p>

<p align="center">
  <a href="https://github.com/gongahkia/hot-cross-buns/releases/latest/download/HotCrossBuns-macOS.dmg">
    <img src="https://img.shields.io/badge/Download-DMG-F2B36D?style=for-the-badge&logo=apple&logoColor=white&labelColor=1f2430" alt="Download DMG" />
  </a>
  <a href="https://gongahkia.github.io/hot-cross-buns/">
    <img src="https://img.shields.io/badge/Open-Docsite-6E89FF?style=for-the-badge&logo=githubpages&logoColor=white&labelColor=1f2430" alt="Open docsite" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/gongahkia/hot-cross-buns/actions/workflows/ci.yml">
    <img src="https://github.com/gongahkia/hot-cross-buns/actions/workflows/ci.yml/badge.svg" alt="CI status" />
  </a>
  <a href="https://github.com/gongahkia/hot-cross-buns/releases/latest">
    <img src="https://img.shields.io/github/v/release/gongahkia/hot-cross-buns?display_name=tag" alt="Latest release" />
  </a>
  <img src="https://img.shields.io/badge/macOS-14%2B-black" alt="macOS 14 or later" />
  <img src="https://img.shields.io/badge/Distribution-Unsigned%20DMG-orange" alt="Unsigned DMG distribution" />
</p>

> [!IMPORTANT]
> Public downloads currently ship as an unsigned DMG. On first launch, macOS may ask the user to allow the app once from `System Settings > Privacy & Security > Open Anyway`.

## Table of Contents

- [Highlights](#highlights)
- [Demo](#demo)
- [Install](#install)
- [Current Status](#current-status)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Build From Source](#build-from-source)
- [Release Flow](#release-flow)
- [Testing](#testing)
- [Additional Documentation](#additional-documentation)

## Highlights

Hot Cross Buns is a native Mac planner built around three everyday surfaces:

- Tasks for inbox capture and day-to-day execution, synced with Google Tasks
- Calendar views for agenda, day, week, month, and longer-range planning, synced with Google Calendar
- Lightweight local notes for context, drafts, and reference material

Around those core surfaces, the app also includes:

- Command palette capture and keyboard-first navigation
- Leader-key shortcuts for diagnostics, help, refresh, and secondary actions
- menu bar surfaces for glanceable calendar, compact capture, and fast return to the main app
- Spotlight indexing and App Shortcuts integration
- Local cache, sync checkpoints, and pending offline mutations
- Diagnostics, recovery tools, and local reminder scheduling

## Demo

<div align="center">
  <video src="https://github.com/user-attachments/assets/ea15df17-b65f-4f2e-b6f2-a6fec0fe5490" controls muted playsinline preload="metadata"></video>
</div>

## Install

**Direct download**

- DMG: `https://github.com/gongahkia/hot-cross-buns/releases/latest/download/HotCrossBuns-macOS.dmg`
- Release page: `https://github.com/gongahkia/hot-cross-buns/releases/latest`

**One-line terminal install**

```bash
curl -fsSL https://gongahkia.github.io/hot-cross-buns/install-macos-preview.sh | bash
```

The installer downloads the latest DMG from GitHub Releases, verifies the matching `.sha256`, and installs the app into `/Applications` or `~/Applications`.

**First launch on macOS**

1. Open the app once after dragging it into `Applications`.
2. If macOS blocks it, go to `System Settings > Privacy & Security`.
3. Click `Open Anyway`.

You should only need to do that once per Mac.

## Current Status

- `apps/apple` is the canonical product. Older Tauri and self-hosted sync-server work has been removed from the active repo path.
- Google Tasks and Google Calendar are the source of truth.
- Google OAuth is bring-your-own-client. Downloaded DMGs can use a user-supplied Google Cloud Desktop OAuth client at runtime; source builds can still embed a native Google Sign-In client.
- The website and installer both target the stable latest-release DMG alias: `HotCrossBuns-macOS.dmg`.
- The in-app updater checks GitHub Releases for newer DMGs and guides the user through a manual replace.
- The public path is a real unsigned DMG release flow, not a signed/notarized consumer release.

## Architecture

```mermaid
flowchart TD
    user["macOS user"] --> app["Hot Cross Buns app<br>SwiftUI + AppKit bridges"]

    subgraph client["Client runtime"]
        app --> surfaces["Tasks · Calendar · Notes<br>Command palette · Menu bar"]
        app --> integrations["Spotlight · App Intents · Share extension"]
        app --> model["AppModel"]
        model --> auth["GoogleAuthService"]
        model --> sync["SyncScheduler"]
        model --> cache["LocalCacheStore<br>settings, checkpoints,<br>pending mutations"]
        model --> notifications["LocalNotificationScheduler"]
        model --> updater["UpdaterController"]
        cache --> disk["Application Support<br>local JSON cache"]
    end

    subgraph google["Google source of truth"]
        sync --> tasksClient["GoogleTasksClient"]
        sync --> calendarClient["GoogleCalendarClient"]
        tasksClient --> tasksApi["Google Tasks API"]
        calendarClient --> calendarApi["Google Calendar API"]
    end

    subgraph distribution["Distribution"]
        repo["GitHub repo"] --> automation["GitHub Actions CI / Release"]
        automation --> releases["GitHub Releases<br>unsigned DMG + SHA-256"]
        automation --> site["GitHub Pages docsite<br>and install script"]
    end

    releases --> user
    site --> user
```

## Build From Source

**Requirements**

- macOS 14+
- Xcode 15+
- `xcodegen`

**Generate the Xcode project**

```bash
cd apps/apple
xcodegen generate
```

**Build**

```bash
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBunsMac -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO
```

**Run tests**

```bash
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBunsMac -destination 'platform=macOS' test CODE_SIGNING_ALLOWED=NO
```

**Package an unsigned DMG locally**

```bash
scripts/package-macos-dmg.sh
```

**Google Cloud OAuth setup**

There are two supported Google OAuth paths.

**Path A: downloaded DMG + runtime Desktop OAuth**

Downloaded DMGs do not need to be rebuilt for personal Google sync:

1. Create a Google Cloud project.
2. Enable the Google Tasks API and Google Calendar API.
3. Configure the Google Auth platform / OAuth consent screen. For a personal Gmail account, choose `External`; add your Google account as a test user while setting up.
4. Create a `Desktop app` OAuth client.
5. Open Hot Cross Buns, paste the desktop client ID and optional client secret into the Google OAuth client setup card, then click Connect Google.

For personal day-to-day use, set the OAuth app publishing status to `In production` after setup. Google's testing status issues refresh tokens that expire after 7 days for the Tasks and Calendar scopes, so staying in testing means periodic re-consent.

**Path B: source build + embedded native Google Sign-In**

To embed a native Google Sign-In client in a source build instead, copy `apps/apple/Configuration/GoogleOAuth.example.xcconfig` to `apps/apple/Configuration/GoogleOAuth.local.xcconfig` and fill in your own iOS/macOS OAuth client values. The committed `apps/apple/Configuration/GoogleOAuth.xcconfig` provides blank CI-safe defaults and includes the local override when present.

```xcconfig
GOOGLE_MACOS_CLIENT_ID = your-client-id.apps.googleusercontent.com
GOOGLE_MACOS_REVERSED_CLIENT_ID = com.googleusercontent.apps.your-reversed-client-id
GOOGLE_MAPS_EMBED_API_KEY =
```

Do not distribute a build that embeds your personal native OAuth client for other people's accounts.

## Release Flow

- Build release DMGs locally; this repository no longer uses GitHub Actions to package macOS releases.
- Personal release builds may use `apps/apple/Configuration/GoogleOAuth.local.xcconfig` with `GOOGLE_MACOS_CLIENT_ID` and `GOOGLE_MACOS_REVERSED_CLIENT_ID`.
- Public release builds can omit embedded OAuth values because users can add their own Desktop OAuth client at runtime. Only embed a shared production OAuth client if you intend to complete Google's public OAuth verification path for that client.
- `GOOGLE_MAPS_EMBED_API_KEY` is optional. When omitted, the app falls back to MapKit instead of the embedded Google Maps iframe.
- Upload the versioned DMG, stable `HotCrossBuns-macOS.dmg` alias, and matching `.sha256` files to GitHub Releases.
- The website download button, one-line installer, and in-app updater all target the stable latest-release asset.
- See [reference/release/RELEASING.md](reference/release/RELEASING.md) for the exact local release commands.

## Testing

The current suite is strongest on pure logic and sync-domain behavior:

- search and parsing
- recurrence and date handling
- bulk task operations
- local cache persistence
- sync tombstone handling
- calendar grid and drag/drop computations
- transport-level Google Tasks client behavior
- GitHub release updater behavior

CI builds and runs the macOS test suite on every push and pull request.

The next highest-value gaps are Google Calendar transport edge cases, local notification scheduling edge cases, and more live integration smoke testing against real Google accounts.

## Additional Documentation

- [Apple app README](apps/apple/README.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Architecture reference](reference/architecture/ARCHITECTURE.md)
- [Docsite](https://gongahkia.github.io/hot-cross-buns/)
