# Contributing

Hot Cross Buns is a macOS-first C++20/Qt 6/QML/SQLite application. Google Calendar and Google Tasks are the synced sources of truth; the local database is a cache and durable mutation journal.

## Requirements

- macOS 14+
- CMake, Ninja, Qt 6, and Xcode command-line tools
- a Google Desktop OAuth client only for live-account validation

## Build and test

```sh
cmake --preset macos-debug
cmake --build --preset macos-debug --target hcb_native --parallel 3
ctest --preset macos-debug --output-on-failure
./script/build_and_run.sh --verify
```

Use focused test targets while changing a subsystem. Run the complete debug suite before handing off a feature. The release-scale gate is:

```sh
.github/scripts/check-native-wrapper-performance.sh <artifact-directory>
```

## Change boundaries

- QML owns presentation and calls `AppController`; it must not access SQLite, tokens, or network clients.
- C++ services validate inputs, perform queued SQLite work, and create durable optimistic mutations.
- Google clients own protocol mapping, retries, cancellation, batching, and redaction.
- Keep all-day values date-stable and timed values timezone-aware.
- Preserve arbitrary Google Calendar recurrence lines; use Google-resolved instances rather than a local RFC expansion engine.
- Do not add a global quick-capture feature.

## Validation

Use mock and local-fixture tests for automation. Do not use a personal Google account in automated tests. Live validation is a separate redacted procedure in [live Google smoke](testing/live-google-smoke.md). macOS and Fedora 43 KDE/Wayland are release targets; Windows is deferred.
