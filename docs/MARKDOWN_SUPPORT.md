# Markdown support and verification

Planner.md remains exact source. Parsing a construct does not imply that every view renders it or offers a visual editing control. Source editing and whole-body Markdown editing preserve unsupported syntax rather than converting it to another format.

| Construct | Preserved | Parsed | Current body rendering | Editing |
| --- | --- | --- | --- | --- |
| Paragraphs, headings, emphasis, strong, strikethrough, inline code | Yes | Yes | Yes | Markdown source / body draft |
| Soft and hard breaks, escapes, entities, Unicode | Yes | Yes | Yes | Markdown source / body draft |
| Ordered lists, nested lists, task lists, blockquotes, thematic breaks | Yes | Yes | Yes; body checkboxes are read-only | Markdown source / body draft; format-2 outlines have task controls |
| Fenced and indented code | Yes | Yes | Literal code; no highlighting yet | Markdown source / body draft |
| Inline links and autolinks | Yes | Yes | Safe HTTP(S), mail and fragment links | Markdown source / body draft |
| Reference links | Yes | Yes, document-wide | Yes, including definitions outside the body | Markdown source / body draft |
| GFM tables and alignment | Yes | Yes | Yes | Markdown source / body draft |
| GFM footnotes | Yes | Yes, document-wide | Numbered references, definitions and return links | Markdown source / body draft |
| Images | Yes | Yes | Description and explicit HTTP(S) image loading; no automatic fetch | Markdown source / body draft |
| Raw HTML | Yes | Yes | Literal source; never executed | Markdown source / body draft |
| Callouts, mathematics, Mermaid | Yes | Source retained | Rich processing in progress | Markdown source / body draft |
| Entry and heading navigation, backlinks, link suggestions | Yes | Entry targets diagnosed; heading/link index available | Navigation integration in progress | Markdown source / body draft |

## Shared grammar and rendering data

`src/markdown.ts` owns the CommonMark/GFM/frontmatter grammar used by the planner and local previews. The planner's existing parse produces a document-wide definition, footnote, heading and link index, plus compact render trees for saved body blocks. Heading anchors use the separate `heading-` namespace, with deterministic suffixes for duplicates. Entry anchors retain `hcb-` identities.

Render trees are capped at 32 levels, 2,000 nodes per preview, 40,000 source characters per block, 20,000 retained model nodes and 2,000 selected model blocks. Exceeding a rendering budget leaves exact source available. These limits are separate from the existing 5 MiB / 100,000-line document ceiling. Indexes and previews are derived data; they never replace the canonical source, database version 4 or revision protocol 2.

Saved body previews use immutable render trees from the planner's parse, including after worker adoption. Source references map each projected body block to that tree; repeated lookups reuse one document-scoped mapping. Local draft parsing uses the same grammar and document reference context. Appended reference context is excluded from preview output; unfinished code fences and HTML retain their original content instead of swallowing that context.

Body footnotes use instance-scoped DOM identities with keyboard-focusable destinations and return links for each occurrence. Remote images require an explicit click, use no-referrer requests and retain retry controls on failure. Raw HTML stays literal and unsupported URL schemes stay inert.

## Live body blocks

Expanded notes render inactive body blocks. A contextual pencil control edits one block in place while its siblings remain rendered; **Edit notes** retains whole-body Markdown editing. Draft typing and live preview remain local until **Save notes** (or Command/Control+Enter) validates the full candidate through the normal edit queue. Composition cannot submit a draft. Native textarea selection and undo stay separate from journal undo, and save/cancel restore keyboard focus.

Block edits retain each sibling's source identity. Removing a block patches only its old range, without moving the remaining blocks into earlier ranges. Draft checkpoints retain the active block and exact full-source baseline across reload. Stale/invalid drafts remain editable and downloadable; a checkpoint failure is reported without discarding the in-memory draft. Saving still requires the original source and title, and the existing editing lease remains active for dirty or stale drafts.

## Tests

`tests/markdown.test.mjs` exercises curated CommonMark/GFM examples, document-wide references, immutable render-tree reuse, BOM and all supported line endings, heading identities, hostile URLs/labels, rendering limits, and 120 deterministic source edits across nested outlines, references, fences and Unicode. `markdown-render.spec.ts` checks actual saved rendering, alignment, reference/footnote navigation, opt-in image requests, inert unsafe content and phone overflow. `markdownPlanner`, `journalDocument`, `outline` and background-worker tests separately cover planning semantics, exact edits, source ownership, validation and worker adoption. The curated corpus is not a claim of complete CommonMark conformance or Obsidian/Notion extension compatibility.

## Remaining implementation and acceptance

- Cache unchanged block rendering across revisions after measuring the invalidation and copying costs.
- Extend source-aware block access to ordinary document prose and navigation targets outside entry notes.
- Add entry/heading navigation, backlinks and link suggestions without a persistent sidebar or toolbar.
- Add lazy syntax highlighting, callouts, bounded mathematics and isolated Mermaid, retaining safe source fallback.
- Measure parsing, worker message copying, React commit work and durable saving separately on 1,000- and 10,000-entry journals. Evaluate revision patches and incremental parsing against the complete parser, including distant references, fences and section changes.
- Verify the final UI at desktop and phone sizes and run the repository's full verification command. Keep README.md unchanged.
