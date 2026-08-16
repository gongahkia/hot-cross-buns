# Hot Cross Buns web PWA

The `web/` directory contains a browser-only Hot Cross Buns application. It is separate from the C++/Qt desktop app; neither build system depends on the other.

## Privacy model

The web app is a static frontend. It has no Hot Cross Buns API, account system, database, analytics backend, client-secret store, or refresh-token store.

Google Tasks, Calendar, and Drive API requests go directly from the browser to Google. The browser keeps a replaceable IndexedDB cache for quick startup, local search, and pending offline edits. OAuth access tokens stay only in page memory and are never written to browser storage. Clearing site data removes the cache and saved non-secret client ID.

## Local development

Use Node.js 22 or newer:

```sh
cd web
npm ci
npm run dev
```

Run the checks with:

```sh
npm run typecheck
npm run test:run
npm run build
npm run test:e2e
```

## Google Cloud setup

Every user supplies their own Google Cloud configuration:

1. Create a project in Google Cloud.
2. Enable Google Tasks API, Google Calendar API, and Google Drive API.
3. Configure the OAuth consent screen and add test users while the project is in Testing.
4. Create an OAuth **Web application** client.
5. Add the deployed site origin, for example `https://your-project.pages.dev`, and the local development origin, for example `http://localhost:5173`, as authorized JavaScript origins.
6. Paste only the Web OAuth client ID into the app. Do not paste a client secret.

The initial connection requests Tasks and Calendar access. Drive access is requested only when the user opens the Drive attachment picker, and is limited to `drive.metadata.readonly`.

Google’s browser token model returns short-lived access tokens. When a token expires, the user clicks a visible reconnect or sync control to authorize another token; the app does not hold a refresh token. See Google’s [token model guide](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Product and UX audit

The web PWA follows a title-first, keyboard-led workflow rather than copying every control from desktop calendar software.

- **Things 3** keeps Quick Find immediate and places wider searches behind an intentional continuation. The PWA therefore opens `⌘/Ctrl+K` locally, ranks titles first, and makes notes/descriptions an explicit second step. The palette accepts explicit filters such as `type:task`, `due:today`, `completed:false`, `date:2026-08-01..2026-08-31`, and `in:"Calendar name"`. Calendar queries use a worker-held index of the full browser-local canonical mirror, so historic events are not limited to the currently displayed date range or expanded into every recurrence. Once Drive metadata access has been authorized and an attachment search has cached results, those cached file names also appear in the palette; opening one uses its Google-provided link and does not issue a Drive search. See [Things Quick Find](https://culturedcode.com/things/support/articles/2803584/?platform=ipad).
- **Notion Calendar** and **TickTick** treat keyboard access as a primary way to navigate and create work. The palette can switch surfaces, open a cached task/event, create a task/event, sync, find a time, or manage calendars. See [Notion Calendar shortcuts](https://www.notion.com/help/notion-calendar-keyboard-shortcuts) and [TickTick features](https://ticktick.com/features?language=en_US).
- **Apple Calendar** favors understandable, direct calendar controls. The PWA retains visible day/week/month/agenda controls, explicit calendar selection, and clear availability/event actions rather than burying them only in commands. See [Apple Calendar](https://support.apple.com/en-gb/guide/calendar/icl32362/mac).
- **Google Calendar** is the source of truth. A first synchronization stores a complete canonical event collection, then the app uses a saved CalendarList token and one saved token per calendar. It commits one page at a time with a browser-local resume record, exposes progress and cancellation, and continues from the saved page after the user chooses Sync again. `410 Gone` clears only the affected local cache and rebuilds it, as required by [Google's incremental-sync guide](https://developers.google.com/workspace/calendar/api/guides/sync). In normal incremental syncs, range queries expand occurrences only for changed calendars in the visible view; canonical events are never expanded solely for search. If IndexedDB reports quota exhaustion, the app removes only the regenerable visible-range occurrence cache, preserves canonical events and resume state, retries once, and tells the user how to continue. [Event token requests cannot include `timeMin`, `timeMax`, or `orderBy`](https://developers.google.com/calendar/api/v3/reference/events/list).
- **Google Tasks** has no equivalent sync-token endpoint. The PWA fully enumerates task lists and fetches per-list changes with `updatedMin`, `showHidden`, and `showDeleted`, using a small overlap before each saved watermark. Settings and the command palette also offer **Refresh all Tasks from Google**, which rebuilds the local task mirror and writes fresh timestamp watermarks. This is timestamp-based incrementality, not token synchronization. See the [Google Tasks list reference](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list).
- **Dialog accessibility** uses one modal primitive for task and calendar editors, conflict resolution, calendar management, and availability. It sets initial focus, traps Tab and Shift+Tab, returns focus to the opener, supports Escape, and makes the background inert while a dialog is active. The command palette already provides equivalent keyboard behavior.

Calendar sharing and access-control-list management are deliberately deferred. They require a separate permission-focused design review rather than being added beside the existing calendar-management dialog.

## Cloudflare Pages deployment

Create a Cloudflare Pages project with `web` as the repository root, `npm run build` as the build command, and `dist` as the output directory. The generated site is fully static, so no Worker, D1 database, KV namespace, cache service, or Cloudflare secret is needed.

After the first production deployment, use that exact HTTPS origin in each user’s Google Cloud OAuth client configuration.
