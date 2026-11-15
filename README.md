# `Hot Cross Buns` 🍞

A [plain-text browser journal](https://hot-cross-buns.vercel.app) for dated and undated items, with a portable [TODO.txt format](./docs/TODO_FORMAT.md).

## Stack

* Frontend: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [styled-components](https://styled-components.com/), [dnd kit](https://dndkit.com/), [React DayPicker](https://daypicker.dev/), [Lucide](https://lucide.dev/)
* Storage: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), UTF-8 plain text, browser preferences in localStorage
* Tests: [Node.js test runner](https://nodejs.org/api/test.html), [Playwright](https://playwright.dev/), [Python unittest](https://docs.python.org/3/library/unittest.html)
* Package: [Node.js](https://nodejs.org/), [npm](https://www.npmjs.com/), [Vite](https://vite.dev/)
* Optional imports: [Google Calendar API](https://developers.google.com/calendar/api), [Google Tasks API](https://developers.google.com/tasks), [Python](https://www.python.org/)

## Features

* Dated journal and undated lists *(details, completion & hashtags)*
* Scratchpad with selected-text capture into dated or undated items
* Time blocks and all-day or multi-day spans
* Scheduled and after-completion recurrence *(individual, following & all-item edits)*
* Drag to reorder items and details or move items between dates *(quick Today/Tomorrow choices)*
* Promote details to items and move items under a parent
* Search across dated entries by title, detail, hashtag and completion status
* Undo/redo and completion confirmations
* TODO.txt import doctor, conflict review and download preview
* Browser popouts sharing the local journal and scratchpad
* Light/dark themes, date formats, time zones and optional public holidays
* Smooth caret movement while typing and navigating *(respects reduced motion)*
* Command palette for search, import, download, browser windows and settings *(⌘K / Ctrl+K)*
* One-time, read-only Google Calendar and Tasks import through separate scripts

The browser keeps its working copy in IndexedDB under this browser profile and origin. **Import TODO.txt** reads a file; **Download TODO.txt** exports the journal. Edits do not automatically update a file on disk or sync between devices. Scratchpad text and appearance settings are excluded from TODO.txt; move scratchpad text into journal items to include it in an export.

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

Vite writes the static application to `dist/`. The included [Vercel configuration](./vercel.json) builds that directory with npm. The journal runs directly in the browser; Google authorization is only needed when using the optional snapshot pull script.

## Other docs

* [TODO.txt format and recurrence](./docs/TODO_FORMAT.md)
* [Import doctor and repair rules](./docs/TODO_DOCTOR.md)
* [One-time Google snapshot and conversion](./docs/GOOGLE_SNAPSHOT.md)
