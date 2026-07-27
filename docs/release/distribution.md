# macOS Distribution

## Status

macOS is the only distribution target. The universal package configuration exists in CMake; signed, notarized public distribution requires separate Apple credentials and live packaged-app validation. Do not describe an unsigned build as production-ready.

Linux AppImage and Windows NSIS configuration are deferred source scaffolding, not supported artifacts.

## Build

```sh
cmake --preset macos-universal-package
cmake --build --preset macos-universal-package
```

The preset enables `HCB_ENABLE_MACOS_UNIVERSAL_PACKAGE` and invokes CPack's package target. Inspect the generated artifacts before publishing. Build and test a Debug macOS target first:

```sh
cmake --preset macos-debug
cmake --build --preset macos-debug --target hcb_native --parallel 3
ctest --preset macos-debug --output-on-failure
```

## Release gate

1. Clean source tree except intentional release changes.
2. Automated C++/QML/shell tests pass.
3. Native wrapper benchmark emits the required report and passes its limits.
4. Universal package builds and mounts on a clean macOS test account.
5. Redacted [live Google smoke](../testing/live-google-smoke.md) passes against a user-owned OAuth client.
6. Verify package identity, runtime dependencies, and checksum.
7. Sign and notarize only with the configured release identity; otherwise label the artifact unsigned and do not claim Gatekeeper readiness.

## Non-claims

- No automatic in-place updater is implemented.
- No Linux or Windows release/support claim is valid.
- No macOS signing/notarization claim is valid without recorded package evidence.
