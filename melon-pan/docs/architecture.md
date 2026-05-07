# Architecture

Melon Pan is a macOS app with a SwiftUI/AppKit shell over a small Rust runtime.

## Rust Core

`melon-pan-core` owns behavior that should stay independent of UI and OS integration:

- Local cache paths and atomic writes.
- Metadata shape for revision IDs, hashes, pull/push timestamps, and fidelity reports.
- Audit hash computation for `current.md`, `current.docs.json`, Docs-to-Markdown projection, and Markdown-to-Docs projection.
- Typed conversion boundaries for Google Docs document structures and Markdown update plans.
- OAuth PKCE and Google API request construction that can be tested without network access.

`melon-pan-net` owns Google HTTP transport helpers. `melon-pan-runtime-shared` owns sync, OAuth, history, template, and update-check operations that remain independent of SwiftUI/AppKit. `melon-pan-mac-runtime` supplies macOS paths, Keychain token storage, and browser launch behavior. `melon-pan-mac-ffi` exposes the Rust surface to Swift through a C ABI.

## macOS App

`apps/macos/melon-pan-mac` owns UI, windowing, settings, notifications, diagnostics, packaging, and user workflows. It links `libmelon_pan_mac_ffi.a` from `MelonPan/Build/`.

## Data Flow

Pull:

1. The app runs a least-privilege OAuth loopback flow and stores tokens in Keychain.
2. The app lists changed Docs through Drive.
3. The app fetches Docs JSON.
4. Rust converts Docs JSON to Markdown and a fidelity report.
5. Rust writes snapshots first, then `current.docs.json`, `current.md`, and `meta.json`.

Push:

1. The editor saves Markdown.
2. Rust builds a full-body replace update plan for v1.
3. The app sends `documents.batchUpdate` with a revision guard.
4. The app immediately re-pulls the document and refreshes the cache.

## Core Non-Goals

The Rust core must not depend on SwiftUI, AppKit, WebKit, OAuth SDKs, system keyrings, or HTTP clients.
