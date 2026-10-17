# Shio Pan

Shio Pan is a calm, plain-text journal for dated and undated items. The human-readable `TODO.txt` format is its portable source of truth for items, completion, details, spans, time blocks, and recurrence. The browser keeps a working copy in IndexedDB. Use **Import TODO.txt** to bring in a file and **Download TODO.txt** to write a portable snapshot. Import reviews format problems and conflicting changes before applying them.

The **Scratchpad** is a local plain-text capture area. Select text and move it to a date or an undated list; Settings control whether selected lines become a title with details, separate items, or one joined title, and whether to remove or keep source text. Scratchpad text is intentionally excluded from TODO.txt. Use the window button to open the scratchpad, a selected date range, or selected undated lists in browser popouts. Popouts share the journal; one window at a time edits the scratchpad.

See [TODO_FORMAT.md](TODO_FORMAT.md) for the syntax and recurrence behavior, and [TODO_DOCTOR.md](TODO_DOCTOR.md) for the import doctor’s repair and review rules.

For a one-time, read-only pull of Google Calendar and Google Tasks into local JSON and a separate offline conversion to Shio Pan `TODO.txt`, see [GOOGLE_SNAPSHOT.md](GOOGLE_SNAPSHOT.md).

An agent working on Shio Pan should read the format document before changing parsing, serialization, recurrence, imports, exports, or item editing.
