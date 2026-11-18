# Hot Cross Buns Markdown format, versions 1, 2 and 3

This is the runtime contract for Planner.md. [`markdownPlanner.ts`](../src/markdownPlanner.ts) parses source and validates atomic edits; [`journalDocument.ts`](../src/journalDocument.ts) connects existing operations to source-preserving transactions. Storage, shared scratchpad, sync, import/export, undo and recovery now use Markdown. See [rendering, linking and editing support](MARKDOWN_SUPPORT.md), [the implementation plan](MARKDOWN_PLANNER_PLAN.md), and [workspace conversion and rollback](MARKDOWN_RUNTIME.md). Dated includes list and day/week/month calendar presentations over the same canonical entries. New workspaces use format 3; existing format-1/2 journals require the explicit unified-writing upgrade.

One canonical UTF-8 Markdown document contains dated entries, undated lists, prose and the shared scratchpad. Browser working copies and immutable sync revisions remain companion storage, not separate authoritative content files. Credentials, appearance and local view preferences stay outside this document. There is no live Google/Outlook calendar connection; any future calendar import is a one-time copy into owned entries.

## Document structure

````markdown
---
hcb-format: 1
document-id: 901d8198-5bcb-4d97-a610-2f538b861e04
---

# Hot Cross Buns

## Dated

### 2026-11-16

