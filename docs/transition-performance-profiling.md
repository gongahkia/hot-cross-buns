# Transition Performance Profiling

This workflow measures primary Hot Cross Buns screen transitions against the
P95 under 1 second first-content target.

## Real user benchmark scale

Treat maintainer lag reports as large-account reports, not small fixture reports.
As of 2026-05-21, the daily-use local diagnostics snapshot was:

- 1 selected Google Calendar
- 14,180 local Calendar events
- 148 Google Tasks across 9 task lists
- 10 sync checkpoints
- 0 pending writes

Future calendar, sidebar, menu bar, command palette, sync-apply, and local-cache
benchmarks should include a 14k+ event workload. When the maintainer reports
calendar lag, assume the complaint is about this scale unless stated otherwise.

## What is instrumented

Set `HCB_PERF_TELEMETRY=1` to enable transition logs and Instruments signposts.
Normal app launches do not emit this telemetry.

Instrumented primary surfaces:

- Sidebar transitions between Calendar, Tasks, and Notes
- Calendar mode transitions between agenda, day, week, month, year, and multi-day
- Main sheet presentation for quick task, quick note, quick event, add/edit, conversion, sync settings, and diagnostics sheets
- Command palette presentation
- Settings and Diagnostics window presentation

Each transition emits:

- `transition.start <name>`
- `transition.firstContent <name> elapsed_ms=<n>`
- `transition.settled <name> elapsed_ms=<n>`

The same transitions also emit `HCBTransition` signpost intervals so the SwiftUI
Instruments template can line up route changes with long view updates, hitches,
and Time Profiler samples.

## Capture matrix

Run:

```sh
scripts/profile-transitions.sh
```

Defaults:

- 10 `xctrace` runs per scenario
- 10 in-app transition iterations per run
- SwiftUI Instruments template
- Release build at `platform=macOS,arch=arm64`
- Evidence written to `.build-evidence/transition-performance/<timestamp>/`

Useful overrides:

```sh
HCB_TRANSITION_PROFILE_SCENARIOS="sidebar calendarModes" scripts/profile-transitions.sh
scripts/profile-transitions.sh --runs 3 --iterations 5 --time-limit 12s
```

Scenarios:

- `sidebar`
- `calendarModes`
- `sheets`
- `commandPalette`
- `settingsDiagnostics`
- `all`

## Pass criteria

A transition passes the first audit gate when:

- P95 `transition.firstContent` is under 1000 ms.
- SwiftUI Instruments does not show repeated long body updates over 1 ms in the
  transition path without a documented reason.
- Time Profiler does not show a main-thread stall over 150 ms during the route
  change.

If a run fails, inspect the matching `.trace` file first, then compare the
transition signpost interval with SwiftUI Update Groups, Hitches, and Time
Profiler call trees.
