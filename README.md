# Hot Cross Buns

Native C++20/Qt 6.11.1 desktop planner.

## Build and test

On macOS with Homebrew Qt, CMake, Ninja, and LLVM installed:

```sh
make build
make test
make format
```

Available presets cover macOS debug, sanitizers, static analysis, formatting, bootstrap, universal DMG packaging, Linux x64 AppImage packaging, and Windows x64 NSIS packaging.

Native release tags (`v*`) run macOS, Linux, and Windows build, test, installation-tree, and QML launch acceptance checks.

## Private Google preview

Each tester supplies a Google Cloud **Desktop app** OAuth client ID in Settings. Enable Google Tasks and Google Calendar APIs, add the tester to the OAuth consent screen, save the client ID, then select **Connect Google**. The app uses a temporary localhost loopback callback and does not accept a client secret.

The preview refreshes credentials and synchronizes Google Tasks and Calendar on connect, launch, and **Sync Google now**. Local task and calendar edits use a persisted mutation queue and Google push services; Calendar keeps incremental sync tokens and Tasks use per-list update watermarks. Real-account acceptance is still required before release promotion, so use a disposable account for testing.
