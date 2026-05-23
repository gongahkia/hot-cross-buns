# General Parity And Release Polish Improvements

## Comparison Basis

Legacy reference repo:

- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/README.md`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/.github/workflows/ci.yml`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/docs`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/reference`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/scripts`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/asset`

Current Electron rebuild:

- `README.md`
- `docs`
- `electron-builder.yml`
- `scripts`
- `assets/brand`

Hot Cross Buns 2 has stronger architecture/spec documentation than the legacy repo in some areas, plus Electron packaging scripts. The missing general parity items are mostly public-facing project polish, CI, docsite/installer flow, release evidence, contribution guidance, and packaging hardening.

## Improvements To Add

### 1. GitHub Actions CI

Legacy has a tracked CI workflow. Hot Cross Buns 2 currently lacks an equivalent tracked workflow.

Add `.github/workflows/ci.yml` for:

- dependency install with `pnpm`
- typecheck
- unit tests
- smoke tests where the runner supports Electron
- artifact upload for test reports and performance output
- concurrency cancellation for repeated pushes

Acceptance checks:

- Workflow passes on pull requests.
- CI uses the pinned package manager from `package.json`.
- Electron smoke failures upload Playwright traces/screenshots.

Status on 2026-05-23:

- Added `.github/workflows/ci.yml` with pinned `pnpm@9.15.4`, install, `pnpm typecheck`, `pnpm test`, macOS Electron smoke, and scheduled/manual performance smoke.
- Failed or cancelled smoke/performance runs upload Playwright and performance artifacts for diagnosis.

### 2. Public Docsite And Install Flow

Legacy has a GitHub Pages style docsite, privacy page, media assets, install script, and first-launch unsigned-DMG guidance.

Add a lightweight public docs surface for Hot Cross Buns 2:

- product overview and screenshots/video
- latest release download link
- privacy page
- install script that verifies SHA-256 checksums
- "Open Anyway" unsigned preview guidance until signing/notarization is ready
- MCP and local data/security summaries

Acceptance checks:

- Docs build from tracked files.
- Install script verifies checksum before mounting/copying a DMG.
- Privacy page states no third-party analytics SDK and describes local cache/token handling.

Status on 2026-05-23:

- Added `scripts/install-mac-preview.sh`, which verifies SHA-256 before copying an unsigned `.dmg` or `.zip` preview app bundle.
- Added `docs/support/mac-preview-support.md` with unsigned preview install, Gatekeeper, privacy, diagnostics, and rollback guidance.
- Public docsite generation remains deferred; current support material is tracked Markdown.

### 3. Release Metadata And Distribution Hardening

Legacy publishes versioned DMGs, stable latest aliases, SHA-256 files, release references, and updater-friendly latest-release assets.

Extend current Electron release flow:

- produce stable and versioned macOS artifacts
- generate SHA-256 checksums for every release artifact
- validate bundle metadata, icons, hardened runtime intent, and entitlement expectations
- document unsigned preview limitations
- add updater metadata once update checks are implemented
- keep a release-candidate checklist tied to actual commands

Acceptance checks:

- `pnpm release:mac:preview` produces reviewed artifacts and checksums.
- Release docs state which assets must be uploaded.
- Updater checks can find the stable latest release artifact when implemented.

Implemented follow-up:

- `pnpm release:mac:preview` now creates stable `Hot-Cross-Buns-2-macOS*` aliases and per-artifact `.sha256` files before writing `SHASUMS256.txt`.
- `pnpm release:smoke-dmg` mounts the generated DMG read-only and verifies the contained app bundle metadata.

### 4. Contribution And Agent Workflow Polish

Legacy has `docs/CONTRIBUTING.md`, architecture references, release references, style guides, urgent todo references, and profiling docs.

Add or extend Hot Cross Buns 2 docs for:

- contributor setup and local commands
- branch/test/release expectations
- style guide for product copy and UI behavior
- troubleshooting common Electron/macOS packaging issues
- profiling workflow for renderer, main, SQLite, and native lifecycle changes

Acceptance checks:

- New contributors can run dev, unit tests, smoke tests, and package preview from docs alone.
- Agent workflow points to the improvement docs when doing legacy parity work.
- Performance docs explain where generated evidence is stored.

Status on 2026-05-23:

- Added `docs/CONTRIBUTING.md` with setup, daily commands, release commands, CI expectations, and PR note expectations.
- Updated `README.md`, `docs/README.md`, `docs/performance/build-and-test-performance.md`, and `docs/testing/qa-plan.md` with current command and artifact guidance.

### 5. Asset And Localization Parity

Legacy includes app icons, menu-bar template assets, onboarding imagery, localized strings, and public website media.

Finish asset hygiene for Hot Cross Buns 2:

- verify app icon and menu-bar template assets in packaged app
- keep brand assets under `assets/brand`
- add missing onboarding/public docs media as tracked assets
- add a localization-ready string organization for renderer-visible copy
- document which assets were copied from the legacy repo

Acceptance checks:

- Packaged app shows correct dock, app, and menu-bar icons.
- Renderer does not hard-code large sets of user-facing strings without a path to localization.
- Public docs media is optimized and referenced from tracked docs.

### 6. Manual QA And Support Readiness

Legacy has dedicated docs for energy profiling, transition profiling, MCP usage, portable export, privacy, and install guidance.

Add release support material for:

- manual macOS package install and first launch
- tray/hotkey/notification/protocol-link verification
- Google OAuth runtime-client setup
- MCP local server setup
- diagnostics bundle collection
- known unsigned preview limitations
- rollback/reinstall instructions

Acceptance checks:

- Release candidate checklist links to every manual QA doc.
- Support docs avoid exposing maintainer OAuth credentials.
- User-facing docs match current app behavior rather than future roadmap promises.

Status on 2026-05-23:

- Added Mac preview support guidance that explicitly avoids Gatekeeper-disable advice and avoids sharing OAuth credentials, MCP tokens, local databases, raw Google payloads, or signing material.
- Updated release distribution docs with current macOS package metadata, icon/resource paths, unsigned preview checksum helper, and support-doc links.

## Recommended Starting Point

Start with GitHub Actions CI and release metadata. Those are low product risk, immediately useful, and will catch regressions before larger backend, database, and feature parity work begins.
