# Local macOS package verification

Run `corepack pnpm test:packaged` on macOS. This builds an unsigned local
application under `dist/preview/mac`, copies it to a temporary installation path
containing spaces, and launches it with a disposable profile. It never replaces
an installed application or opens an existing user database. Artifacts are not
published. `corepack pnpm pack:mac:dir` builds the artifact without running tests.

The package includes the compiled main process, preload, renderer, worker and
production dependencies. Native SQLite binaries are unpacked from ASAR, and
electron-builder rebuilds them for the bundled Electron ABI. The icon preparation
script places the existing 64-pixel logo in an ICNS container without inventing
higher-resolution artwork.

The smoke script exercises actual packaged IPC and SQLite, local task/event writes,
backup integrity, native menu delivery, a deep link, the calendar tray image and
global shortcut registration. It restarts the same profile and simulates a schema
8 checkpoint before checking migration to schema 9. It verifies retained local
Markdown and pending writes, removal of the obsolete Calendar checkpoint and
preservation of the Tasks checkpoint.

This is a local runtime and migration check. It does not certify Developer ID
signing, notarization, Gatekeeper acceptance on a clean machine, another CPU
architecture, OS login startup, notification permissions, or live Google delivery.
Those need the corresponding release environment or an authorized disposable
Google account. No Google credentials or remote writes are used by this check.

Verified on 2026-10-21 with macOS 15 / Intel x64, Electron 33.4.11 and schema 9.
All packaged assertions passed. The check exposed and fixed a no-op preload
subscription that discarded native actions and missing default tray artwork.
