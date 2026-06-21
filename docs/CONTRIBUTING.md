# Contributing

Hot Cross Buns is a macOS-first Electron, React, TypeScript, and SQLite rebuild. Keep renderer code unprivileged and route filesystem, SQLite, Google, native shell, MCP, and package behavior through main-process services and typed preload IPC.

## Local Setup

Required tools:

- Node.js 20 or newer
- Corepack-enabled `pnpm` from `package.json` (`pnpm@9.15.4`)
- macOS for Electron smoke and preview packaging

Recommended setup:

```sh
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
```

## Daily Commands

```sh
pnpm dev
pnpm typecheck
pnpm test
pnpm test:smoke
pnpm test:perf
```

`pnpm test` runs the default Vitest suite. `pnpm test:smoke` builds the app and launches the Playwright Electron smoke test. `pnpm test:perf` writes local report-only performance evidence under `artifacts/perf/`; do not commit generated performance artifacts unless a release checklist explicitly asks for a baseline.

## Release Commands

Use the unsigned macOS preview packaging flow only for internal/technical preview builds:

```sh
pnpm pack:mac:preview
```

For the full local preview gate:

```sh
pnpm release:mac:preview
```

These commands do not sign, notarize, or enable auto-update. Release artifacts are written under `release/`, and checksums are written to `release/SHASUMS256.txt`.

## CI Expectations

GitHub Actions runs:

- install with the pinned package manager
- `pnpm typecheck`
- `pnpm test`
- macOS Electron smoke
- scheduled/manual performance smoke
- manual Linux AppImage preview validation
- manual Windows NSIS preview validation

Failed smoke and performance runs upload available Playwright and performance artifacts for diagnosis.

## Pull Request Notes

Include:

- user-visible behavior
- architecture or IPC changes
- tests run
- docs updated
- known limitations
- manual macOS checks if native shell or package behavior changed

Do not add credentials, signing certificates, OAuth secrets, notarization material, MCP bearer tokens, or generated local databases to the repository.
