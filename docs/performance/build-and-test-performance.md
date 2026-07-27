# Build And Test Performance

Use CMake presets, not retired JavaScript tooling:

```sh
cmake --preset macos-debug
cmake --build --preset macos-debug --target hcb_native --parallel 3
ctest --preset macos-debug --output-on-failure
```

Run a focused target first. Examples: `hcb_qml_tests`, `hcb_calendar_mutation_service_tests`, `hcb_reminder_service_tests`, and `hcb_native_qml_shell_smoke`.

Changes to SQLite, search, sync, model ranges, or timeline delegates also require the native wrapper-scale benchmark. Release packaging uses the `macos-universal-package` preset and CPack; Linux and Windows package targets are deferred and are not release validation.
