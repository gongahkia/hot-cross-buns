# Fedora 43 KDE/Wayland port

Fedora 43 x86_64 under KDE Plasma on Wayland is HCB's supported Linux target.
It is distributed as a signed direct-download RPM, not an AppImage and not a
DNF repository.

## Runtime contract

- Build and link against Fedora's Qt 6.10+ and SQLite 3.50+ packages.
- Store OAuth credentials through the Secret Service API. On KDE this is the
  KDE Wallet Secret Service bridge; plaintext fallback is forbidden.
- Use `QDesktopServices` for browser OAuth and a loopback callback on localhost.
- Install `hotcrossbuns://` through the desktop entry and pass URL arguments to
  the GUI's existing deep-link parser.
- Use the session D-Bus notification service for Calendar popup reminders.
  `hcb-reminderd` is a systemd user service that keeps reminder scheduling and
  notification actions alive after the GUI exits.
- Expose tray availability at runtime. A missing tray never makes the main
  window unusable.

## Developer build

```sh
sudo dnf install cmake gcc-c++ ninja-build qt6-qtbase-devel \
  qt6-qtdeclarative-devel qt6-qtwayland sqlite-devel
cmake --preset fedora43-debug
cmake --build --preset fedora43-debug --parallel 3
QT_QPA_PLATFORM=offscreen ctest --preset fedora43-debug --output-on-failure
```

See [the Fedora KDE Wayland acceptance checklist](../testing/manual-fedora43-kde-wayland.md)
before releasing an RPM.
