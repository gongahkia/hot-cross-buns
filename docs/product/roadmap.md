# Roadmap

## macOS release work

1. Validate the user-owned OAuth flow with the redacted [live Google smoke procedure](../testing/live-google-smoke.md). This is release evidence, not an automated agent task.
2. Resolve any defects found in Tasks, Calendar, notes projection, recurring Calendar instances, HCB-managed Task recurrence, batch mutation, search, and offline mutation recovery.
3. Run the native test suite and wrapper-scale performance gate. Sync apply must complete and emit its report within the documented 45-second limit.
4. Complete macOS signing, notarization, packaging, and release acceptance.

## Post-macOS deferred work

- Google Calendar ACL administration is deferred; calendar create, subscribe, sharing surfaces, free/busy, Meet, attachments, status events, and RSVP are in macOS scope.
- Fedora 43 KDE/Wayland parity is a release target; expand Linux support only after its acceptance matrix is complete.
- Windows parity is deferred after Fedora/macOS release decisions are settled.

Historical Electron roadmap phases are retired and must not be used as implementation requirements.
