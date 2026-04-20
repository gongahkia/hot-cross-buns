# Hot Cross Buns

Hot Cross Buns is a macOS SwiftUI personal planner backed by Google Tasks and Google Calendar.

## Current Status

- The primary (and only) app is `apps/apple`, a SwiftUI app for macOS. The iOS/iPadOS targets have been removed; this product is Mac-only.
- The Go/PostgreSQL self-hosted sync server has been removed.
- A Tauri/SvelteKit prototype previously lived at `apps/desktop/` and has since been deleted; the Swift app is the canonical implementation.
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
  apps/apple/     SwiftUI app for macOS
  docs/           Architecture, refactor plan, design, and contribution notes
  schema/         Historical SQLite schema from the removed local-first prototype
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

To actually **run** the app (not just build), you need code signing. The
project is configured for a free Apple Personal Team, which can only be
used via Xcode's GUI (the CLI can't read Xcode's account keychain). See
[docs/CONTRIBUTING.md § Signing for local runs](./docs/CONTRIBUTING.md#signing-for-local-runs-free-personal-team)
for first-time setup and troubleshooting "No Account for Team" / "No profiles
for …" errors.

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
</content>
