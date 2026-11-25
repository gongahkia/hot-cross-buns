# Local Markdown memory files

Each Memory section has a local Markdown file under:

`<state directory>/hot-cross-buns/memory/categories/`

On a default macOS installation the state directory is `~/.local/state`. An explicit `HOT_CROSS_BUNS_STATE_DIR` changes that location. Memory → the desired section → **Local Markdown file** shows the actual absolute path. The agent's `memory_status` tool also returns the directory, without dumping every category's contents into its context.

| Memory section | File |
| --- | --- |
| Preferences | `preferences.md` |
| About you | `about-you.md` |
| Personal context | `personal-context.md` |
| Saved notes | `saved-notes.md` |
| Project context | `projects.md` |
| Guidance | `guidance.md` |
| Suggestions | `suggestions.md` |
| Routines | `routines.md` |

These are synchronized, editable views over the existing owning stores. Structured records remain responsible for identity, evidence, revisions, goal scope, recall policy, withdrawal and activation. This preserves existing records and source-invalidation behavior rather than making arbitrary Markdown text into executable instructions.

## Editing

1. Locate the category's file in Memory, or ask HCB to locate its Markdown memory files.
2. Edit an **editable** entry's text between its `hcb-text` markers. Keep its heading, ID and markers intact. HCB can perform that edit through its existing live filesystem tools when you explicitly request it and grant the required folder access.
3. Refresh Memory, or send the next request. The host imports the change before assembling conversational or Work recall. Changes use the same revision-checked correction APIs as Memory's editor.

Example:

```markdown
## preference · tone

Scope: Across chats · Status: Active · editable

<!-- hcb-text:mem-EXISTING_ID -->
I prefer casual replies.
<!-- /hcb-text:mem-EXISTING_ID -->
```

Only the text inside the markers is editable. The marker in an actual file contains that record's actual ID; do not copy this example as a new record. Add and forget through Memory, an explicit conversational request, or the existing CLI. Removing a block is not interpreted as forgetting. Changing a heading or status text does not change a record's identity, category, scope or permissions.

Existing editable personal memories and notes support direct correction. Goal-scoped records, derived notes whose sources need review, inferred guidance, suggestions and routines are exported for inspection but use their owning reviewed controls for changes. A file edit cannot approve a candidate, alter its original quote, enable a routine or grant tools. Project context includes registered cross-chat project facts (`profile.projects` and documented aliases), as well as goal-scoped records; listing your projects does not require inventing a formal goal.

Corrections preserve the record ID and mark chat provenance as user-corrected. Existing temporal/applicability metadata may require review after a correction. Derived summaries/routines are checked against source revisions, so corrected evidence makes old derived content unavailable until rebuilt or reviewed through the existing mechanisms.

## Synchronization and conflicts

Files are created on Memory inspection or request preparation. Successful main-agent memory mutations also publish the updated views. Direct CLI/store changes are reflected at the next synchronization; the Markdown files are not a file-system watcher or a second autonomous agent. The files are stored privately, with bounded reads, symlink rejection, atomic publication and an interrupted-export journal.

Hidden adjacent indexes record which entry/revision was exported. They are managed metadata, not additional memory categories. Do not edit them.

If both HCB and a file editor changed the same entry, synchronization reports a conflict instead of overwriting either version. Memory shows the warning and its saved record. Request preparation reports the problem rather than silently using stale category edits. Preserve your edited text, restore that entry's last exported text/markers in the file, refresh to obtain the current saved version, then apply the desired correction against that version. Do not delete indexes to bypass a conflict.

The import is revision-checked per entry, rather than a cross-store transaction. If a later entry fails, earlier valid corrections may already be saved; retry recognizes those exact applied texts. Finish editing before refreshing; a concurrently changed file is preserved when detected.

The files contain private retained knowledge. Existing copies/backups and the original chat are not erased by changing a memory. Category exports and their managed indexes are refreshed when a memory is forgotten through the application.

## Paused memory saves

A tool row may be running while its approval is pending. **Review action** contains the exact statement, requested scope, reason and effect. The browser now also shows the memory review reason beside the paused action. This is operational status, not private model reasoning.

The reported project-save delay came from the conservative first-person filter missing `im working ...`. Casual project constructions are now recognized while whole-message checks for temporary requests, third-party quotations, sensitive content, secrets and negative retention intent remain in place. An already pending task keeps its original review until the user approves or declines it; a new binary does not retroactively approve an old request.
