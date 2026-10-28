[![](https://img.shields.io/badge/hot_cross_buns_1.0.0-passing-green)](https://github.com/gongahkia/hot-cross-buns/releases/tag/1.0.0) 
![](https://github.com/gongahkia/hot-cross-buns/actions/workflows/verify.yml/badge.svg)

# `Hot Cross Buns` 🍞

A keyboard-first browser planner for tasks, calendars, and local notes. Your workspace is saved in IndexedDB in your browser profile. Google integration is deferred while the browser migration is completed; local use needs no account.

## Stack

* React, TypeScript, Vite, Tailwind CSS, Radix UI, TanStack Query, Zustand, Zod, Lucide and Motion
* Official SQLite WASM in a dedicated Web Worker, persisted atomically to IndexedDB
* Vitest, Playwright and Testing Library; native SQLite is development-only regression tooling

## Features

* Keyboard navigation, command palette, paginated and virtualized collections
* Tasks, subtasks, task lists, notes, note lists and tags
* Calendar day/week/month views, recurrence and scheduled task blocks
* Full-text search, settings, history and undo/redo
* Local onboarding with an Inbox, Primary calendar and Notes list

## GIF

<div align="center">
  <video width="85%" src="https://github.com/user-attachments/assets/5ecca4da-dd8a-47f9-a648-306b5d39ee7b" controls muted playsinline preload="metadata"></video>
</div>

## Architecture

React → `window.hcb` → dedicated Web Worker → shared SQL domain store → SQLite WASM. IndexedDB holds the complete durable database, including undo and outbox records. Mutations resolve only after the IndexedDB transaction completes. Web Locks and revision checks coordinate tabs.

See [the migration checkpoint](docs/web-migration.md) for capability parity, storage behavior, validation and follow-up work. The historical Electron sources remain for reference and regression tests; they are outside the browser runtime.

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

Data belongs to the browser profile and origin. Clearing site data removes it; private browsing storage can disappear when the session ends. Browser backup import/export and Google connectivity are follow-up work. Desktop tray, filesystem dialogs and background native notifications are not part of the web runtime.

## Validation

```sh
corepack pnpm test:unit
corepack pnpm test:db
corepack pnpm exec playwright install chromium
corepack pnpm test:ui
corepack pnpm build && corepack pnpm test:production
```

Browser tests build a static test bundle and run real Chromium with isolated profiles. The test-only failure/fixture hooks are excluded from the production build. `test:db` executes all SQLite domain tests under Node without Electron ABI skips. For a complete gate, run `corepack pnpm test:validate`.

## Other docs

* [Product requirements](docs/product/prd.md)
* [Google sync specification](docs/specs/google-sync.md)
* [Local data specification](docs/specs/local-data.md)
* [Native parity](docs/specs/native-parity.md)
* [Google Workspace integrations](docs/google-workspace-integrations.md)
* [Privacy and threat model](docs/security/privacy-and-threat-model.md)
* [QA plan](docs/testing/qa-plan.md)
