# Fedora 43 KDE Wayland acceptance

Run this against the signed x86_64 RPM on Fedora 43 KDE Plasma under Wayland.
Record only redacted evidence.

## Install and desktop integration

- Verify `rpm --checksig` succeeds before installation.
- Install, launch from the application launcher and terminal, then verify the icon and taskbar window grouping.
- Open `hotcrossbuns://settings` through the desktop URL handler and confirm it opens Settings in HCB.
- Quit the GUI, confirm `hcb-reminderd.service` remains running in the user session, then relaunch.
- Upgrade the RPM and uninstall it; confirm user data is retained and document the manual data-removal path.

## KDE services

- Verify KDE Wallet's Secret Service bridge is available, unlock it, connect Google, quit, relaunch, and confirm cached data and token refresh work.
- Repeat with the wallet locked and unavailable; confirm the app reports a clear credential failure and never writes plaintext credentials.
- Verify the tray menu opens the main window, quick capture, Settings, and Quit. If the tray is unavailable, confirm the main window remains usable and reports that state.
- Create a Calendar popup reminder, quit the GUI, verify the KDE notification arrives, then verify **Snooze 10 minutes** and **Dismiss** update reminder state correctly.

## Account acceptance

- Run the macOS live Google acceptance flow's shared Tasks, Calendar, recurrence, offline queue, conflict, search, and data-redaction checks on a disposable account.
- Verify OAuth opens the default browser and its localhost callback returns to the installed app.
