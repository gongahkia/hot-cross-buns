# Physical Display Calendar Profile

Run this on a real macOS display. Offscreen QML tests and CI cannot establish scroll smoothness.

## Fixture

`./script/build_and_run.sh --profile-timeline` launches a new app instance with 25,000 generated timed events across the selected week. It does not initialize Google, read the local mirror, schedule reminders, or write user data. The model regression fixture creates 192 Day and 1,344 Week rows for a one-hour time range; the rendered viewport adds its documented overscan.

## Procedure

1. Run the command above on the target Mac without `-platform offscreen`.
2. Select Day, scroll repeatedly from 09:00 through 17:00, then repeat in Week.
3. Record a Time Profiler and Core Animation trace in Instruments while each view is scrolled for at least 20 seconds. Record macOS version, display refresh rate, resolution, Qt version, commit, and whether the app is debug or release.
4. Inspect the trace for frame pacing, QML binding/creation cost, and sustained CPU. Do not record account data; the fixture is deterministic.

## Acceptance

- At 60 Hz: p95 frame time is at most 16.7 ms and no scrolling frame exceeds 33.3 ms.
- At other refresh rates: p95 is at most one refresh interval and no scrolling frame exceeds two intervals.
- No event delegates are created outside the Day/Week day range, minute range, or enabled calendar set.

Attach the redacted trace and the recorded environment to the release candidate. A failure is a release blocker; do not relax these limits without repeatable evidence on the same hardware class.
