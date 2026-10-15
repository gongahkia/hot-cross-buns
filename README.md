# Hito

Hito is a dated, plain-text daily journal. The human-readable `TODO.txt` format is its portable source of truth for items, completion, details, time blocks, and recurrence. The browser keeps a working copy in IndexedDB. Use **Import TODO.txt** to bring in a file and **Download TODO.txt** to write a portable snapshot. Import reviews format problems and conflicting changes before applying them.

See [TODO_FORMAT.md](TODO_FORMAT.md) for the syntax and recurrence behavior, and [TODO_DOCTOR.md](TODO_DOCTOR.md) for the import doctor’s repair and review rules.

For a one-time, read-only pull of Google Calendar and Google Tasks into local JSON, see [GOOGLE_SNAPSHOT.md](GOOGLE_SNAPSHOT.md). Conversion to `TODO.txt` is a separate step.

An agent working on Hito should read the format document before changing parsing, serialization, recurrence, imports, exports, or item editing.
