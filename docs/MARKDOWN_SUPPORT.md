# Markdown support and verification

Planner.md remains exact source. Parsing a construct does not imply that every view renders it or offers a visual editing control. Source editing and Markdown drafts preserve unsupported syntax rather than converting it to another format. Format-3 dated documents, undated documents and quick capture share the same rendered blocks, local editor and rich-content processing. New workspaces use format 3; older journals retain their grammar until a previewed upgrade.

| Construct | Preserved | Parsed | Current body rendering | Editing |
| --- | --- | --- | --- | --- |
| Paragraphs, headings, emphasis, strong, strikethrough, inline code | Yes | Yes | Yes | Markdown source / body draft |
| Soft and hard breaks, escapes, entities, Unicode | Yes | Yes | Yes | Markdown source / body draft |
| Ordered lists, nested lists, task lists, blockquotes, thematic breaks | Yes | Yes | Yes; format-3 saved document checkboxes are interactive, including ordered-list and capture checkboxes | Shared document draft; contextual child/conversion/movement controls for planner outlines; legacy body previews retain read-only checkboxes |
| Fenced and indented code | Yes | Yes | Lazy highlighting for registered common languages; exact text fallback | Markdown source / body draft |
| Inline links and autolinks | Yes | Yes | Safe HTTP(S), mail and fragment links | Markdown source / body draft |
| Reference links | Yes | Yes, document-wide | Yes, including definitions outside the body | Markdown source / body draft |
| GFM tables and alignment | Yes | Yes | Yes | Markdown source / body draft |
| GFM footnotes | Yes | Yes, document-wide | Numbered references, definitions and return links | Markdown source / body draft |
| Images | Yes | Yes | Description and explicit HTTP(S) image loading; no automatic fetch | Markdown source / body draft |
| Raw HTML | Yes | Yes | Literal source; never executed | Markdown source / body draft |
| Callouts | Yes | Render-only quote extension | Neutral callouts, optional native folding | Markdown source / body draft |
| Mathematics | Yes | Render-only `$$` extension and math/latex/tex code fences | Lazy, bounded KaTeX with MathML accessibility | Markdown source / body draft |
| Mermaid | Yes | Mermaid code fences | Lazy sandboxed diagram or source fallback | Markdown source / body draft |
| Entry and heading navigation, backlinks, link suggestions | Yes | Document-wide entry, heading and actual backlink indexes | Cross-view navigation, heading deep links and collapsed linked mentions | Contextual link picker while editing Markdown |

## Shared grammar and rendering data

`src/markdown.ts` owns the CommonMark/GFM/frontmatter grammar used by the planner and local previews. The planner's existing parse produces a document-wide definition, footnote, heading and link index, plus compact render trees for saved body blocks. Heading anchors use the separate `heading-` namespace, with deterministic suffixes for duplicates. Entry anchors retain `hcb-` identities.

Render trees are capped at 32 levels, 2,000 nodes per preview, 40,000 source characters per block, 20,000 retained model nodes, 2,000 selected model blocks and 100 rendered footnote definitions. Exceeding a rendering budget leaves exact source available; footnote references beyond the definition limit stay literal rather than pointing to missing destinations. These limits are separate from the existing 5 MiB / 100,000-line document ceiling. Indexes and previews are derived data; they never replace the canonical source, database version 4 or revision protocol 2.

Saved body previews use immutable render trees from the planner's parse, including after worker adoption. Source references map each projected body block to that tree; repeated lookups reuse one document-scoped mapping. Local draft parsing uses the same grammar and document reference context. Appended reference context is excluded from preview output; unfinished code fences and HTML retain their original content instead of swallowing that context.

Body footnotes use instance-scoped DOM identities with keyboard-focusable destinations and return links for each occurrence. Remote images require an explicit click, use no-referrer requests and retain retry controls on failure. Raw HTML stays literal and unsupported URL schemes stay inert.

## Rich processing

Code and math processing use a separate rendering worker, leaving the journal validation worker independent. Code highlighting accepts at most 12,000 characters, 3,000 output nodes and 32 levels; formulas accept at most 2,000 characters, 100 macro expansions and size 10. Output is capped at 500,000 characters, with eight outstanding requests and a three-second worker deadline. Worker failures or limits retain exact source. Thirty-two cached results (at most 1,000,000 source/output characters) reuse unchanged code/formulas across document revisions. Identical pending work is deduplicated, and offscreen content waits until it approaches the viewport.

The math rendering extension supports `$$x_i$$`, standalone double-dollar blocks and `math`, `latex` or `tex` code fences. Single dollar signs remain literal currency text. Escaped delimiters and code stay literal. Container prefixes and line endings map back to original UTF-16 ranges. Reference definitions outside a math-containing paragraph remain available, while links inside math do not become backlinks. This is a render-only extension of the shared Markdown model: it does not reinterpret the version-1/2 planning grammar, entry metadata or canonical source. KaTeX receives `trust: false`, a fresh macro environment and bounded expansion; its code and styles load only for visible formulas.

