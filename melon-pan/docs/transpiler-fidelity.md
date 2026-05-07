# MD ↔ Docs Transpiler Fidelity

A practical map of what the v1 transpiler converts cleanly, what it
flags lossy, and what it doesn't model. Fidelity warnings produced
during parse and during plan generation surface in `meta.json`, the
sync journal, and the macOS conflict view so concerns are visible
*before* a push silently drops content.

## Coverage matrix

| Markdown construct | Docs construct | Round-trip |
|---|---|---|
| `# Heading` (1–6) | `paragraphStyle.namedStyleType: HEADING_1..6` | ✅ stable |
| Paragraph | `paragraph` (default named style) | ✅ stable |
| `**bold**` | `textStyle.bold: true` | ✅ stable |
| `*italic*` | `textStyle.italic: true` | ✅ stable |
| `~~strike~~` | `textStyle.strikethrough: true` | ✅ stable (GFM-only on render) |
| `<u>under</u>` | `textStyle.underline: true` | ⚠️ HTML in MD, no CommonMark equivalent |
| `<sub>x</sub>` / `<sup>x</sup>` | `textStyle.baselineOffset` | ⚠️ HTML in MD, no CommonMark equivalent |
| `` `code` `` | mono-family textStyle | ✅ stable when fontFamily contains "mono"/"code" |
| `[label](url)` | `textStyle.link.url` | ✅ stable |
| Unordered / ordered list | `createParagraphBullets` with bullet preset | ✅ structure stable |
| Nested lists | bullet `nestingLevel` | ✅ structure stable |
| Pipe table | `insertTable` + per-cell `insertText` (two-pass push) | ⚠️ inline cell formatting is flattened to plain text |
| `---` horizontal rule | paragraph with `horizontalRule` element | ✅ stable |
| `![alt](url)` | `inlineObjectElement` referencing image embeddedObject | ✅ on pull (read-only); upload-on-push not yet wired |
| Footnote ref `[^id]` | `footnoteReference` element | ⚠️ marker only — body text not rendered |
| Page break (in input) | `pageBreak` element | ⚠️ collapses to a paragraph break |

## What's surfaced as a warning during parse

When parsing a Docs document, `ParsedDocsDocument.fidelity` collects
warnings for every construct that doesn't fit cleanly. Each warning
carries one of three kinds:

- **`UnsupportedConstruct`** — content is dropped on push. Fix the
  Docs body, accept the loss explicitly, or wait for a future v2.
- **`LossyApproximation`** — content survives push but its shape
  changes (smart chips → plain text, footnote bodies → markers, named
  ranges → text-only).
- **`LosslessApproximation`** — content uses a non-CommonMark MD
  syntax (HTML tags for underline / sub / sup; GFM strikethrough)
  that round-trips through our parser but won't render the same in a
  pure-CommonMark renderer.

Currently surfaced concerns:

- **Headers / footers**: `UnsupportedConstruct`. Full-body replace
  drops them on push.
- **Footnotes**: `LossyApproximation`. Body markers `[^id]` survive;
  the footnote text doesn't.
- **Named ranges**: `LossyApproximation`. Anchors used by comments,
  Apps Script, and Drive sharing; push preserves text but indices
  shift, so anchored content may need re-binding.
- **Suggestions / tracked changes**: `UnsupportedConstruct`. Treated
  as committed text on parse.
- **Table of Contents**: `UnsupportedConstruct`. Dropped on parse;
  next push won't re-include it.
- **Equations**: `UnsupportedConstruct`. v1 transpiler drops contents
  on push.
- **Person smart chips** (`personLink`): `LossyApproximation`.
  Flattens to plain link text on push.
- **Smart links** (`richLink`): `LossyApproximation`. Plain URL on
  push.
- **Column breaks**: `UnsupportedConstruct`. Multi-column layout is
  not modelled.

## What's surfaced as a warning during plan generation

