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

The below instructions are for building `Hot Cross Buns` locally from source. Requires [Node.js](https://nodejs.org/en) 22+ and [pnpm](https://pnpm.io/) 9.15.4.

1. First execute the below commands to clone `Hot Cross Buns`.

```console
$ git clone https://github.com/gongahkia/hot-cross-buns && cd hot-cross-buns
```

2. Then run the below to run `Hot Cross Buns` on your machine. Open the localhost URL printed by Vite and finish setup with the local Inbox, Primary calendar and Notes list. No Google account is required.

```console
$ corepack enable
$ corepack pnpm install --frozen-lockfile
$ corepack pnpm dev
```

3. Optionally run the below to run `Hot Cross Buns`' comprehensive [test suite](./tests). Browser tests use isolated Chromium profiles; database tests run under Node without Electron ABI skips.

```console
$ corepack pnpm test:unit
$ corepack pnpm test:db
$ corepack pnpm exec playwright install chromium
$ corepack pnpm test:ui
$ corepack pnpm build && corepack pnpm test:production && corepack pnpm test:offline
$ corepack pnpm measure:storage
```

4. Run the below to build and preview the production application. Use `corepack pnpm test:validate` for the complete release gate. Test-only fixture and failure hooks are excluded from production builds.

```console
$ corepack pnpm build
$ corepack pnpm preview
```

5. To deploy on [Vercel](docs/deployment.md), import the repository at its root. The checked-in [configuration](vercel.json) supplies the install command, build command and `dist/` output directory. Other static HTTPS hosts can serve the complete `dist/` directory, including its worker and WASM assets.
6. Optionally open [Google Cloud Console](https://console.cloud.google.com/) and follow the [Google setup instructions](docs/google-browser-setup.md).
    1. Enable the [Google Calendar API](https://console.cloud.google.com/marketplace/product/google/calendar-json.googleapis.com) and [Google Tasks API](https://console.cloud.google.com/marketplace/product/google/tasks.googleapis.com). Enable Drive and Gmail APIs if using those optional features.
    2. Configure the OAuth consent screen and add test users while the app is in testing.
    3. Create an OAuth client with application type **Web application** and register each exact localhost or deployment origin under **Authorized JavaScript origins**.
    4. Set `VITE_GOOGLE_CLIENT_ID` in a repository-root `.env.local` or the Vercel build environment, using [.env.example](.env.example) as a reference. Restart Vite or rebuild and redeploy after changing it. Never add client secrets or tokens.
7. Finally, if Google is configured, open **Settings → Accounts → Add Google Account** and complete browser consent. Tokens stay in memory; reconnect after reloading or when authorization expires. Local planning remains available without a connection.

## Support

| Browser | Support |
| --- | --- |
| Chromium (Linux) | ✅ Browser suites executed |
| Other current browsers | 🧪 Require release testing |

Requires WebAssembly, IndexedDB, Web Workers and Web Locks over HTTPS or localhost. Offline reloads work after the first online visit finishes downloading the application. Notifications and Google sync run while the application is open, subject to browser suspension. Historical Electron sources remain for reference and regression tests; desktop tray and OS updater controls are outside the browser runtime.

Data belongs to the browser profile and origin. Localhost, preview and production URLs have separate workspaces. Use **Settings → Data** to [export or import a workspace backup](docs/workspace-backups.md). Clearing site data removes the workspace; private browsing storage can disappear when the session ends. Keep backups even when the browser grants persistent storage.

## Other docs

* [Browser migration checkpoint](docs/web-migration.md)
* [Vercel and static deployment](docs/deployment.md)
* [Google Web OAuth setup](docs/google-browser-setup.md)
* [Workspace backups and recovery](docs/workspace-backups.md)
* [Measured browser performance](docs/performance/browser-workspace.md)
* [Product requirements](docs/product/prd.md)
* [Google sync specification](docs/specs/google-sync.md)
* [Local data specification](docs/specs/local-data.md)
* [Native parity](docs/specs/native-parity.md)
* [Google Workspace integrations](docs/google-workspace-integrations.md)
* [Privacy and threat model](docs/security/privacy-and-threat-model.md)
* [QA plan](docs/testing/qa-plan.md)
