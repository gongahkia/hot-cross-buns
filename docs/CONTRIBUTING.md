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

## Signing for local runs (free Personal Team)

The project is configured to sign with a free Apple Personal Team (Team ID
`Q2J4QWZLR7`, bound to the maintainer's Apple ID). Running the app with a
different Apple ID requires one of: (a) adding your own Apple ID to Xcode
and flipping the Team in `project.yml`, or (b) overriding the Team in
Xcode's Signing & Capabilities UI and not committing the change.

### First-time setup

1. Xcode → Settings (⌘,) → **Accounts** → **+** → **Apple ID** → sign in.
2. Once added, a "Personal Team" row appears under the Apple ID.
3. Select the `HotCrossBunsMac` target → **Signing & Capabilities** → set
   **Team** to the Personal Team.
4. Repeat for `HotCrossBunsShareExtension`.
5. ⌘R. Xcode downloads a provisioning profile on first build.

### CLI builds fail after `make clean` — expected

`xcodebuild` can't read Xcode's account keychain, so it can't download
fresh provisioning profiles. Symptoms:

```
error: No Account for Team "Q2J4QWZLR7". Add a new account in Accounts settings...
error: No profiles for 'com.gongahkia.hotcrossbuns.mac' were found
```

Fix: open the project in Xcode and build once with ⌘B. That caches the
profile to disk; subsequent `make build` calls then work until the next
clean.

### "No Account for Team" even though the Apple ID is added

Xcode occasionally forgets the account after sleep/wake or an iCloud
re-auth. Re-add the Apple ID in Xcode → Settings → Accounts and the
profiles regenerate on the next ⌘B.

If re-adding doesn't help, nuke the stale profile cache:

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/HotCrossBuns-*
rm -rf ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/
```

Then ⌘R in Xcode. Profiles get re-fetched.

### Why not Developer ID?

Free Personal Team is enough for local dogfooding. Developer ID + notarization
is required only for shipping a DMG to other machines — see §3 of
`URGENT-TODO.md`.

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
