# Energy Profiling Workflow

Use this workflow before closing #6. The goal is to verify that foreground
polling, background refresh, calendar motion, notifications, and Spotlight
indexing do not create unacceptable energy impact in common user sessions.

## Build

Use a Debug build when validating instrumentation and a Release build when
recording final energy evidence.

```sh
xcodebuild -project apps/apple/HotCrossBuns.xcodeproj \
  -scheme HotCrossBunsMac \
  -configuration Release \
  -destination 'platform=macOS' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Scenarios

Record each scenario for at least 5 minutes after the app reaches a steady
state. Capture the Xcode Energy gauge screenshot or an Instruments Energy
Organizer trace for each run.

1. Idle foreground
   - App active and focused.
   - Sync mode set to near-realtime.
   - No edits.
   - Expected: stable low wakeups, no repeated Spotlight full rebuilds.

2. Active foreground
   - App focused.
   - Create, edit, complete, and delete several tasks/events.
   - Expected: debounced notifications and incremental Spotlight updates.

3. Unfocused foreground
   - App visible but another app is key.
   - Wait through at least two near-realtime cadence windows.
   - Expected: Diagnostics shows an unfocused poll cadence multiplier.

4. Backgrounded
   - Hide or background the app.
   - Wait for at least 5 minutes.
   - Expected: no active near-realtime loop while scene is inactive.

5. Low Power Mode
   - Enable macOS Low Power Mode.
   - Keep app focused for one cadence window, then unfocused for another.
   - Expected: Diagnostics shows Low Power Mode and the longer cadence.

6. Constrained network
   - Use a constrained/expensive network path where available.
   - Expected: Diagnostics shows constrained polling cadence.

## In-App Diagnostics

Open Diagnostics and Recovery -> Overview after each scenario and record:

- Next poll cadence
- Poll attempt
- Poll conditions
- Notifications sync duration
- Spotlight sync duration
- Spotlight indexed count
- Spotlight removed count
- Spotlight mode

These values are not a replacement for Xcode's Energy gauge, but they explain
why a run did or did not consume work.

## Optional Body Probe

For #5 trigger evidence, launch Debug with:

```sh
HCB_BODY_PROBE=1 open -a HotCrossBuns
```

Then open Diagnostics and Recovery -> Overview -> SwiftUI body probe. Use this
only for profiling; it intentionally emits extra debug work.

## Pass Criteria

#6 can be closed only after evidence shows:

- near-realtime polling exits while the scene is inactive
- unfocused and Low Power Mode cadences are longer than focused cadence
- Spotlight stays incremental after the first prime
- calendar grid motion is suppressed when scene is inactive or Low Power Mode is
  enabled
- no scenario shows sustained high Energy impact without an explained active
  user action

Attach the profiling evidence to #6 before closing it.
