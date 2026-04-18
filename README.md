# Hot Cross Buns

Hot Cross Buns is being redirected from a Tauri local-first desktop task manager into an Apple-native personal planner backed by Google Tasks and Google Calendar.

## Current Status

- The Go/PostgreSQL self-hosted sync server has been removed.
- The Tauri desktop app in `apps/desktop` is deprecated and kept only as a legacy reference.
- The primary app is now `apps/apple`, a greenfield SwiftUI app for iOS, iPadOS, and macOS.
- Starting fresh is acceptable; this repo no longer assumes migration from the existing local SQLite database.
- Google Drive is intentionally out of scope for the first Apple-native version.

## Target Product Direction

The new product should be an Apple-first wrapper around Google Tasks and Google Calendar:

- Google Tasks API is the canonical store for task lists, tasks, subtasks, notes, due dates, and completion state.
- Google Calendar API is the canonical store for calendar events, time-blocking, reminders, and scheduled work.
- Local storage exists as a cache for offline reads, fast launch, search, sync checkpoints, and conflict handling.
- No custom sync server should exist by default. Google is the sync backend.
- Real-time-ish sync should be configurable, with polling as the baseline and webhook/APNs relay treated as an optional later enhancement.

See [APPLE_GOOGLE_REFACTOR_PLAN.md](./docs/APPLE_GOOGLE_REFACTOR_PLAN.md) for the current refactor plan and platform tradeoffs.

## Repo Layout

```text
hot-cross-buns/
  apps/apple/     Primary SwiftUI rewrite for iOS, iPadOS, and macOS
  apps/desktop/   Deprecated Tauri desktop app retained as reference material
  docs/           Current architecture, refactor plan, design, and contribution notes
  schema/         Historical SQLite schema from the deprecated local-first app
```

## Apple App

Generate and open the Xcode project:

```bash
cd apps/apple
xcodegen generate
open HotCrossBuns.xcodeproj
```

Verified macOS build command:

```bash
cd apps/apple
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBunsMac -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO
```

Verified macOS test command:

```bash
cd apps/apple
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBunsMac -destination 'platform=macOS' test CODE_SIGNING_ALLOWED=NO
```

iOS builds require the matching iOS platform components installed in Xcode.

Create a local macOS DMG:

```bash
scripts/package-macos-dmg.sh
```

Optional signing/notarization environment:

```bash
CODE_SIGN_IDENTITY="Developer ID Application: Example Team (TEAMID)" \
NOTARIZE=1 \
APPLE_ID="you@example.com" \
APPLE_TEAM_ID="TEAMID" \
APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
scripts/package-macos-dmg.sh
```

## Legacy Desktop App

The existing desktop app can still be inspected or run while it remains in the repo, but it is not the target architecture.

```bash
cd apps/desktop
npm ci
npm run tauri dev
```

Useful legacy verification commands:

```bash
cd apps/desktop
npm run check
npm test

cd src-tauri
cargo test
```

Known status: the legacy desktop checks were already failing before this pivot and should not block the Apple-native rebuild.

## Future Apple App

The intended implementation path is now product hardening rather than MVP scaffolding:

1. Add automated tests around Google payloads, sync checkpoints, cache persistence, and recovery flows.
2. Harden offline mutation replay and conflict handling for failed Google writes.
3. Replace the JSON snapshot cache with SQLite when queued writes need migrations and indexed local queries.
4. Add task reordering, recurrence, and attendees after the product policies are decided.
5. Expand Apple-native surfaces with widgets and direct background App Intents once conflict handling is reliable.
6. Provide Developer ID signing and notarization credentials for website-ready macOS DMGs.

## Related Docs

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [APPLE_GOOGLE_REFACTOR_PLAN.md](./docs/APPLE_GOOGLE_REFACTOR_PLAN.md)
- [CONTRIBUTING.md](./docs/CONTRIBUTING.md)
- [apps/desktop/README.md](./apps/desktop/README.md)
