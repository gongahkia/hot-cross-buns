[![](https://img.shields.io/badge/hot_cross_buns_1.0.0-passing-green)](https://github.com/gongahkia/hot-cross-buns/releases/tag/1.0.0) 
![](https://github.com/gongahkia/hot-cross-buns/actions/workflows/verify.yml/badge.svg)

# `Hot Cross Buns` 🍞

A keyboard-first [Desktop Planner](#architecture) for [Google Calendar](https://calendar.google.com/calendar/) and [Tasks](https://tasks.google.com/tasks/).

## Stack

* Frontend: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Electron](https://www.electronjs.org/), [Tailwind CSS](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), [TanStack Query](https://tanstack.com/query), [Zustand](https://zustand.docs.pmnd.rs/), [Zod](https://zod.dev/), [Lucide](https://lucide.dev/), [Motion](https://motion.dev/)
* Backend: [Node.js](https://nodejs.org/en), [SQLite](https://www.sqlite.org/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
* Tests: [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/), [Testing Library](https://testing-library.com/)
* Package: [Corepack](https://www.npmjs.com/package/corepack), [pnpm](https://pnpm.io/), [Electron Vite](https://electron-vite.org/), [Vite](https://vite.dev/), [electron-builder](https://www.electron.build/)
* API: [Google Calendar API](https://developers.google.com/calendar/api), [Google Tasks API](https://developers.google.com/tasks)

## Features

* In-app browser view
* Split-pane workspaces
* 50 curated colorschemes 
* Keyboard-first navigation
* Comprehensive undo/redo tree
* Local notes, tags, full-text search
* Multi-account Google support out-of-the-box
* Command Palette for quick commands and indexed search
* Syncs across Google Tasks *(task lists & subtasks)*
* Syncs across Google Calendar *(agenda, day, week & monthly views)*

## GIF

<video src="assets/reference/hot-cross-buns-demo.mp4" controls muted playsinline preload="metadata"></video>

## Architecture

![](assets/reference/hot-cross-buns-architecture.png)

## Usage

The below instructions are for building `Hot Cross Buns` locally from source.

1. First execute the below commands to clone `Hot Cross Buns`.

```console
$ git clone https://github.com/gongahkia/hot-cross-buns && cd hot-cross-buns
```

2. Then run the below to run `Hot Cross Buns` on your machine.

```console
$ corepack enable
$ corepack pnpm install
$ corepack pnpm dev
```

3. Optionally run the below to run `Hot Cross Buns`' comprehensive [test suite](./tests).

```console
$ corepack pnpm test:unit
$ corepack pnpm test:db
$ corepack pnpm test:security
```

4. Open [Google Cloud Console](https://console.cloud.google.com/) and do the following.
    1. Create or select a Google Cloud project, then enable the [Google Calendar API](https://console.cloud.google.com/marketplace/product/google/calendar-json.googleapis.com) and [Google Tasks API](https://console.cloud.google.com/marketplace/product/google/tasks.googleapis.com).
    2. Under **Google Auth platform**, configure the OAuth consent screen as **External**, supply the required app details, and add your Google account as a test user while the app is in testing.
    3. Under **Clients**, create an OAuth client with application type **Desktop app**. 
    4. Copy the desktop client ID. The client secret is optional. 
5. Finally, within `Hot Cross Buns`, open **Settings → Profile**, save the desktop OAuth client ID (and optional client secret), then complete browser consent.

## Support

| Operating system | Support |
| --- | --- |
| macOS | ✅ Supported |
| Linux | ✅ Supported |
| Windows (WSL2) | 🧪 Experimental |

## Other docs

* [Product requirements](docs/product/prd.md)
* [Google sync specification](docs/specs/google-sync.md)
* [Local data specification](docs/specs/local-data.md)
* [Native parity](docs/specs/native-parity.md)
* [Google Workspace integrations](docs/google-workspace-integrations.md)
* [Privacy and threat model](docs/security/privacy-and-threat-model.md)
* [QA plan](docs/testing/qa-plan.md)
