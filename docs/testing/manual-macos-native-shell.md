# Manual macOS Native Shell Checklist

Use this checklist for release PRs or local verification when tray, hotkey, notifications, or deep-link behavior changes.

## Preconditions

- Run a macOS build or dev session of Hot Cross Buns 2.
- Use a temporary app data directory when testing destructive settings changes.
- Keep Console open only if you need logs; do not copy task titles, event details, note bodies, tokens, or local file paths into PR notes.

## Current Release Pass - 2026-05-22

- Automated native service coverage passes for deferred tray startup, hotkey registration and conflicts, settings-driven tray/hotkey/notification/MCP status updates, sanitized native status messages, and deep-link parsing.
- Automated renderer coverage passes for refreshing native status after settings changes.
- Real macOS manual verification is still required before release for menu bar behavior, global shortcut conflicts, notification permission prompts/click-through, and `hotcrossbuns://` links in a running packaged or dev app.

## Tray / Menu Bar

- App launches to the main window before native deferred startup finishes.
- Menu bar icon appears after the renderer reports shell-visible.
- Menu bar icon uses the copied template asset from `assets/brand/menubar-template.png`.
- Left-click opens the custom compact menu bar panel when Primary click is set to Open menu bar panel.
- The custom panel is a main-process-owned Electron `BrowserWindow` with no preload, no Node integration, no renderer IPC access, and link navigation handled by the native adapter.
- Right-click opens the utility menu with Open Hot Cross Buns 2, Quick Capture, Refresh Tasks and Calendar, Settings, and Quit.
- The menu bar panel shows Today/Tomorrow agenda items and overdue tasks according to the selected panel style.
- If Show overdue badge is enabled, overdue tasks appear as a capped menu bar title badge.
- Open Hot Cross Buns 2 shows the main window without quitting the app.
- Quick Capture opens the app and focuses the quick capture UI.
- Refresh requests a manual Tasks/Calendar sync without enabling new background sync behavior.
- Settings opens the Settings section.
- Quit exits and unregisters shortcuts/timers.
- If Show tray icon is disabled, the status reports Disabled and the app remains usable from the main window.

## Global Quick Capture Hotkey

- Default shortcut registers when no system conflict exists.
- Pressing the shortcut opens the main window and quick capture within the expected user-perceived budget.
- Setting the shortcut to an invalid or already-used accelerator keeps the app running.
- A failed registration is visible in Settings as Conflict or Error with recovery guidance.
- Clearing the shortcut reports Disabled and keeps in-app quick capture available.
- Changing the shortcut unregisters the previous accelerator before registering the new one.

## Notifications

- Request Notification Permission triggers the macOS notification permission flow or reports Unsupported.
- With notifications enabled, a due active task in the local cache schedules a local notification.
- With notifications enabled, an event starting within the next 24 hours schedules a local notification using the configured lead time.
- Clicking a task notification opens the app to Tasks.
- Clicking an event notification opens the app to Calendar.
- Disabling notifications cancels scheduled notifications and reports Disabled.
- Notification text is concise and does not expose credentials, raw Google payloads, or diagnostics.

## Deep Links

- `hotcrossbuns://today` opens the app to Today.
- `hotcrossbuns://task/<id>` opens the app to Tasks.
- `hotcrossbuns://event/<id>` opens the app to Calendar.
- `hotcrossbuns://note/<id>` opens the app to Notes.
- `hotcrossbuns://search?q=invoice` opens Search with the query populated.
- Warm-start links route in the already-running app.
- Cold-start links are queued until the renderer has loaded.
- Malformed or non-`hotcrossbuns://` links are ignored without exposing raw payloads.

## Platform Caveats

- This checklist verifies macOS behavior only.
- Linux tray and global shortcut behavior require a separate desktop-environment matrix.
- Windows protocol and notification behavior require installer identity and AppUserModelID validation.
- Preview update checks currently report unsupported; seamless in-place auto-update remains deferred until signing and release metadata are ready.
- MCP live listener startup and Keychain-backed bearer-token storage are implemented; external MCP client verification remains required.
