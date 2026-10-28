[![](https://img.shields.io/badge/hot_cross_buns_1.0.0-passing-green)](https://github.com/gongahkia/hot-cross-buns/releases/tag/1.0.0) 
![](https://github.com/gongahkia/hot-cross-buns/actions/workflows/verify.yml/badge.svg)

# `Hot Cross Buns` 🍞

A keyboard-first [Browser Planner](#architecture) for local tasks, calendars and notes, with optional [Google Calendar](https://calendar.google.com/calendar/) and [Tasks](https://tasks.google.com/tasks/) sync.

## Stack

* Frontend: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), [TanStack Query](https://tanstack.com/query), [Zustand](https://zustand.docs.pmnd.rs/), [Zod](https://zod.dev/), [Lucide](https://lucide.dev/), [Motion](https://motion.dev/)
* Storage: [SQLite WASM](https://sqlite.org/wasm/doc/trunk/index.md), [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
* Tests: [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/), [Testing Library](https://testing-library.com/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) *(development only)*
* Package: [Corepack](https://www.npmjs.com/package/corepack), [pnpm](https://pnpm.io/), [Vite](https://vite.dev/)
* API: [Google Calendar API](https://developers.google.com/calendar/api), [Google Tasks API](https://developers.google.com/tasks), [Google Drive API](https://developers.google.com/workspace/drive/api), [Gmail API](https://developers.google.com/workspace/gmail/api)

## Features

* Keyboard-first navigation
* Command Palette for quick commands and full-text search
* Tasks and task lists *(subtasks, tags & scheduled blocks)*
* Local notes and note lists *(autosave & internal references)*
* Calendar recurrence and occurrence edits *(day, week & monthly views)*
* History and undo/redo
* Paginated and virtualized collections
* Optional multi-account Google sync *(Tasks, Calendar, Drive links/uploads & Gmail capture)*
* Local setup without an account, workspace backups and offline reloads

## GIF

<div align="center">
  <video width="85%" src="https://github.com/user-attachments/assets/5ecca4da-dd8a-47f9-a648-306b5d39ee7b" controls muted playsinline preload="metadata"></video>
</div>

## Architecture

React → `window.hcb` → Web Worker → shared SQL domain store → SQLite WASM → IndexedDB.

IndexedDB saves the complete workspace, including settings, undo history and pending Google changes. Saves are acknowledged after the storage transaction completes; Web Locks and revision checks coordinate tabs. No application backend or database server is required. See the [migration checkpoint](docs/web-migration.md) for implementation and validation details.

## Usage

Requires Node 22+ and pnpm 9.15.4 for development:

```sh
corepack pnpm install
corepack pnpm dev
```

Open the localhost URL printed by Vite. Finish setup using the local resources; no Google credentials are required.

```sh
corepack pnpm build
corepack pnpm preview
```

Deploy the generated `dist/` directory to a static HTTPS host. Keep the same origin to retain the same browser workspace. The app requires a current browser with WebAssembly, IndexedDB, Web Workers and Web Locks (HTTPS or localhost). The build bundles the SQLite WASM asset; no application server or database server is needed.

Data belongs to the browser profile and origin. Clearing site data removes it; private browsing storage can disappear when the session ends. Export and import full workspace backups from Settings → Data; IndexedDB is not an independent backup. Optional Google uses a Web OAuth client and memory-only tokens. Notifications and sync run while the application is open and may be delayed by browser suspension. Desktop tray and OS updater controls are outside the web runtime.

## Validation

```sh
corepack pnpm test:unit
corepack pnpm test:db
corepack pnpm exec playwright install chromium
corepack pnpm test:ui
corepack pnpm build && corepack pnpm test:production && corepack pnpm test:offline
corepack pnpm measure:storage
```

Browser tests build a static test bundle and run real Chromium with isolated profiles. The test-only failure/fixture hooks are excluded from the production build. `test:db` executes all SQLite domain tests under Node without Electron ABI skips. For a complete gate, run `corepack pnpm test:validate`.

See [Vercel/static deployment instructions](docs/deployment.md), [Google Web OAuth setup](docs/google-browser-setup.md), [backup and recovery instructions](docs/workspace-backups.md), and [measured performance](docs/performance/browser-workspace.md). Preview and production origins have separate workspaces; transfer data through export/import.

## Other docs

* [Product requirements](docs/product/prd.md)
* [Google sync specification](docs/specs/google-sync.md)
* [Local data specification](docs/specs/local-data.md)
* [Native parity](docs/specs/native-parity.md)
* [Google Workspace integrations](docs/google-workspace-integrations.md)
* [Privacy and threat model](docs/security/privacy-and-threat-model.md)
* [QA plan](docs/testing/qa-plan.md)
