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
