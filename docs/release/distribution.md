# Distribution

## Status

macOS distribution uses the universal package configuration. Signed, notarized
public distribution requires separate Apple credentials and live packaged-app
validation. Do not describe an unsigned build as production-ready.

Fedora 43 KDE/Wayland distribution uses a direct-download x86_64 RPM built by
`packaging/fedora/hot-cross-buns.spec`. The build links system Qt and SQLite;
it does not bundle those libraries. CI artifacts are unsigned. Sign release
artifacts with the configured release GPG key, verify with `rpm --checksig`,
and publish the public key and checksum alongside the RPM. No DNF repository
or automatic updater is included.

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

## Fedora RPM

Create a source archive named `hot-cross-buns-<version>.tar.gz` with the
repository contents at its root, then run:

```sh
rpmbuild -ba packaging/fedora/hot-cross-buns.spec
```

The RPM installs the GUI executable, URL-handler desktop entry, icon, and
`hcb-reminderd` user service. The GUI starts the reminder service for the
current desktop session; it must be active for reminders to persist after the
GUI exits.

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
- No macOS signing/notarization claim is valid without recorded package evidence.
