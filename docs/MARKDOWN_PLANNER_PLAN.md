# Single-file Markdown planner

Status: planning draft, 16 November 2026. Product decisions below, including the calendar view set and default floating-time behavior, are confirmed. The example syntax and technical design still need review. This document does not describe shipped functionality or authorize implementation.

Baseline inspected: `a8d586f`. The running app still uses [the existing TODO.txt format](TODO_FORMAT.md). Keep that document accurate for the running app until the Markdown implementation replaces it. Do not edit the README during this planning work.

The on-disk agent guide also describes the current TXT format. The user's explicit new direction supersedes that future format constraint; update repository guidance and active format documentation together only when the Markdown implementation is approved. Do not add permanent TXT compatibility merely to satisfy outdated guidance.

## Confirmed direction

- Hot Cross Buns becomes a Markdown-first browser planner inspired by Org mode, with its own small, documented planning extension.
- One canonical `.md` file holds user content. Do not split the journal into daily files, notes into a vault, or calendar data into a second authoritative document.
- Preserve dated and undated workflows. Add a fully functional calendar as another editable view of the same dated entries.
- Initial calendar views are day, week and month. The existing dated-task list already serves as the agenda; do not add a separate agenda view.
- Keep one entry/task model for now. A timed meeting-shaped entry and a timed task do not become separate event and task entities.
- Written times remain floating by default: changing viewing time zone does not convert a written 09:00. Optional conversion behavior belongs in Settings and must announce actual conversion with the existing toast mechanism. The precise opt-in conversion semantics remain part of the design review below.
- Include the scratchpad in the same file and sync it. This deliberately changes its current browser-local behavior; uncategorized capture remains a distinct workflow.
- Keep the current quiet visual language, command palette, contextual actions, keyboard access and reduced-motion behavior.
- Never add live Google Calendar or Outlook calendar integration, bidirectional mirroring, remote calendar ownership, or write-back. At most, those products supply one-time imports whose resulting entries belong to Hot Cross Buns.
- File storage/sync is a different concern: Google Drive can carry the Markdown document, just as a desktop sync folder can. That is not Google Calendar integration.
- There are no real users requiring a legacy TXT compatibility product. Use the old syntax as a semantic checklist and source of mapping fixtures, not a reason to ship parallel formats or a permanent migration framework.
- First-class agent/MCP access is a later phase. Prepare a coherent document model now; do not build an MCP server, agent permissions UI or execution framework in this phase.

## Current implementation versus target

| Area | Current behavior | Target |
| --- | --- | --- |
| Portable content | A structured TXT journal | A single Markdown document with prose and planning semantics |
| Dated UI | Date-oriented item lists | Keep those lists and add calendar views over the same entries |
| Undated UI | Named lists without completion circles | Keep this workflow; do not silently turn existing undated notes into completed/open tasks |
| Scratchpad | Separate browser-only text | A capture section in the shared document; no automatic promotion into the planner |
| Rich content | Item and detail text | Source-preserved Markdown, including diagrams and mathematics |
| Search/linking | View-scoped palette search and tags | Fast content search and stable internal links within the one document |
| Persistence | Durable browser working copy and sync outbox | Keep durability; separate rebuildable indexes from drafts and pending writes |
| Calendar accounts | Separate one-time Google snapshot tools | One-time imports only; no live calendar connections, now or later |
| Agent access | No current MCP implementation | Later controlled access through the same operations and version checks |

One content file does not mean one physical storage artifact. Browser working copies, indexes and immutable recovery revisions may still exist. Do not put credentials in Markdown or remove companion revision protection merely to advertise one file. Unresolved revisions can contain work absent from the current projection; document and retain that existing boundary.

## Markdown format proposal

Use CommonMark-compatible content plus GFM task lists and tables as the baseline. Frontmatter, planning attributes, stable block anchors, mathematics and Mermaid rendering are explicitly documented extensions, not universal Markdown features. A plain Markdown reader should retain readable content even when it cannot interpret the planner.

Candidate A uses ordinary headings and checkboxes, with an indented `hcb` code fence for structured planning metadata. Fences keep attributes readable in a generic Markdown preview and avoid assigning meaning to arbitrary prose. This is an illustrative candidate, not a complete grammar or implemented parser:

````markdown
---
hcb-format: 1
document-id: planner-example
---

