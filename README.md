# Hito

Hito is a dated, plain-text daily journal. The human-readable `TODO.txt` format is its portable source of truth for items, completion, details, time blocks, and recurrence. The browser keeps a local working copy; use **Download TODO.txt** or **Save connected TODO.txt** to write the file. Direct file opening and saving depends on browser support.

Use the document icon in the toolbar to switch between the journal and an editable view of the complete `TODO.txt`. Valid raw edits update the browser journal after a short pause or when you leave the editor; format errors are shown with line numbers and the draft remains available for correction. Changes can be undone in the journal. Download or save the file afterward to write those changes outside the browser. The raw editor font can be changed in Hito settings.

See [TODO_FORMAT.md](TODO_FORMAT.md) for the complete syntax and behavior. An agent working on Hito should read that document before changing the parser, serializer, recurrence, or item editor.