Meeting notes and [a related entry](#hcb-plants).

- [ ] 09:00-09:30 Team sync #work
  - [x] Prepare agenda
  - [ ] Share update

- [x] Water plants
  ```hcb
  id: plants
  repeat: every 3 days after completion; series watering; occurrence 1
  completed: 2026-11-16
  ```
  - [x] Check soil

### 2026-11-17

## Undated

### Inbox

- Read this later
  - Context and links

## Scratchpad
Unsorted fragments, headings, code and checkboxes stay here until promoted.
````

Parsing uses CommonMark with GFM task lists, tables, autolinks, footnotes and strikethrough, plus a frontmatter extension. These are parsed as Markdown, rather than by searching arbitrary lines for task-shaped text. Frontmatter and `hcb` blocks have the restricted data grammar below; they are not executable YAML. Callout, double-dollar math and Mermaid rendering are bounded derived views described in [the support matrix](MARKDOWN_SUPPORT.md); they do not change planning interpretation or canonical source. Unfamiliar extensions remain source content.

Version 1 retains its original direct-detail semantics below. Version 2 opts into recursive outlines; it changes only the frontmatter version and descendant interpretation, not database schema 4 or revision protocol 2. New and existing version-1 workspaces are not silently upgraded on read, import or sync.

Version 3 supports unified writing: dated and undated unordered outlines may both contain plain items and tasks. Its changes are specified below; versions 1/2 retain their existing interpretation until an explicit upgrade. Database schema 4 and revision protocol 2 stay unchanged.

Structural rules:

1. Frontmatter is the first block, optionally after a UTF-8 BOM. It contains exactly `hcb-format: 1` (or `2` or `3`) and `document-id: ID`, in either order. Blank lines are allowed. Unsupported versions or fields are diagnostics and disable structured writing; retain the original source for recovery or a compatible reader.
2. Root-level, plain-text level-two headings `Dated`, `Undated` and `Scratchpad` occur once in that order. A title and ordinary Markdown can surround the first two sections. Other root level-one/two headings end the active planning section. Reserved-looking text inside code fences, blockquotes, lists or HTML comments is not structural. Formatting or escaping can make an example ordinary Markdown, but an escaped heading marker such as `\## Dated` is the clearest literal form.
3. Under `Dated`, root level-three headings containing an exact valid Gregorian `YYYY-MM-DD` open date groups. Date-like invalid headings are errors. Empty date groups are meaningful. Groups retain source order; views can sort projections without rewriting source. Duplicate dates are errors.
4. Under `Undated`, plain-text root level-three headings open named lists. Duplicate names are errors. Deeper root headings end entry collection for the active group; their contents are ordinary notes until another level-three group starts.
5. Only direct root unordered lists under an active group supply planner entries. Dated entries need GFM `[ ]`, `[x]` or `[X]`; an ordinary bullet list there is prose. Undated entries and their details use plain bullets and have no completion state. Ordered lists remain ordinary content. Standard `-`, `+` and `*` markers work.
6. The first paragraph is an entry's title, with inline Markdown retained. Soft-wrapped title paragraphs remain one title; other paragraphs, quotes, tables, code and deeper nested content belong to the entry as source. A structured rename currently replaces the title with one nonempty inline Markdown line.
7. Immediate child unordered-list task items are dated planning details. Plain child list items are undated details. Deeper lists and other body blocks remain ordinary Markdown; they do not become independently scheduled entries. A parent is complete exactly when all its planning details are complete. Inconsistent hand-edited checkboxes need review rather than silent normalization. Completing/reopening a parent toggles its planning details; toggling a detail recomputes its parent's state.
8. Scratchpad begins immediately after its heading's line ending and runs to end of file, including all whitespace. Every subsequent heading, task, fence or metadata-looking line is capture content. No planner entry is implicitly created there. Promotion must eventually update destination and scratchpad in one document transaction and undo step.

### Version 2 recursive outlines

Immediate unordered-list children and their descendants become outline nodes, up to 32 levels below an entry. Dated outlines may mix task checkboxes and plain notes. Undated outlines remain plain bullets without completion state at any depth. Ordered lists, paragraphs, quotes, tables and code are owned body content, not independently scheduled entries. Only the top-level entry owns ID, date, recurrence and other planning metadata; descendant `hcb` fences remain inert examples with warnings.

A task parent with task children is complete exactly when those child task branches are complete. Plain notes do not count toward completion; task descendants underneath a plain note still belong to the nearest task ancestor. A task without task descendants retains its own checkbox state. Completing/reopening a task toggles all task descendants and leaves plain notes unchanged. Hand-edited inconsistent branches are diagnostics. Moving, indenting, outdenting, promoting or deleting a node acts on its entire subtree, including ordinary body content.

Enabling deeper outlines is an explicit, undoable source-format upgrade. Its preview changes the frontmatter version and recomputes ancestor checkboxes from existing descendant states; it preserves document identity and all unrelated source. Other diagnostics, including deeply nested undated checkboxes, require explicit source correction before upgrade. Older version-1-only clients reject format 2 rather than flattening it. Concurrent format upgrades and other source edits require review instead of automatic merging.

### Version 3 unified writing

All direct unordered-list items under a date or named undated group become outline entries. An ordinary bullet has `kind: note` in the derived model and no completion state; a GFM checkbox is a task in either location. The same distinction applies recursively. A plain parent can contain tasks without acquiring a checkbox or a completion state. Task ancestors retain the version-2 completion rules. Paragraphs, tables, ordered lists, quotes, code and other Markdown remain source content and do not require a task container.

Only the reserved plain level-two section headings and the structural level-three group headings change the active group. In Dated, level-three ISO date headings open days; in Undated, plain level-three headings open named groups. Other headings remain ordinary writing inside the current document. Invalid ISO date headings are still errors. Reserved section names and undated group headings must be escaped or formatted when intended literally.

An undated task may retain `completed: YYYY-MM-DD` when checked. Recurrence, spans, skips and replacements still need a date: a structured move to Undated rejects these fields rather than discarding them. Plain dated entries may have ordinary scheduled recurrence or spans, but after-completion recurrence requires a task. Converting a completed task to a plain entry requires reopening it first; the adapter rejects contradictory plain/completed projections.

The explicit unified-writing upgrade changes the header to `3` and, for version-1 descendants, recomputes ancestor checkboxes from the now-visible deeper tasks. It retains document identity, all Markdown source and metadata outside those deliberate edits. Previously ordinary dated bullet lists become plain outline entries, and undated bullets remain plain. The preview must expose this interpretation change before committing. Reading, importing or syncing never performs the upgrade. Previous clients reject format 3; concurrent upgrades and other edits require review. A user can undo the upgrade through the normal document history.

## Identity and links

Document, entry and series identifiers use 1–80 ASCII lowercase letters, digits and hyphens; the first character is a letter or digit. The app generates UUIDs for document/entry IDs. Human-authored IDs with the same grammar are allowed. Document identity stays fixed for its lifetime; a copied independent document must deliberately receive a new identity before linking it as another journal.

An entry can omit `id` during ordinary capture. Its temporary source position is valid only against that exact source version. `ensurePlannerEntryId` persists one before creating an entry link or any operation needing lasting identity. Once present, an ID survives title edits and moves. Duplicating an entry must assign a fresh ID to the copy; duplicate IDs disable structured writes. Do not derive identity from titles, dates, array indices or wall-clock time. An entry ID is distinct from a recurrence series ID or occurrence number.

Use ordinary Markdown link notation: `[label](#hcb-ID)`. Hot Cross Buns reserves the `hcb-` fragment namespace for entry IDs. Heading anchors use a separate `heading-` namespace with deterministic collision suffixes; a title cannot claim an entry anchor. Entry labels are normal content and are not silently rewritten when the target is renamed. Missing targets produce warnings and leave the link intact, including after deletion. These anchors are a Hot Cross Buns extension, not a guarantee that another Markdown renderer will resolve them. Body links navigate entries/headings, and linked mentions return to their referring passages. Suggestions prepare missing IDs in the same transaction as the link.

## Planning metadata

An entry may contain one direct, closed, indented fenced block with exactly `hcb` as its info string. Backtick or tilde fences follow Markdown indentation rules. Metadata can follow the title or other body blocks. A block under a detail, quote or example is not parent metadata. Additional direct metadata blocks, extra fence arguments, incomplete fences, duplicate keys, unknown fields and malformed values are errors. Orphan `hcb` examples outside entries produce warnings; they remain inert source.

Each nonblank metadata line is an unquoted `key: value`, without nested structures, tags, expressions, continuations or general YAML coercion. Values are nonempty. Unknown planning fields are preserved in source but disable structured edits: an older writer must not ignore scheduling meaning it does not understand. Blank lines and trailing whitespace are retained. The recognized keys are:

| Key | Value and meaning |
| --- | --- |
| `id` | Stable entry identity; the only metadata field allowed on an undated entry in versions 1/2 |
| `repeat` | Existing readable recurrence grammar, with explicit `series`; after-completion rules also require one-based `occurrence` |
| `completed` | Actual completion date `YYYY-MM-DD`; requires a completed checkbox, is required for a completed after-completion entry, and is allowed on undated tasks in version 3 |
| `span` | `all-day`, `all-day through YYYY-MM-DD`, or `HH:MM to YYYY-MM-DD HH:MM` |
| `skip` | Unique `YYYY-MM-DD` dates separated by comma and space; requires a scheduled rule, never an after-completion rule |
| `replaces` | `SERIES on YYYY-MM-DD`, identifying an original scheduled occurrence; a replacement cannot itself repeat |

The readable recurrence vocabulary and calculations are unchanged from [the existing recurrence contract](TODO_FORMAT.md#recurrence): daily, weekdays, weekday sets, monthly dates, yearly dates, extended intervals/ordinal rules/start anchors/end constraints/week starts, and after-completion intervals. A scheduled series occurs once in source and projects future occurrences. Each after-completion `(series, occurrence)` pair is unique. Each original `(series, date)` can have one replacement; its scheduled master must exist in the document. No rule is expanded into stored copies just for viewing a future date.

There is one entry model, including meeting-shaped entries. A dated entry without a time or span is simply dated. An explicit all-day span occupies a day; `through` is inclusive and later than the heading date. A timed multi-day span ends on a later valid date. A literal source `HH:MM-HH:MM ` title prefix expresses a same-day interval with valid 24-hour clocks and end after start. Clock-shaped text inside inline code, links or emphasis does not become scheduling syntax; use those forms for examples. The projection exposes a separate `timeBlock` so consumers need not reinterpret rendered title text. A time block cannot coexist with a span. All-day and timed multi-day entries remain stored once under the start date.

Times are floating wall clocks by default: written 09:00 stays 09:00 when the viewing zone changes. Version 1 adds no implicit zone or instant. Optional display conversion will require an explicit source-zone policy, settings and a context-change toast; it must not rewrite this source. Actual saved-schedule conversion needs preview, confirmation and undo. No timezone conversion engine is implemented in this release.

## Source editing and validation

The authoritative representation is the exact source string, not the projected task arrays. The parser preserves BOM, LF/CRLF/CR, whitespace, Markdown escapes, comments, prose, unknown extensions and scratchpad text. `text` is derived readable title content; `markdown` and ranges retain the source. Never serialize the projections through the old TXT writer or a whole-document Markdown formatter.

Source ranges are half-open UTF-16 offsets, matching JavaScript strings, not UTF-8 byte positions. A structured transaction supplies the exact expected full source and expected fragments, checks range bounds/overlap/surrogate boundaries, applies patches against one baseline, then validates the entire candidate before returning it. Certified same-width plain-title and planning-checkbox changes reuse unchanged grammar and recheck affected completion constraints; other candidates are fully reparsed, as described below. No input model is mutated. Stale source rejects the transaction; it does not overwrite a newer edit. A structured edit cannot change document identity. Save ownership, durable persistence and concurrent-branch review still belong to the sync coordinator, not this pure module. Its source equality check is not a cross-device lock.

Incremental validation starts only from an immutable model issued by this parser instance. Every changed character must belong to an existing planning checkbox or a same-width title consisting entirely of ASCII letters and internal spaces, with a letter at both ends. Checkboxes retain their existing GFM token shape (` `, `x` or `X`). Source outside those tokens must be identical; offsets, UTF-8 byte count, line count, structural grammar, metadata and global reference context therefore stay unchanged. Changed title/checkbox values are updated in both planning projections and retained render trees, and affected task ancestors and completion-date dependencies are revalidated. An inconsistent candidate falls back to the full parser and its original diagnostics.

Copied/adopted wire models do not carry the parser singleton’s process-local certificate. The worker retains up to four validated models under session-local request IDs and matches the complete request source before issuing compact token patches. The client maintains its own private validator for models received from that worker session; it checks the advertised baseline, exact fragments and token grammar before replay. Arbitrary copies and stored projections cannot enroll themselves. Missing, evicted or incompatible baselines return a complete model, and an unusable compact response triggers one complete-model retry under the original timeout. Worker restart clears client baselines; old-session events are ignored. New imports/source loads, changed metadata, references, dates, group/outline structure, arbitrary body/capture content, new syntax, non-ASCII titles or length changes use the full parser unless their exact complete source is already cached as validated. Range, overlap, fragment, surrogate, document-identity and stale-source checks still apply before any durable write. This changes the validation strategy, not the file format, database schema or revision protocol. Future grammar changes must review the incremental recognizer against the complete-parser oracle.

Errors leave the source recoverable and disable structured edits. Warnings such as broken links and inert examples do not block writing. The hidden source editor retains invalid drafts separately and never passes them off as validated structured content. Unsupported canonical source stops startup with raw browser recovery; imported source remains downloadable in review. The parser does not itself control provider writes.

The implemented operations are atomic source patches, entry identity insertion, title replacement, non-recurring parent/detail completion and scratchpad replacement. Recurring/replacement/dated-completion metadata entries deliberately reject the simple completion helper: occurrence materialization, recurrence scope, successor creation and completion-date cleanup must be integrated as one higher-level transaction. Likewise, scheduling/moving a recurring or spanning entry requires its semantic operation; an arbitrary text patch alone does not prove recurrence-scope intent. Source patches support preserving whole entry bodies during a move, and journalDocument.ts now connects the existing occurrence-aware operation layer to those patches.

Inputs and transaction results must be valid Unicode and are limited to 5 MiB of UTF-8 text and 100,000 logical lines, with a terminal newline excluded from the line count. Lone UTF-16 surrogates are rejected instead of being silently replaced by UTF-8 encoding. Oversized input throws before Markdown parsing. These are resource ceilings, not measured responsiveness targets. Parsing does not execute HTML/code or fetch links. Browser validation uses a worker; rendering separately restricts URLs, keeps HTML literal, requires explicit image loading, bounds code/math work and isolates Mermaid with safe source fallback. See [rendering budgets](MARKDOWN_SUPPORT.md) and [parser performance](PARSER_PERFORMANCE.md).

## Verification and replacement of TXT

[`markdownPlanner.test.mjs`](../tests/markdownPlanner.test.mjs) exercises semantic equivalence against handwritten TXT/Markdown fixtures, recurrence rule fields, exact-source edits, structure/fence ownership, shared scratchpad boundaries, identities, links, stale writes, invalid transactions, corruption and resource ceilings. This is format/operation validation, not evidence of a shipped calendar or real device delivery. Runtime and provider suites separately cover Markdown persistence and simulated sync.

There is no permanent TXT file reader or compatibility mode. Paired fixtures are a development acceptance tool; the explicit developer-workspace conversion archives earlier records and leaves targets untouched. Browser storage is schema 4, revision envelopes are protocol 2, and document formats 1, 2 and 3 are supported. See [MARKDOWN_RUNTIME.md](MARKDOWN_RUNTIME.md) for shared scratchpad privacy, drafts, migration, rollback and runtime test coverage. Calendar views are not implemented by this format engine.