# Hot Cross Buns

## Dated

### 2026-11-16

Meeting notes can include ordinary paragraphs and [a related entry](#hcb-water-plants).

- [ ] 09:00-09:30 Team sync #work
  ```hcb
  id: team-sync
  ```
  - [ ] Share the update
  - [x] Confirm the agenda

- [x] Water plants
  ```hcb
  id: water-plants
  repeat: every 3 days after completion; series watering; occurrence 1
  completed: 2026-11-16
  ```
  - [x] Check the soil

### 2026-11-17

## Undated

### Inbox

- Read this later
  - Background and links

### Ideas

- Prepare a talk

## Scratchpad

Unsorted meeting fragments remain here until explicitly promoted.
````

Candidate B keeps the same content structure but stores the attributes in an indented HTML comment. It is quieter in other Markdown previews, but hides planning meaning in those previews. Candidate A remains the recommendation for inspectability: keep ordinary tasks terse, add metadata only where needed, and fold it in the rendered app. Do not require users to type an ID for every ordinary capture. Identity generation and which entries need persisted IDs still need a precise contract. The user requested a recommendation rather than selecting a representation; neither representation has been approved yet.

The final format contract must settle these details before parser work:

- Recognize planner sections only at defined structural positions outside fenced code. Document reserved headings and literal escapes. Treat the scratchpad as the final capture section, so pasted headings and checkboxes there do not accidentally become planner entries.
- Preserve ordinary paragraphs, nested headings, lists, tables, quotes, comments, whitespace and unfamiliar extensions. Invalid planner metadata produces diagnostics without discarding source.
- Define task/detail ownership and metadata placement precisely, including continuation paragraphs, code fences, duplicate fields and duplicate IDs. An example alone is not a grammar.
- Give linkable entries stable text identities. IDs survive title edits, moves and rescheduling; duplicates receive new IDs. Choose the ID spelling and validation policy in the final contract. Browser-generated IDs must no longer be the only identity for linkable content.
- Prefer ordinary Markdown links. Candidate `#hcb-<id>` anchors resolve through entry metadata in Hot Cross Buns; they are a custom extension and will not necessarily resolve in other renderers. Define heading-link collisions, broken-link diagnostics and deletion behavior. Do not link by mutable array index or title alone.
- Keep document format versions separate from sync protocol versions. An older writer must not reinterpret or overwrite an unsupported document version.
- Define safe metadata types and escaping; per-entry attributes are data, not executable expressions. Do not execute YAML tags, Markdown code blocks, diagrams or agent instructions.
- User content belongs in the one document. Theme, local view state, credentials and disposable caches do not need to become shared content. Any scheduling policy that affects interpretation must be explicit rather than accidentally inherited from one browser.

## Existing-to-Markdown semantic mapping

This is a design acceptance matrix. Implementation must add concrete input/output fixtures and compare semantic meaning, rather than only counting rendered rows. No permanent old-file reader or upgrade wizard is implied.

| Existing concept | Proposed Markdown representation / required invariant |
| --- | --- |
| `TodoDocument.days` | Dated section with date subheadings; retain each date's content and ordering |
| Empty date / `keepEmpty` | An empty date subheading remains meaningful |
| Completed/upcoming blank-line divider | Explicit GFM checkboxes carry completion; blank lines become ordinary formatting |
| Item title, hashtags, literal syntax-looking text | Preserve the exact human content using Markdown escaping where necessary; never mistake code examples for entries |
| Dated details | Nested task-list details; preserve order and each completion flag |
| Parent/detail completion rules | Keep completing/reopening children with the parent and completing the parent when its last detail is completed |
| Undated `LIST:` groups | Undated subheadings, plain item bullets and nested plain detail bullets; preserve their non-checkbox workflow |
| Item/detail promotion and movement | Structural edits in the same source document, keeping content, identity where applicable and one undoable action |
| Same-day `HH:MM-HH:MM` prefix | Keep the readable prefix in Candidate A; preserve its local wall-clock meaning |
| `@span: all-day` | Entry metadata `span: all-day`; distinguish explicit all-day occupancy from an untimed dated item |
| `@span: all-day through DATE` | Preserve the inclusive end date; project across days without storing duplicate entries |
| Overnight/multi-day timed span | Preserve start clock, end date and end clock; retain one source entry |
| `@repeat` short scheduled rules | Preserve daily, weekdays, weekly day sets, monthly dates and yearly month/day patterns |
| Extended scheduled recurrence | Preserve interval, unit, selected weekdays, ordinal/last-day patterns, start anchor, series ID, occurrence number, week start and end-date/count constraints |
| Recurrence projection | Calculate future occurrences without expanding the Markdown into copies |
| `@skip` | A validated exclusion-date collection on the series; preserve every exclusion |
| `@replaces` | A replacement referencing its original series and occurrence date, with its own current placement |
| This / following / all edits | Preserve exception behavior and series splitting; a gesture must not silently rebase the master rule |
| After-completion recurrence | Preserve the actual completion date, series and occurrence identity; create one successor in the same undoable edit |
| Missing month days, leap days, clamping | Keep the existing scheduled-skip versus after-completion-clamp distinctions |
| Saved public holidays | Ordinary all-day entries; keep the current add-once behavior |
| Date-only holiday overlay | A view setting, not duplicated document entries |
| Scratchpad text | Raw Markdown in the scratchpad section, including blank lines; now part of shared content |
| Scratchpad capture mappings | Keep first-line/details, one item per nonempty line, and joined-title mappings |
| Scratchpad cut / ask behavior | Keep the choice and atomic journal-plus-scratchpad undo; adding shared storage must not create half-applied promotions |
| Import doctor and explicit review | Retain diagnostics, source preview and explicit approval when interpretation changes |
| Undo/redo, active drafts, failed saves | Operate on the document and preserve newer edits; source editing and rich views must share the same mutation path |
| Download and recovery | Export complete Markdown and exact observed source; previews and recovery downloads do not advance sync baselines |
| Immutable revisions and pending writes | Carry the complete Markdown content, including scratchpad; preserve retry identity, ancestry, generation fencing and explicit branch review |

Prose, internal linking, diagrams and mathematics are new content capabilities, not existing TXT fields. The mapping must not invent appointments, deadlines, guest lists or invitations from ordinary details. A current item with a meeting link stays the same task-like entry.

There is no need to preserve the old serialized spelling. Preserve its meaning. When an old malformed example is ambiguous, make the fixture's interpretation explicit; do not use the current date or guessed completion dates to manufacture a one-to-one mapping.

## Calendar scope and historical references

Confirmed initial view set: day, week and month, alongside the preserved dated-task list. That list already serves as the agenda, so do not add a separate agenda view or authoritative agenda collection. The interaction details still need review; "fully functional" should be converted into named operations, not reduced to a read-only month grid.

Required operations in the proposed scope: create/edit entries, select dates, return to today, navigate ranges, move entries across dates, change timed duration, handle explicit all-day and multi-day entries, show overlaps/overflow, review recurrence scope, undo changes, and reach equivalent operations by keyboard. Preserve untimed dated entries without assigning an invented start time. No event entity or invitation system is needed.

Inspect historical behavior and adapt it to the current styled-components interface. Do not restore the old Electron shell, panes, permanent sidebar, provider-account model, synchronization engine, or large dependency set.

`25872ac` is the direct parent of restoration commit `0e6803b`, so these references come from the calendar tree immediately before the journal restoration. Historical audit documents include older Electron observations as well as browser work; they are evidence of prior design and testing, not a fresh runtime verification.

| Historical evidence inspected | Useful behavior / caution to carry forward |
| --- | --- |
| `45fd4ca`, timeline and pointer gesture changes | Start/end resize, preserved grab offset, cross-period movement, preview, Escape/blur cancellation, and one commit after pointer release |
| `d970750`, month gestures and recurrence review | Multi-day edges, month movement and explicit recurrence scope; do not rebase a series from a moved occurrence |
| `0f7ded8`, grid focus helper and keyboard tests | One grid Tab stop with arrow/Home/End traversal; event-shaped task controls and precision forms remain reachable |
| `25872ac`, `docs/testing/calendar-interaction-audit.md` | Title-first density, overflow focus containment, short-item hit targets, truthful save/loading states and a route back from navigation limits |
| `25872ac`, `CalendarHeader.tsx` | Day/week/month/agenda and custom-day navigation are historical options; keep optional modes behind the current palette/contextual controls |
| `25872ac`, `docs/performance/browser-workspace.md` | A reproducible measurement method with dataset/hardware/sample boundaries. Its SQLite/worker timings are historical observations, not benchmarks for this Markdown app |

The old calendar also has Google-specific permissions, delivery states and scheduling services. Do not copy those into a document-owned calendar. Reuse interaction lessons and tested invariants, not the old account architecture.

### Time behavior

Confirmed default: keep existing floating wall times. A written 09:00 remains 09:00 when a viewer changes time zone. It is not an instant without additional information, and the app must not invent its original zone or silently convert it to UTC. A task's placement date must not become its creation date or a deadline.

Confirmed product requirement: optional conversion behavior is configurable in Settings, and an actual conversion is announced through a toast. Recommended interpretation for review:

- Separate display conversion from changing the saved schedule. Changing a display preference should not rewrite Markdown, reschedule tasks, or mutate recurrence rules.
- Only offer meaningful cross-zone conversion when a source date and explicit source zone/instant are available. Adding timezone-aware behavior must not introduce a separate event entity.
- Keep conversion opt-in. Explain the source and display zones; for a floating entry, require the user to choose an anchoring policy instead of guessing one.
- Give one clear toast when the conversion context changes, rather than one notification per item or per render. The toast describes the applied display behavior; it is not a substitute for consent to alter saved content.
- An operation that actually converts stored schedules needs a preview, explicit confirmation and undo. Keep that operation separate from a viewing preference.
- Define shared versus per-browser settings, day boundaries, DST gaps/ambiguities, all-day inclusive ends and recurrence expansion before implementing conversion. Default floating times and all-day dates must not be shifted incidentally.

This interpretation is a proposal, not a claim that timezone conversion has been implemented or its metadata format chosen.

## Source editing, capture, search and rendering

- A source-preserving Markdown document model must precede new views. The current task-only serializer cannot round-trip arbitrary Markdown; converting everything through it would discard content.
- Patch intended source ranges against a known document version, retain unaffected text, and reparse/diagnose the result. Do not use regex replacement across the entire document as the structural editor.
- Keep durable browser drafts and pending submissions. Rebuildable search, backlink and calendar indexes are separate from unsaved work.
- The scratchpad is searchable capture, but its checkboxes and dates are not scheduled entries until explicitly promoted. Promotion targets dated or undated content in the same file and remains undoable across both sections.
- Origin links and capture provenance are proposed enhancements. If cut removes the source passage, the UI must not promise a working jump-back unless the source context is deliberately retained elsewhere in the same document. Resolve that behavior before adding provenance metadata.
- Build search/link/calendar indexes incrementally or off the main thread when measurements justify it. Render visible calendar ranges and lazily render diagrams/math. No broad workspace rerender or history scan should be required for each keystroke.
- Preserve the quiet UI: dated, undated and scratchpad workflows remain primary. Calendar switching, metadata, source tools, linking and advanced commands should use restrained/contextual controls. A Markdown transition must not require a permanent graph, inspector or navigation sidebar.
- Render untrusted Markdown safely, restrict URL schemes, and keep metadata comments inert. Mermaid/math processing must have bounded work and isolated failures; unsupported or invalid content stays available as source. Single-file support does not silently add a binary-attachment directory.

## Sync and future agents

Keep the existing provider-independent coordination and file-storage options. Scratchpad writes now affect the shared document; extend its merge, conflict, draft, restore and undo rules accordingly. A full-version restoration now includes scratchpad content, so update confirmation language and tests rather than keeping the old "scratchpad unchanged" promise. Account credentials and local appearance remain outside those restores.

The existing merge is based on `TodoDocument`. It cannot be assumed to preserve arbitrary Markdown. Define source-aware merging or explicitly review conflicting whole-document branches; do not route rich text through the old parser as a fallback. Preserve stable pending identities and checkpoints even if the content format changes. Resource limits, full-snapshot write amplification and retention still need measured treatment for a growing single file.

Human and agent writes ultimately need the same document operations, expected-version checks, validation, previews and conflict outcomes. Stable IDs and immutable revisions prepare that foundation. MCP transport, authentication, permissions, tool names and hosting are deferred. A static browser app does not automatically provide a durable local MCP endpoint; do not copy the old Keychain/localhost proposal without a separate design.

One-time external calendar imports must produce owned entries and an interpretation report. Recurrence/time-zone fields without an exact mapping require a documented decision. Provenance can be descriptive, but imported provider IDs never establish ongoing mirroring or write-back.

## Implementation gates

1. Choose the metadata presentation and review the calendar interaction and optional time-conversion details within the confirmed view set/default. Then freeze a normative Markdown grammar, identity/link rules and semantic mapping examples.
2. Add source-model/parser/writer fixtures covering the mapping matrix, unfamiliar Markdown, ambiguous syntax, stable identity, encoding, edits and diagnostics. No permanent old-schema support is required.
3. Implement one shared document mutation path for dated, undated and scratchpad content; adapt storage/sync/recovery with corruption, failed-write, concurrent-edit and shared-scratchpad tests. Decide how a developer's existing local workspace is reset or converted explicitly; do not delete it automatically because the app has no real users yet.
4. Reproduce the current dated/undated/scratchpad flows in Markdown, then complete their richer editing, linking, search, Mermaid and mathematics support. Keep source export and fallback available throughout.
5. Add and verify calendar views against the same source. Cover drag/resize, keyboard/touch alternatives, overlap/overflow, all-day/overnight spans, recurrence exceptions, DST decisions, undo and stale source versions.
6. Publish repeatable performance results for source size, visible items, search, typing/input-to-paint, calendar navigation and durable saves. Set budgets from a defined dataset/device, distinguish warm and cold starts, and report failures. Current loose end-to-end tests and old-calendar measurements do not establish a speed advantage.
7. Validate supported browsers and real file/device delivery separately from mocks when access is available. First-class MCP support gets its own later design and approval.

Do not begin runtime implementation until the planning questions are resolved and the concrete format/design is approved. Documentation changes now do not imply authorization to replace the app, reset storage, rename live sync targets, or deploy a new format.

Immediate review: decide on the recommended visible fenced metadata and review the exact meaning of opt-in display conversion versus saved-schedule changes. The calendar view set and floating-time default have been answered, alongside the earlier calendar-account, task/event and shared-scratchpad decisions; do not ask those questions again by default.

## Research notes

These are primary documentation references, not performance comparisons or claims of application compatibility:

- [GFM specification](https://github.github.com/gfm/): standard task lists, nested content, links and fenced blocks provide the readable substrate. Planner metadata still needs its own contract.
- [Org deadlines and scheduling](https://orgmode.org/manual/Deadlines-and-Scheduling.html): separate the meaning of a start-work date from a deadline; borrowing this distinction does not require importing Org's entire syntax or adding event entities.
- [iCalendar date-time forms](https://datatracker.ietf.org/doc/html/rfc5545#section-3.3.5): floating local times and timezone/UTC-based values are distinct concepts. This informs the design; it does not establish iCalendar format compatibility.
- [NotePlan task model](https://help.noteplan.co/article/42-elements-task): readable task states, date references and links between rescheduled work are useful precedents. Its multi-file layout and additional task states are not automatically our requirements.
- [SilverBullet task management](https://docs.silverbullet.md/Guide/Task%20Management): Markdown tasks with explicit attributes can be indexed into views without duplicating their source. Its page-per-project/query setup is not the selected single-file layout.
- [Obsidian daily notes](https://obsidian.md/help/Plugins/Daily%2Bnotes): date-based capture is useful; its file-per-day organization is deliberately not selected here.
- [Obsidian internal links](https://obsidian.md/help/Linking%2Bnotes%2Band%2Bfiles/Internal%2Blinks): heading/block references inform identity and rename behavior; prefer ordinary Markdown link notation where practical and document any custom block anchors.
- [Mermaid security levels](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html): renderer security options need deliberate configuration; source blocks are not trusted code.
- [MathJax mathematics](https://docs.mathjax.org/en/latest/basic/mathematics.html): delimiters and Markdown interactions need an explicit policy; single-dollar inline math is not enabled by MathJax by default.

Historical source references can be inspected without checking out old code: `git show <commit>:<path>`. In particular, see [the old interaction audit](https://github.com/gongahkia/hot-cross-buns/blob/25872ac/docs/testing/calendar-interaction-audit.md) and [historical performance methodology](https://github.com/gongahkia/hot-cross-buns/blob/25872ac/docs/performance/browser-workspace.md).
