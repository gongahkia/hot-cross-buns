# QA Plan

## Automated layers

- C++ Qt Test: domain validation, SQLite schema/migrations, mutation payloads, Google protocol clients, recurrence, sync conflicts, reminder state, and cancellation.
- QML Test: dialogs, structured inputs, navigation, visual settings, invitations, and accessibility labels.
- Native shell smoke: Qt app launch, resource loading, and macOS adapter wiring.
- Release benchmarks: local search, task render/scroll, calendar navigation, and sync-apply fixture.

Run:

```sh
cmake --preset macos-debug
cmake --build --preset macos-debug --target hcb_native --parallel 3
ctest --preset macos-debug --output-on-failure
.github/scripts/check-native-wrapper-performance.sh <artifact-directory>
```

## Required scenarios

- OAuth configuration validation and redaction; tests use fixtures only.
- Google Tasks CRUD, hierarchy, cross-list recreation/deletion, batching, task recurrence, marker preservation, and duplicate reconciliation.
- Google Calendar CRUD, bulk mutations, Google recurrence round trip/instance behavior, Meet, attachments, reminders, RSVP comments, free-busy, subscriptions, and status-event validation.
- All-day dates remain date-stable; timed event controls use selected IANA zones.
- Notes projection settings and Google Task round trip.
- Search filters/ranking/pagination with source sets larger than one candidate page.
- Timeout/cancellation and shutdown behavior for Google workers.
- Dense Day/Week [physical-display profiling](physical-display-calendar-profile.md) before release; offscreen QML results alone are insufficient.

## Manual macOS acceptance

After automated checks, use [live Google smoke](live-google-smoke.md) and [native shell checklist](manual-macos-native-shell.md). Redact OAuth/client/account data. Linux and Windows are deferred and have no release QA claim.
