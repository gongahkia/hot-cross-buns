# Jing

Jing is a frontend-only daily journal modeled on [Jeff Huang's never-ending text file](https://jeffhuang.com/productivity_text_file/). Work in the browser, then import, download, or save a complete `TODO.txt` file. There is no server.

## Run locally

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Jing saves edits in IndexedDB for that browser and origin. Appearance settings use localStorage. Download `TODO.txt` regularly if you want a portable copy; clearing site data clears the browser copy.

## TODO.txt format

The file is UTF-8 plain text. Each section starts with a valid `YYYY-MM-DD` date. A top-level line is a daily item; lines beginning `- ` are details for the preceding item. Inline `#tags` stay in the text. The first empty line within a date separates completed items above from upcoming items below. Jing exports dates in chronological order and always writes that divider. It accepts LF, CRLF, and CR line endings. If an imported date has no divider, past dates are read as completed and today or future dates as upcoming. Invalid dates and orphan details must be corrected during import.

An item or detail that begins with `\\`, `- `, or is exactly a date heading is escaped with an initial backslash on export. Jing removes that escape on import. This keeps the portable file unambiguous while leaving ordinary lines in Huang's simple format.

The article is a workflow description rather than a formal grammar. Jing's [parser and serializer](src/todoText.ts) implement the conventions above. Content round-trips, though spacing and line endings are normalized on export. The article's sample date `2021-11-31` is invalid and would be flagged for correction.

## Working with files

- **Import** reads any local text file. If local and file edits conflict, Jing shows two panes and lets you decide per item. A first import into an existing journal reviews every difference.
- **Download** exports the full journal as `TODO.txt`.
- **Open file** and **Save** are available in browsers with direct file access. Save is explicit. If another editor changed the file, Jing merges clear edits and reviews conflicts before writing.

Unfinished work remains on its original date and is visibly marked. You can move an item to another date yourself. Search and inline tags work across the whole journal.

## Build and test

```sh
npm run build
npm run test:e2e
```

Vite writes the static app to `dist/` for any static host.
