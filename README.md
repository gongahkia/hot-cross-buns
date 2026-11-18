# `Hot Cross Buns` 🍞

A [Markdown browser journal](https://hot-cross-buns.vercel.app) for dated and undated items, with a portable [Planner.md format](./docs/MARKDOWN_FORMAT.md).

## Stack

* Frontend: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [styled-components](https://styled-components.com/), [dnd kit](https://dndkit.com/), [React DayPicker](https://daypicker.dev/), [Lucide](https://lucide.dev/)
* Storage: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), source-preserved UTF-8 Markdown, browser preferences in localStorage
* Tests: [Node.js test runner](https://nodejs.org/api/test.html), [Playwright](https://playwright.dev/), [Python unittest](https://docs.python.org/3/library/unittest.html)
* Package: [Node.js](https://nodejs.org/), [npm](https://www.npmjs.com/), [Vite](https://vite.dev/)
* Optional imports: [Google Calendar API](https://developers.google.com/calendar/api), [Google Tasks API](https://developers.google.com/tasks), [Python](https://www.python.org/)

## Features

* Dated journal and undated lists *(details & hashtags; completion for dated items)*
* Scratchpad with selected-text capture into dated or undated items
* Time blocks and all-day or multi-day spans
* Scheduled and after-completion recurrence *(individual, following & all-item edits)*
* Drag to reorder items and details or move items between dates *(quick Today/Tomorrow choices)*
* Promote details to items and move items under a parent
* Palette search by title, detail and hashtag *(All/Open/Done for dated entries)*
* Undo/redo and completion confirmations
* Planner.md import doctor, conflict review and download preview
* Protected Planner.md saving in Nextcloud, Dropbox and Syncthing desktop folders
* Optional Google Drive file saving with your own Web OAuth client and file picker
* Durable sync submissions, automatic catch-up, conservative source merging in single-file mode and explicit concurrent-branch review in protected mode
* Immutable revision history for linked sync folders and new Drive links *(concurrent branches stay available for review)*
* Hidden history and recovery command *(preview, download or restore a saved version)*
* Hidden Markdown source editor *(validation, draft recovery & stale-edit checks)*
* Contextual provider conflict-copy import and a read-only folder verification command
* Browser popouts sharing the local journal and scratchpad
* Light/dark themes, date formats, time zone for today's date and optional public holidays *(written item times stay unchanged)*
* Smooth caret movement while typing and navigating *(respects reduced motion)*
* Command palette for search, import, download, browser windows and settings *(⌘K / Ctrl+K; ⌘F / Ctrl+F for search)*
* One-time, read-only Google Calendar and Tasks import through separate scripts

The browser keeps its working copy in IndexedDB under this browser profile and origin. **Import Planner.md** reads a file; **Download Planner.md** exports the journal. For protected file syncing, use **Settings → Syncthing → Link sync folder** and transfer both Planner.md and its `.hot-cross-buns` history through Syncthing. Alternatively, use **Settings → Google Drive**; new links keep companion revision files in My Drive. Both publish immutable snapshots before updating the Markdown projection, with concurrent branches kept for review. Existing individual Markdown file links can upgrade explicitly. One target can be linked at a time. See [revision history and its limits](./docs/REVISION_SYNC.md), [file setup](./docs/FILE_SYNC.md) and [Drive setup](./docs/GOOGLE_DRIVE.md). Single-file mode retains a remaining overwrite window; arbitrary external edits overwritten before observation cannot be recovered. Without a linked target, import and download remain manual. Scratchpad text is included in Planner.md and syncs with the journal; appearance settings stay in the browser. Linked saving runs while a tab is open and visible; local folder linking requires browser file-picker and Web Locks support.

Planner.md is authoritative; structured edits preserve unrelated Markdown source. Rich Markdown rendering, clickable internal-entry navigation and day/week/month calendar views remain planned; the current dated view is a list with day/range selection. Earlier saved TXT workspaces require an explicit archived conversion or a new empty Markdown workspace; there is no permanent TXT file-import mode. See [the Markdown runtime and recovery guide](./docs/MARKDOWN_RUNTIME.md).

Open **Commands** to type a command or search the current journal view. The palette contains tag and completion filters; selecting an entry takes you to it. Escape closes the palette and clears its filters. Journal results show up to 50 entries at a time with the total count; refine the query to narrow them.

Syncthing, Nextcloud and Dropbox each have their own settings section, setup guide and folder-link control. Keep the complete directory available offline. These use the desktop client's folder, without new provider API connections. The app confirms local saving; check the client for cloud upload and device delivery. Actual provider/device delivery remains unverified; browser fault tests simulate transfer. See [provider setup, verification and recovery](./docs/SYNC_FOLDERS.md), including the read-only `npm run sync:check` command.

Type **history**, **recovery** or **versions** in Commands to open saved versions for a protected sync target. This command stays out of the default list. Preview or download a version, review an incoming branch, or confirm a restoration that adds a new revision without removing later history. See [history and recovery](./docs/REVISION_SYNC.md#history-and-recovery).

Type **source** in Commands to edit the complete Markdown source. This command also stays out of the default list; invalid or stale drafts remain recoverable without replacing the saved journal.

## Usage

The below instructions are for building `Hot Cross Buns` locally from source. Use Node.js 22.18 or newer and npm. Python 3 is needed for the optional Google snapshot tools and their tests. [CI](./.github/workflows/ci.yml) checks Node.js 22.18 and 24 with Python 3.13.

1. First execute the below commands to clone `Hot Cross Buns`.

```console
$ git clone https://github.com/gongahkia/hot-cross-buns && cd hot-cross-buns
```

2. Then run the below to run `Hot Cross Buns` on your machine.

```console
$ npm ci
$ npm run dev
```

3. Optionally run the below to run `Hot Cross Buns`' [test suite](./tests).

```console
$ npx playwright install chromium
$ npm run verify
```

`verify` runs unit tests, Python snapshot tests, the production build, Chromium browser tests and the dependency audit. Use `test:unit`, `test:python` or `test:e2e` to run a narrower check. The browser tests use a fixed Singapore time zone and two workers.

4. Run the below to build and preview the production application.

```console
$ npm run build
$ npm run preview
```

Vite writes the static application to `dist/`. The included [Vercel configuration](./vercel.json) builds that directory with npm. The journal runs directly in the browser; Google authorization is needed only for optional Google Drive saving or the separate snapshot pull script.

## Other docs

* [Syncthing and linked Planner.md files](./docs/FILE_SYNC.md)
* [Nextcloud and Dropbox folders, verification and recovery](./docs/SYNC_FOLDERS.md)
* [Google Drive setup and saving](./docs/GOOGLE_DRIVE.md)
* [Sync behavior, recovery and architecture](./docs/SYNC.md)
* [Immutable revision protocol, migration and retention](./docs/REVISION_SYNC.md)
* [Planner.md format and planning metadata](./docs/MARKDOWN_FORMAT.md)
* [Markdown runtime, shared scratchpad and recovery](./docs/MARKDOWN_RUNTIME.md)
* [Markdown implementation plan and remaining stages](./docs/MARKDOWN_PLANNER_PLAN.md)
* [Historical TODO.txt semantics and recurrence](./docs/TODO_FORMAT.md)
* [Import validation and review rules](./docs/TODO_DOCTOR.md)
* [One-time Google snapshot and conversion](./docs/GOOGLE_SNAPSHOT.md)
