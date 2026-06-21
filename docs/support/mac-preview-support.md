# Mac Preview Support

Hot Cross Buns macOS preview builds are unsigned and unnotarized. They are for internal or early technical preview use, not broad public distribution.

## Install With Checksum Verification

Download the `.dmg` or `.zip` plus `SHASUMS256.txt` from the same GitHub Release.

Manual verification:

```sh
cd ~/Downloads
shasum -a 256 -c SHASUMS256.txt
```

Optional helper:

```sh
scripts/install-mac-preview.sh ~/Downloads/Hot-Cross-Buns-0.0.0-mac-arm64.dmg ~/Downloads/SHASUMS256.txt
```

The helper verifies SHA-256 before copying the `.app` to `/Applications`. It does not sign, notarize, bypass Gatekeeper, or enable automatic updates.

## First Launch

If macOS blocks the app because it is unsigned:

1. Open Finder.
2. Go to `/Applications`.
3. Control-click or right-click `Hot Cross Buns.app`.
4. Choose `Open`.
5. Confirm `Open`.

If that option is unavailable, use `System Settings > Privacy & Security > Open Anyway` for Hot Cross Buns. Do not disable Gatekeeper.

## Current Preview Limitations

- macOS is the only preview package target.
- Preview artifacts are unsigned and unnotarized.
- Auto-update is not enabled.
- Google OAuth, Keychain-backed token storage, authenticated sync scheduling, and live MCP listener startup are implemented for macOS preview builds, but still need live account/client QA before release sign-off.
- Tray/menu bar, global shortcut, notifications, and `hotcrossbuns://` protocol behavior need packaged-app manual verification before release sign-off.

## Privacy Summary

- No third-party analytics SDK is included.
- No hosted sync backend is included in v1.
- Google Tasks and Calendar data is mirrored into local SQLite for planner use.
- Notes are task-backed and sync through Google Tasks.
- OAuth tokens, optional OAuth client secrets, and MCP bearer tokens live in macOS Keychain; they are not stored in SQLite or exposed to the renderer.
- Diagnostics are designed to redact credentials, raw Google payloads, task notes, calendar descriptions, note bodies, MCP bearer tokens, and sensitive account/resource identifiers.

## Diagnostics For Support

In the app:

1. Open `Settings`.
2. Open `Diagnostics`.
3. Use `Copy diagnostics`.
4. Share only the copied sanitized summary unless a maintainer asks for a specific additional artifact.

Useful local evidence for maintainers:

- command output and exact command run
- macOS version and machine architecture
- whether the artifact was `.dmg` or `.zip`
- `release/SHASUMS256.txt` checksum line
- screenshots of Gatekeeper or permission prompts, with personal data redacted

Do not share OAuth credentials, MCP bearer tokens, local SQLite databases, task/note bodies, raw Google API payloads, or Apple signing/notarization material.

## Reinstall And Rollback

Before replacing a preview build, quit the app and keep a copy of local app data if you need to preserve unsynced notes or pending local cache state. App support paths are visible through Settings diagnostics and the native capability report.

If a preview build cannot launch:

1. Move the app bundle to Trash.
2. Reinstall the previous preview artifact if compatible.
3. Keep the local data directory intact unless a release note explicitly says a migration is not downgrade-compatible.

Clearing the local Google cache should be done from Settings recovery controls when the app still launches. Manual deletion of app data is a last resort because it removes pending local state and diagnostic evidence.
