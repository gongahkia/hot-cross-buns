[![](https://img.shields.io/badge/hot_cross_buns_1.0.0-passing-green)](https://github.com/gongahkia/hot-cross-buns/releases/tag/1.0.0) 
![](https://github.com/gongahkia/hot-cross-buns/actions/workflows/verify.yml/badge.svg)

# `Hot Cross Buns` 🍞

A keyboard-first [browser planner](#architecture) with first-class support for [Google Calendar](https://calendar.google.com/calendar/) and [Tasks](https://tasks.google.com/tasks/).

## Stack

* Frontend: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), [TanStack Query](https://tanstack.com/query), [Zustand](https://zustand.docs.pmnd.rs/), [Zod](https://zod.dev/), [Lucide](https://lucide.dev/), [Motion](https://motion.dev/)
* Storage: [SQLite WASM](https://sqlite.org/wasm/doc/trunk/index.md), [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
* Tests: [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/), [Testing Library](https://testing-library.com/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
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
* Google account required, with multi-account Tasks and Calendar sync
* Optional Drive links/uploads and Gmail capture
* Offline use after linking Google, workspace backups and offline reloads

## GIF

<div align="center">
  <video width="85%" src="https://github.com/user-attachments/assets/5ecca4da-dd8a-47f9-a648-306b5d39ee7b" controls muted playsinline preload="metadata"></video>
</div>

## Architecture

...

## Usage

The below instructions are for building `Hot Cross Buns` locally from source.

1. First execute the below commands to clone `Hot Cross Buns`.

```console
$ git clone https://github.com/gongahkia/hot-cross-buns && cd hot-cross-buns
```

2. Then run the below to run `Hot Cross Buns` on your machine.

```console
$ corepack enable
$ corepack pnpm install --frozen-lockfile
$ corepack pnpm dev
```

3. Optionally run the below to run `Hot Cross Buns`' comprehensive [test suite](./tests).

```console
$ corepack pnpm test:unit
$ corepack pnpm test:db
$ corepack pnpm exec playwright install chromium
$ corepack pnpm test:ui
$ corepack pnpm build && corepack pnpm test:production && corepack pnpm test:offline
$ corepack pnpm measure:storage
```

4. Run the below to build and preview the production application.

```console
$ corepack pnpm build
$ corepack pnpm preview
```

## Other docs

* [Browser migration checkpoint](docs/web-migration.md)
* [Vercel and static deployment](docs/deployment.md)
* [Google Web OAuth setup](docs/google-browser-setup.md)
* [Workspace backups and recovery](docs/workspace-backups.md)
* [Measured browser performance](docs/performance/browser-workspace.md)
* [Product requirements](docs/product/prd.md)
* [Google sync specification](docs/specs/google-sync.md)
* [How Things Cloud syncs and what HCB can adopt](docs/things-sync-research.md)
* [Google/local sync implementation progress](docs/sync-implementation.md)
* [Local data specification](docs/specs/local-data.md)
* [Native parity](docs/specs/native-parity.md)
* [Google Workspace integrations](docs/google-workspace-integrations.md)
* [Privacy and threat model](docs/security/privacy-and-threat-model.md)
* [QA plan](docs/testing/qa-plan.md)
