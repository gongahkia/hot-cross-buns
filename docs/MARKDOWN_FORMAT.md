# Hot Cross Buns Markdown format, version 1

This is the approved contract for the Markdown planner foundation. The parser and source-editing primitives are implemented in [`markdownPlanner.ts`](../src/markdownPlanner.ts); the running app still uses [TODO.txt](TODO_FORMAT.md). Storage, sync, rich rendering and calendar integration follow in the stages recorded in [the implementation plan](MARKDOWN_PLANNER_PLAN.md). This document does not claim those stages are shipped.

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

Parsing uses CommonMark with GFM task lists, tables, autolinks, footnotes and strikethrough, plus a frontmatter extension. These are parsed as Markdown, rather than by searching arbitrary lines for task-shaped text. Frontmatter and `hcb` blocks have the restricted data grammar below; they are not executable YAML. Diagrams, mathematics and unfamiliar extensions remain source content at this stage. Rendering support is a separate stage.

Structural rules:

1. Frontmatter is the first block, optionally after a UTF-8 BOM. It contains exactly `hcb-format: 1` and `document-id: ID`, in either order. Blank lines are allowed. Unsupported versions or fields are diagnostics and disable structured writing; retain the original source for recovery or a compatible reader.
2. Root-level, plain-text level-two headings `Dated`, `Undated` and `Scratchpad` occur once in that order. A title and ordinary Markdown can surround the first two sections. Other root level-one/two headings end the active planning section. Reserved-looking text inside code fences, blockquotes, lists or HTML comments is not structural. Formatting or escaping can make an example ordinary Markdown, but an escaped heading marker such as `\## Dated` is the clearest literal form.
3. Under `Dated`, root level-three headings containing an exact valid Gregorian `YYYY-MM-DD` open date groups. Date-like invalid headings are errors. Empty date groups are meaningful. Groups retain source order; views can sort projections without rewriting source. Duplicate dates are errors.
4. Under `Undated`, plain-text root level-three headings open named lists. Duplicate names are errors. Deeper root headings end entry collection for the active group; their contents are ordinary notes until another level-three group starts.
5. Only direct root unordered lists under an active group supply planner entries. Dated entries need GFM `[ ]`, `[x]` or `[X]`; an ordinary bullet list there is prose. Undated entries and their details use plain bullets and have no completion state. Ordered lists remain ordinary content. Standard `-`, `+` and `*` markers work.
6. The first paragraph is an entry's title, with inline Markdown retained. Soft-wrapped title paragraphs remain one title; other paragraphs, quotes, tables, code and deeper nested content belong to the entry as source. A structured rename currently replaces the title with one nonempty inline Markdown line.
7. Immediate child unordered-list task items are dated planning details. Plain child list items are undated details. Deeper lists and other body blocks remain ordinary Markdown; they do not become independently scheduled entries. A parent is complete exactly when all its planning details are complete. Inconsistent hand-edited checkboxes need review rather than silent normalization. Completing/reopening a parent toggles its planning details; toggling a detail recomputes its parent's state.
8. Scratchpad begins immediately after its heading's line ending and runs to end of file, including all whitespace. Every subsequent heading, task, fence or metadata-looking line is capture content. No planner entry is implicitly created there. Promotion must eventually update destination and scratchpad in one document transaction and undo step.

## Identity and links

Document, entry and series identifiers use 1–80 ASCII lowercase letters, digits and hyphens; the first character is a letter or digit. The app generates UUIDs for document/entry IDs. Human-authored IDs with the same grammar are allowed. Document identity stays fixed for its lifetime; a copied independent document must deliberately receive a new identity before linking it as another journal.

An entry can omit `id` during ordinary capture. Its temporary source position is valid only against that exact source version. `ensurePlannerEntryId` persists one before creating an entry link or any operation needing lasting identity. Once present, an ID survives title edits and moves. Duplicating an entry must assign a fresh ID to the copy; duplicate IDs disable structured writes. Do not derive identity from titles, dates, array indices or wall-clock time. An entry ID is distinct from a recurrence series ID or occurrence number.

Use ordinary Markdown link notation: `[label](#hcb-ID)`. Hot Cross Buns reserves the `hcb-` fragment namespace for entry IDs. A future renderer must keep heading anchors in a separate namespace; it must not let a title claim an entry anchor. Entry labels are normal content and are not silently rewritten when the target is renamed. Missing targets produce warnings and leave the link intact, including after deletion. These anchors are a Hot Cross Buns extension, not a guarantee that another Markdown renderer will resolve them. This foundation diagnoses direct links and reference definitions; clickable navigation and heading-link presentation are not implemented yet.

## Planning metadata

An entry may contain one direct, closed, indented fenced block with exactly `hcb` as its info string. Backtick or tilde fences follow Markdown indentation rules. Metadata can follow the title or other body blocks. A block under a detail, quote or example is not parent metadata. Additional direct metadata blocks, extra fence arguments, incomplete fences, duplicate keys, unknown fields and malformed values are errors. Orphan `hcb` examples outside entries produce warnings; they remain inert source.

Each nonblank metadata line is an unquoted `key: value`, without nested structures, tags, expressions, continuations or general YAML coercion. Values are nonempty. Unknown planning fields are preserved in source but disable structured edits: an older writer must not ignore scheduling meaning it does not understand. Blank lines and trailing whitespace are retained. The recognized keys are:

| Key | Value and meaning |
| --- | --- |
| `id` | Stable entry identity; the only metadata field allowed on an undated entry |
| `repeat` | Existing readable recurrence grammar, with explicit `series`; after-completion rules also require one-based `occurrence` |
| `completed` | Actual completion date `YYYY-MM-DD`; requires a completed checkbox and is required for a completed after-completion entry |
| `span` | `all-day`, `all-day through YYYY-MM-DD`, or `HH:MM to YYYY-MM-DD HH:MM` |
| `skip` | Unique `YYYY-MM-DD` dates separated by comma and space; requires a scheduled rule, never an after-completion rule |
| `replaces` | `SERIES on YYYY-MM-DD`, identifying an original scheduled occurrence; a replacement cannot itself repeat |

The readable recurrence vocabulary and calculations are unchanged from [the existing recurrence contract](TODO_FORMAT.md#recurrence): daily, weekdays, weekday sets, monthly dates, yearly dates, extended intervals/ordinal rules/start anchors/end constraints/week starts, and after-completion intervals. A scheduled series occurs once in source and projects future occurrences. Each after-completion `(series, occurrence)` pair is unique. Each original `(series, date)` can have one replacement; its scheduled master must exist in the document. No rule is expanded into stored copies just for viewing a future date.

There is one entry model, including meeting-shaped entries. A dated entry without a time or span is simply dated. An explicit all-day span occupies a day; `through` is inclusive and later than the heading date. A timed multi-day span ends on a later valid date. A literal source `HH:MM-HH:MM ` title prefix expresses a same-day interval with valid 24-hour clocks and end after start. Clock-shaped text inside inline code, links or emphasis does not become scheduling syntax; use those forms for examples. The projection exposes a separate `timeBlock` so consumers need not reinterpret rendered title text. A time block cannot coexist with a span. All-day and timed multi-day entries remain stored once under the start date.

Times are floating wall clocks by default: written 09:00 stays 09:00 when the viewing zone changes. Version 1 adds no implicit zone or instant. Optional display conversion will require an explicit source-zone policy, settings and a context-change toast; it must not rewrite this source. Actual saved-schedule conversion needs preview, confirmation and undo. No conversion engine is implemented in this foundation.

## Source editing and validation

The authoritative representation is the exact source string, not the projected task arrays. The parser preserves BOM, LF/CRLF/CR, whitespace, Markdown escapes, comments, prose, unknown extensions and scratchpad text. `text` is derived readable title content; `markdown` and ranges retain the source. Never serialize the projections through the old TXT writer or a whole-document Markdown formatter.

Source ranges are half-open UTF-16 offsets, matching JavaScript strings, not UTF-8 byte positions. A structured transaction supplies the exact expected full source and expected fragments, checks range bounds/overlap/surrogate boundaries, applies patches against one baseline, then reparses and validates the entire candidate before returning it. No input model is mutated. Stale source rejects the transaction; it does not overwrite a newer edit. A structured edit cannot change document identity. Save ownership, durable persistence and concurrent-branch review still belong to the sync coordinator, not this pure module. Its source equality check is not a cross-device lock.

Errors leave the source recoverable and disable structured edits. Warnings such as broken links and inert examples do not block writing. A future source editor may retain an invalid draft separately, but must not pass it off as a validated structured transaction. Unknown format versions need a read-only/recovery path before runtime integration; the parser does not itself control provider writes.

The implemented operations are atomic source patches, entry identity insertion, title replacement, non-recurring parent/detail completion and scratchpad replacement. Recurring/replacement/dated-completion metadata entries deliberately reject the simple completion helper: occurrence materialization, recurrence scope, successor creation and completion-date cleanup must be integrated as one higher-level transaction. Likewise, scheduling/moving a recurring or spanning entry requires its semantic operation; an arbitrary text patch alone does not prove recurrence-scope intent. Source patches support preserving whole entry bodies during a move, but the full product operation layer is still to follow.

Inputs and transaction results must be valid Unicode and are limited to 5 MiB of UTF-8 text and 100,000 logical lines, with a terminal newline excluded from the line count. Lone UTF-16 surrogates are rejected instead of being silently replaced by UTF-8 encoding. Oversized input throws before Markdown parsing. These are resource ceilings, not measured responsiveness targets; worker/index architecture and benchmarks remain a later gate. This stage parses source without rendering HTML, executing code, fetching links or processing Mermaid/math. Rendering must later handle untrusted HTML/URLs, bounded diagram/math work and safe source fallback explicitly.

## Verification and replacement of TXT

[`markdownPlanner.test.mjs`](../tests/markdownPlanner.test.mjs) exercises semantic equivalence against handwritten TXT/Markdown fixtures, recurrence rule fields, exact-source edits, structure/fence ownership, shared scratchpad boundaries, identities, links, stale writes, invalid transactions, corruption and resource ceilings. This is format/operation validation, not evidence of a shipped calendar, Markdown sync or real device delivery.

There is no permanent old-schema reader, compatibility mode or migration wizard planned. The paired fixtures are a development acceptance tool. The application transition must still explicitly decide what to do with an existing developer browser workspace/linked target, fence incompatible writers and test recovery without silently deleting storage. Document format version `1` is independent of the immutable revision protocol and browser database versions. Until that transition is implemented and verified, the current app and provider adapters continue writing TXT.
