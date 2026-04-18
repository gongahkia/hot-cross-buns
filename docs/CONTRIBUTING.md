# Contributing

This repo is in a transition state.

The old Go/PostgreSQL sync server has been removed. The existing Tauri app is deprecated and remains only as reference material while the Apple-native Google Tasks/Calendar app is designed.

## Current Execution Surfaces

- `apps/apple`: primary SwiftUI app for macOS (iOS/iPadOS targets removed).
- `apps/desktop`: deprecated Tauri/Svelte/Rust desktop app retained for reference.
- `docs`: active product and architecture direction.
- `schema`: historical SQLite schema from the deprecated app.

## Local Setup

Apple app prerequisites:

- Xcode 15+ or newer
- XcodeGen 2.45+

Apple app setup:

```bash
cd apps/apple
xcodegen generate
open HotCrossBuns.xcodeproj
```

Verified Apple check:

```bash
cd apps/apple
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBunsMac -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO
```

Legacy desktop prerequisites:

- Node.js 20+
- Rust stable

Legacy desktop setup:

```bash
cd apps/desktop
npm ci
npm run tauri dev
```

Legacy checks:

```bash
cd apps/desktop
npm run check
npm test

cd src-tauri
cargo test
```

Known status: the legacy desktop checks were failing before the Apple-native pivot. Do not spend time stabilizing deprecated Tauri code unless the change directly supports extracting product behavior for the Swift rebuild.

## Future Apple App Standards

When `apps/apple` is created:

- Prefer SwiftUI-native navigation and state ownership.
- Keep views small and focused.
- Keep Google API adapters separate from UI code.
- Store OAuth tokens in Keychain-backed storage.
- Treat Google Tasks and Google Calendar as source of truth.
- Keep local persistence as cache, settings, sync checkpoints, and pending offline mutations.
- Avoid adding a backend unless implementing webhook-to-APNs relay infrastructure.

## Git And Commits

Use conventional commits:

```text
type(scope): summary
```

Examples:

- `docs(repo): document apple-native google architecture`
- `chore(repo): remove legacy go sync server`
- `feat(apple): add google sign-in shell`

Recommended scopes:

- `apple`
- `desktop`
- `docs`
- `repo`
- `sync`
- `ci`

## Review Standard

Changes should hold up under technical questioning. That means:

- docs describe what the code actually does
- commands in README/CONTRIBUTING/CI are runnable or explicitly marked legacy
- Google API scopes are justified and minimal
- local data does not become an accidental second source of truth
- sync behavior is explicit about polling, background limitations, and conflict handling

Never commit real secrets, OAuth client secrets, signing credentials, provisioning profiles, or notarization credentials.