The `micromark-extension-math` dependency uses the application's patched KaTeX through a scoped npm override. Its older declared KaTeX range otherwise installs a version affected by [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7). The override retains the parser and its grammar rather than downgrading remark-math.

Callouts use `> [!note] Title` (including custom types); `+`/`-` after the marker controls initial folding. Their content keeps normal Markdown rendering and uses the existing neutral surface, with no outline-menu actions.

Mermaid uses a bundled classic script in an opaque `sandbox="allow-scripts"` frame. Source arrives through `postMessage`, never interpolated into the frame's HTML. Rendering uses strict security, disabled diagram-supplied configuration, at most 6,000 characters, 120 line/statement separators and 100 edges. Frame CSP blocks connections, external images, forms and base URL changes. Load and processing deadlines retain downloadable/editable source on failure. The optional Mermaid asset is about 5.5 MB before compression; it is not fetched for collapsed notes or offscreen diagrams. A frame plus input/complexity limits isolates document access, but is not a cross-browser guarantee of separate-process CPU scheduling.

## Live body blocks

In format 3 these controls operate directly on date, undated-document and capture blocks, with no Notes wrapper. Inactive content renders normally; contextual actions open one local Markdown draft and live preview. **Start writing**/**Add writing** accepts prose, headings, tables, code and mixed outlines directly. Outline menus use one **Add child**, plain/task conversion and a **Move…** group. Structured recurring-entry actions open the occurrence inspector and retain scope review. Entry/heading links and linked mentions focus the direct document destination; a full-source conflict keeps the old draft recoverable.

In the retained legacy editor, expanded notes render inactive body blocks. A contextual pencil control edits one block in place while its siblings remain rendered; **Edit notes** retains whole-body Markdown editing. Draft typing and live preview remain local until **Save notes** (or Command/Control+Enter) validates the full candidate through the normal edit queue. Composition cannot submit a draft. Native textarea selection and undo stay separate from journal undo, and save/cancel restore keyboard focus.

Block edits retain each sibling's source identity. Removing a block patches only its old range, without moving the remaining blocks into earlier ranges. Draft checkpoints retain the active block and exact full-source baseline across reload. Stale/invalid drafts remain editable and downloadable; a checkpoint failure is reported without discarding the in-memory draft. Saving still requires the original source and title, and the existing editing lease remains active for dirty or stale drafts.

## Tests

`markdownNavigation.ts` maps entry/heading targets to owning dated or undated entries, resolves encoded Unicode fragments, records actual inline/reference backlinks, and retains exact source destinations for prose/scratchpad links. Heading identities remain distinct even when duplicate suffixes collide with literal numbered titles. Links reveal the target view/notes and move keyboard focus; fragment destinations survive reload. Linked mentions remain collapsed in an outline and return to the referring body passage. A dirty draft blocks navigation until saved, downloaded or cancelled.

**Insert link** (or Command/Control+K in a Markdown notes field) offers bounded entry/heading suggestions without adding commands to item menus. Native text insertion preserves input undo. Missing entry IDs and the referring edit commit together against the full-source baseline, including recovered drafts; undone/removed draft links do not require ID insertion. A missing target inside the same enclosing raw source list must be saved/identified first rather than guessing its identity after an arbitrary list rewrite.

Root prose and scratchpad link destinations open a focused passage using the same block editor. Worker validation checks the full candidate and rejects changes that reinterpret entries outside the selected block. Source access, draft download/recovery and the existing journal undo path remain available. `markdown-navigation.spec.ts` covers cross-view links, linked mentions, reloadable heading links, exact prose edits, native link-insertion undo and recovered atomic ID insertion.

`tests/markdown.test.mjs` exercises curated CommonMark/GFM examples, document-wide references, immutable render-tree reuse, BOM and all supported line endings, heading identities, hostile URLs/labels, rendering limits, and 120 deterministic source edits across nested outlines, references, fences and Unicode. `markdown-render.spec.ts` checks actual saved rendering, alignment, reference/footnote navigation, opt-in image requests, inert unsafe content and phone overflow. `markdownPlanner`, `journalDocument`, `outline` and background-worker tests separately cover planning semantics, exact edits, source ownership, validation and worker adoption. The curated corpus is not a claim of complete CommonMark conformance or Obsidian/Notion extension compatibility.

## Performance and acceptance

The [performance report](PARSER_PERFORMANCE.md#browser-measurements) separates parser work, worker transfer round trips, model adoption, React commit work and durable saving for 1,000 and 10,000 entries. It includes before/after data and the deliberately limited incremental-title experiment. Saved body trees reuse source identities within a document; unchanged code/formula results also reuse a bounded cache across revisions. General arbitrary-edit incremental parsing remains future work, with full validation retained in production.

Desktop and phone browser tests cover rendered content, local editing, navigation and rich fallbacks. Final acceptance uses `npm run verify`; its dependency audit is independent of Markdown behavior. README.md stays unchanged during this transition.