Calling `markdown_to_docs_plan(md)` returns a `DocsUpdatePlan` whose
`fidelity` field carries plan-side warnings:

- **GFM tables present**: `LossyApproximation`. The plan emits
  `InsertTableAtEnd { rows, cols }` requests followed by per-cell
  `InsertCellText` requests in a two-pass push. Cell content is
  inserted as plain text — inline `**bold**`, links, etc. inside cell
  copy don't carry forward.

## Round-trip stability

Two test surfaces guard against regressions:

- `each_corpus_case_renders_to_expected_markdown` — every
  `tests/transpiler-corpus/<case>/input.docs.json` parses to the
  exact bytes of `expected.md`. Catches drift on the docs→md path.
- `docs_to_markdown_is_idempotent_under_round_trip` — rendering the
  parsed model and re-rendering it must produce identical Markdown.
  Guards against transient state in render functions.
- `markdown_plan_coverage::*` (8 tests) — each corpus expected.md
  generates a plan emitting the expected request kinds (heading,
  bullet, ApplyTextStyle, link). Catches drift on the md→Docs path.
- `parse_surfaces_fidelity_warnings_for_unsupported_constructs` —
  synthetic doc with headers/footnotes/namedRanges/personLink must
  produce a non-empty `fidelity.warnings` so we know parse-side
  detection is wired.

## Closed gaps (v2 fidelity pass)

1. ✅ **Image upload on push**: `InsertInlineImage` BatchRequest
   variant; `markdown_to_docs_plan` strips `![alt](url)` out of the
   inserted text and emits per-image `insertInlineImage` requests in
   descending index order.
2. ✅ **Cell-internal formatting on push**: `MarkdownTable` carries
   parallel `cell_styles`. A third batchUpdate pass (gated on
   presence of any cell style) does a fresh GET, learns each cell's
   text-run startIndex via `extract_table_cell_text_starts`, then
   issues per-cell `updateTextStyle` requests so bold/italic/code/
   link round-trip through table cells.
3. ✅ **Footnote body rendering on pull**: `DocsDocument.footnotes`
   parsed from the top-level `footnotes` object. `docs_to_markdown`
   emits a `## Footnotes` section with `[^id]: body text` entries.
4. ✅ **Setext headings**: `normalize_setext_headings` pre-pass
   converts `Heading\n===` / `Heading\n---` to ATX before line
   scanning. Conservative — refuses when above-line is empty,
   already a heading, list, blockquote, or table.
5. ✅ **YAML frontmatter** (closed in earlier sync work): persisted
   at `<doc>/frontmatter.yaml`. Pull re-prepends; push captures
   live YAML as authoritative. Inline-YAML conflict guard avoids
   silent shadowing.
6. **Comments preservation**: Pre-push snapshot at
   `<doc>/named-ranges.json` (id, name, indices, anchor text).
   Post-push pass searches the new body for each anchor's text;
   misses emit a per-range `LossyApproximation` warning. Full
   `createNamedRange` reanchoring (and the named-range *diff*
   push strategy from §4.1 (b)) remains a follow-up.

## Pass-through approximations

- **Equations**: pull emits `$$equation$$` placeholder; Docs API
  v1 doesn't expose equation source so the actual LaTeX isn't
  recovered.
- **Column breaks**: pull emits `<!-- column-break -->` HTML
  comment; push doesn't re-inject column breaks.
- **Table of Contents**: dropped on parse; regenerable via Docs
  Insert menu after the next push (treated as Lossless since
  nothing meaningful is lost).

## Recommendation

For most authoring workflows the v1 surface is enough — Markdown
edits round-trip through Docs cleanly. The flagged concerns matter
when:

- Pushing into a Doc that already has comments / suggestions / smart
  chips that other collaborators use.
- Working with documents that mix hand-typed body content with
  Apps Script-generated structure (named ranges as anchors).
- Importing Obsidian vaults with frontmatter.

In those cases, the warnings panel on the Inbox page tells you
exactly what'll happen before you click Push.
