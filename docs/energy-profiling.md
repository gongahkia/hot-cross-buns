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

## 2026-05-13 Local Evidence Pass

This pass found and fixed a Spotlight startup churn issue before final Energy
Gauge closure:

- `xctrace` Power Profiler is not usable for this macOS target in the current
  Xcode environment; it reports that Power Profiler is supported only for iOS
  and iPadOS.
- A 60 second macOS Time Profiler launch sample before the fix produced 1,823
  exported time-sample rows and launch logs showed repeated CoreSpotlight
  domain delete/index activity.
- Root cause: `SpotlightIndexer.update` was actor-reentrant while awaiting
  CoreSpotlight. Overlapping update calls could each see the indexer as
  unprimed and perform full domain replacement work.
- `SpotlightIndexer` now coalesces updates behind one in-flight apply loop, so
  concurrent updates during the first prime become one latest pending snapshot
  and do not trigger another full domain rebuild.
- A short macOS Time Profiler launch sample after the fix produced 104 exported
  time-sample rows. Follow-up exact-bundle profiling clarified that launch
  warm-up can still include the expected first-prime CoreSpotlight work, but it
  does not persist into steady state.

Further exact Release-app profiling:

- Foreground launch warm-up, attached after 30 seconds for 5 minutes: 6,601
  exported time-sample rows. Process sampling showed one short 92.5% CPU sample
  during launch warm-up, then mostly 0-0.2% CPU; RSS settled from about 506 MB
  to about 73 MB by the end.
- Hidden/background launch, attached after 30 seconds for 5 minutes: 8 exported
  time-sample rows, 0.0% CPU across process samples, RSS settled from about
  54 MB to about 45 MB. The Mac slept during this window, which is useful
  evidence that the hidden app did not hold the system awake.
- Steady foreground, attached after a 3 minute warm-up for 5 minutes: 6 exported
  time-sample rows, 0.0% CPU across process samples, RSS settled from about
  53 MB to about 44 MB, and filtered logs showed no Spotlight, refresh, or
  near-realtime sync activity during the sampled steady-state window. The Mac
  also slept during this window.

Artifacts from this local pass are under `.build-evidence/issue-6/`. This is
useful regression evidence, but it does not replace the required 5 minute Xcode
Energy Gauge or Instruments Energy Organizer runs for closing #6, especially
the signed-in near-realtime cadence scenarios.
