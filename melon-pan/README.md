# Melon Pan

Melon Pan is a macOS-native app for Markdown-first editing of Google Docs. Google Docs remains the source of truth; the local app keeps both an editable Markdown copy and the last-known Google Docs JSON so every sync can be audited and recovered.

The product plan lives in [`MELON-PAN.md`](MELON-PAN.md). Siyuan reference lessons are summarized in [`docs/siyuan-reference-notes.md`](docs/siyuan-reference-notes.md).

## Current Implementation State

This repository is macOS-only:

- `apps/macos/melon-pan-mac`: SwiftUI/AppKit shell, generated with XcodeGen.
- `crates/melon-pan-core`: UI-independent Rust core for cache layout, metadata, audit hashes, OAuth PKCE, Google API request construction, and Markdown/Docs conversion boundaries.
- `crates/melon-pan-net`: blocking Google HTTP transport helpers.
- `crates/melon-pan-runtime-shared`: Rust runtime operations shared by the macOS FFI boundary.
- `crates/melon-pan-mac-runtime`: macOS runtime shim for Keychain, browser launch, and platform paths.
- `crates/melon-pan-mac-ffi`: C ABI static library consumed by the Swift app.
- `reference/siyuan`: read-only upstream reference clone for architecture and editor/transpiler evaluation. Do not lift code unless the project license decision allows GPLv3 compatibility.

## Verify

```sh
cargo check --workspace
cargo test --workspace
```

For the macOS app:

```sh
cd apps/macos/melon-pan-mac
xcodegen generate
xcodebuild -project MelonPan.xcodeproj -scheme MelonPan -configuration Debug -destination 'platform=macOS' -derivedDataPath Build/DerivedData build
```

## Run Locally

```sh
script/build_and_run.sh
```

The script builds the Rust static library through the Xcode pre-build phase, builds the Debug app, signs with an available Apple Development identity when present, and opens `MelonPan.app`.

## Cache Contract

The macOS cache layout follows `MELON-PAN.md`:

```text
~/Library/Caches/MelonPan/
|-- docs/<documentId>/
|   |-- current.md
|   |-- current.docs.json
|   |-- meta.json
|   `-- pending/
|-- snapshots/<documentId>/
|   |-- <revisionId>.docs.json
|   `-- <revisionId>.md
`-- drive-tree.json
```

Unsafe document and revision ID filename characters are sanitized before writing cache paths.
