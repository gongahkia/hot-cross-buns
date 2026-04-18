# Hot Cross Buns

Hot Cross Buns is a macOS SwiftUI personal planner backed by Google Tasks and Google Calendar.

## Current Status

- The Go/PostgreSQL self-hosted sync server has been removed.
- The Tauri desktop app in `apps/desktop` is deprecated and kept only as a legacy reference.
- The primary app is `apps/apple`, a SwiftUI app for macOS. The iOS/iPadOS targets have been removed; this product is Mac-only.
- Google Drive is intentionally out of scope.

## Target Product Direction

The product is a Mac-first wrapper around Google Tasks and Google Calendar:

- Google Tasks API is the canonical store for task lists, tasks, subtasks, notes, due dates, and completion state.
- Google Calendar API is the canonical store for calendar events, time-blocking, reminders, and scheduled work.
- Local storage exists as a cache for offline reads, fast launch, search, sync checkpoints, and conflict handling.
- No custom sync server should exist by default. Google is the sync backend.
- Real-time-ish sync is configurable, with foreground polling + jittered backoff as the baseline.

See [APPLE_GOOGLE_REFACTOR_PLAN.md](./docs/APPLE_GOOGLE_REFACTOR_PLAN.md) for the current refactor plan and platform tradeoffs.

## Repo Layout

```text
hot-cross-buns/
  apps/apple/     Primary SwiftUI app for macOS
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

## Future Mac App Work

1. Offline mutation queue + etag-based conflict handling for writes.
2. Replace the JSON snapshot cache with SQLite once queued writes need migrations and indexed local queries.
3. Task reordering, subtasks, recurrence, attendees after product policies are decided.
4. Calendar grid (day/week/month) and task-to-event time-blocking drag.
5. Desktop widgets and direct background App Intents once conflict handling is reliable.

## Related Docs

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [APPLE_GOOGLE_REFACTOR_PLAN.md](./docs/APPLE_GOOGLE_REFACTOR_PLAN.md)
- [CONTRIBUTING.md](./docs/CONTRIBUTING.md)
- [apps/desktop/README.md](./apps/desktop/README.md)
