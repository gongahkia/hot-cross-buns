# Shared Markdown editing

Notes, task notes in the task inspector, task notes created from Calendar, and
Calendar event descriptions now use `MarkdownEditor`. Quick Add captures a title
and scheduling instructions; recurrence lines are structured configuration; the
availability export is read-only. These are intentionally separate text fields.

The interaction model follows the modern Confluence editor: visual text with
Markdown input shortcuts, a persistent formatting toolbar, a selection toolbar,
and a searchable `/` block menu. See Atlassian's [Markdown and keyboard shortcuts](https://support.atlassian.com/confluence-cloud/docs/keyboard-shortcuts-markdown-and-autocomplete/)
and [toolbar behavior](https://support.atlassian.com/confluence-cloud/docs/how-to-use-the-new-toolbar-and-insert-elements/).
This is a local Markdown editor; Confluence collaboration, macros, Smart Links,
and its document format are outside this change.

## Editing behavior

- Inline bold, italic, strike, code and links; headings 1–6; bullet, numbered and
  nested action lists; quotes, dividers, code blocks, Mermaid and GFM tables.
- Type `# `, `1. `, `* `, `> `, `[] ` or a code fence to create blocks. Normal
  inline Markdown shortcuts work as text is typed. Tab/Shift+Tab indent/outdent
  lists; table navigation uses the editor's table keymap.
- `/` after a space or at the start of a block filters commands; arrows select,
  Enter/Tab insert, Escape dismisses. Unmatched queries allow normal Enter/Tab.
  Toolbar controls also support left/right and Home/End navigation.
  `@` opens the existing HCB/authorized Drive picker. `:` searches emoji. Source
  mode retains the same reference and emoji helpers.
- Cmd/Ctrl+K edits a link, or inserts a visible URL when nothing is selected.
  Pasting a URL over selected text links it. Markdown-only
  paste parses formatting; HTML paste uses the editor schema. Links accept HTTP,
  HTTPS, mailto, tel and relative paths. Executable links and local-file image
  sources are not activated.
- Text undo/redo belongs to the editor. Formatting commands consume their own
  shortcuts before planner navigation. Escape dismisses an editor menu before
  the inspector handles closing and saving.
- Table controls add/delete rows and columns or remove a table. Pasted merged
  cells, headerless tables, nested tables and rich cell blocks are retained with
  schema-generated HTML when GFM cannot represent them. Controls for creating
  merged cells and Confluence layout macros remain outside the toolbar.

## Data and implementation

`MarkdownEditor.tsx` loads the rich editor on demand. The ProseMirror-based engine
and its CSS remain outside the initial renderer entry. Tiptap packages are pinned
to 3.32.0. Its [Markdown bridge](https://tiptap.dev/docs/editor/markdown/getting-started/installation)
is documented as beta, so schema round trips and real Electron input flows are
part of the regression coverage.

`markdown/extensions.ts` owns the document schema and Markdown serialization.
Custom nodes retain the exact syntax of stable HCB references, transclusions,
HTML blocks/comments/declarations and footnotes. Unsupported HTML is inert source content;
use Source to edit its internals. Standard presentational Google HTML descriptions
are converted for visual editing using the same converter as previews.

Opening a document, moving the selection, changing editability, and switching
between Visual and Source emit no save. The original body remains authoritative
until a document change. An actual visual edit serializes the document as
Markdown, so whitespace and equivalent Markdown spellings can normalize at that
point. Source editing retains the exact text entered. Simple HTML descriptions
become Markdown after their first visual edit.

`ReferenceTextarea` supplies the shared reference picker, account scope gates,
recent references, native file upload and source editing. Its rich input adapter
uses document positions instead of slicing Markdown by visual caret position.
Direct uploads use the current selection, and late upload results use the newest
draft instead of replacing text typed while the upload was pending. Results for
disabled or unmounted fields do not mutate the document.
`mixedMarkup.ts` centralizes preview/editor conversion. Inspector text fields save when focus leaves the field or rich editor. Formatting controls remain part of the editor, so using them does not interrupt writing. Save serialization, failed-save recovery, pending-write draining and validation remain owned by the inspectors.

Unit tests cover schema round trips, untouched source, imported HTML, external
replacement, disabled controls, unsafe URLs, failed saves and in-flight saves.
The desktop flow covers the four surfaces, keyboard formatting, slash commands,
table changes, references, emoji, paste, nested lists, selection formatting,
undo/redo, local persistence and links without accidental parent-form submission.

## Interface review

Reviewed the note and Calendar task editor screenshots, actual Electron input,
and the shared styles. Other theme palettes and OS accessibility readers have
not been manually exercised.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Rendered headings, paragraphs, table cells, source, placeholder | Existing font/size tokens; semantic heading hierarchy |
| Surfaces | Note and Calendar task editor, toolbar, focus, menus, disabled state | Shared theme colors, structural borders, focus outline, 40px editor controls |
| Animations | Shared editor CSS and menu behavior | No custom animation on typing, selection or suggestions |
| Icons | Formatting, insertion and selection controls | Existing Lucide set, currentColor, consistent stroke |
| Performance | Lazy output chunks, task projection test, desktop typing | Engine deferred; metadata transactions do not trigger render loops; suggestion queries inspect only the caret's preceding 82 characters |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | Four `MarkdownEditor` call sites | Formatting was only visible in preview | Shared visual editing with source access | Consistent editing feedback across fields |
| HIGH | `RichMarkdownEditor.tsx` | Contenteditable could remain writable under a disabled fieldset | Explicit editor editability and disabled mutation controls | Saving state must prevent duplicate changes |
| HIGH | `extensions.ts` | A general serializer would escape HCB syntax or discard unsupported HTML | Explicit lossless, inert nodes | Preserve references and imported content |
| MEDIUM | `markdown-editor.css` | No common rich editor layout | Theme tokens, 40px toolbar targets and visible focus | Existing styling system and usable desktop hit areas |
| MEDIUM | `AppShell.tsx` | Global shortcuts could also consume editor commands | Respect prevented keyboard events | One keystroke should perform one action |
| MEDIUM | `ReferenceTextarea.tsx` | Picker could run below an inspector's scroll boundary | Picker overlays the field area | Keep reference choices reachable |
| MEDIUM | `RichMarkdownEditor.tsx` | Selection menu metadata could cause repeated rendering | Stable options and document/selection updates only | Keep routine editing responsive |

Considered and rejected: animations on every toolbar/selection change (frequent
motion), merged-cell controls (lossy Markdown), an eager editor import (startup
cost), and converting every imported HTML fragment (unsupported content loss).

Verdict: shared interaction and data-preservation checks pass. Signing/live Google
verification and quiet-machine scale benchmarks remain separate checks.

## Initial shared-editor verification on 2026-10-21

| Check | Result |
| --- | --- |
| Production build and both TypeScript configurations | Passed; no renderer circular-dependency warnings |
| Unit suite | 180 passed; 88 native database tests intentionally run separately |
| Native database/sync integration suite | 88 passed |
| Electron desktop smoke suite | All 8 passed in the final combined run |
| Deferred diagnostics startup fixture | Also passed 3 consecutive repetitions after synchronizing onboarding and allowing normal desktop shutdown |
| Unsigned macOS package | ASAR launch, deferred editor, SQLite worker, backups, menu/deep link, tray, shortcut, restart, and schema upgrade passed |
| Startup profile | Fresh/cached packaged pair recorded; busy-host measurements, not a release performance claim |

The desktop flow typed 49 characters into a 69 KB note, observed at 1,412 ms in
the final run including Playwright input overhead. Earlier busy-host runs ranged
from 2,905 to 5,347 ms. These observations establish functional large-document
editing, not a controlled typing-latency benchmark. Existing benchmark ceilings
were not changed. README.md was not edited.


## Interoperability and recovery follow-up

The follow-up adds a representative Google Docs/Confluence clipboard corpus:
Docs span-based bold/italic, Confluence document wrappers, ordered and nested
lists, links, merged/headerless/nested tables, multiple cell paragraphs, and
multiline code cells. These are local HTML fixtures; they are not a claim that a
current signed-in provider account was used to capture or verify every paste
format. Provider macros, comments, collaboration state, styles outside the
schema and proprietary embedded content are not imported as equivalent features.

Simple tables continue to use GFM. More complex tables serialize as escaped,
schema-generated HTML carrying `data-hcb-table="true"`, and reopen as editable
tables. Arbitrary external HTML tables remain inert source in the editor so
unrecognized attributes/content are preserved. Preview renders table structure
through an explicit element/attribute allowlist, retaining spans, lists, code,
links and planner references without mounting provider HTML. The table helpers
used by preview do not import the rich editor engine.

Imported simple HTML now retains literal Markdown punctuation, ordered-list
starts, nesting, inline backticks and blank lines in code blocks. Mixed-markup
preview shields fenced and inline code, including unfinished fences, before HTML
conversion. HTML examples remain literal code.

Unchanged Visual/Source switches create no undo entry. Source changes become a
separate rich-editor undo group on return, preserving preceding visual history;
native text undo remains available while editing source. An external document
replacement resets rich history without saving, so undo cannot resurrect an old
document. These operations are covered at both schema and renderer levels.

Suggestions expose their listbox and active option to the input and scroll the
selected option into view. Source emoji options use 40px targets. Enter, Tab and
arrows used during text composition do not accept suggestions or run rich-editor
keymaps. The keydown handler leaves the browser's native composition handling
available. Closed menus do not access editor views during Suspense unmount/remount;
mounted inputs are
resolved through the actual field DOM. Pointer movement selects options without
letting a stationary pointer undo keyboard selection during scrolling.

### Follow-up interface review

Full review of the changed React/Tailwind/CSS surfaces: shared suggestions,
Source/Visual history controls, rich table editing/preview, and Diagnostics sync
comparison. Existing color, typography and button conventions were retained.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Long comparison notes, field labels, tables and source examples | Wrapping and inherited tokens; counts use tabular numbers |
| Surfaces | Formatting menus, source emoji options, comparison loading/error/disabled states | Existing borders and buttons; 40px suggestion targets |
| Animations | Shared menu hook and new comparison component | No custom animations introduced; slow-motion inspection is not applicable |
| Icons | Existing editor/Diagnostics controls | Existing Lucide icons retained; no additional icon set |
| Performance | Renderer output, review pagination and snapshot lifetime | Rich engine remains deferred; reviews render 20 items and cache fingerprints |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `SyncResolutionControl.tsx`, `googleSync.ts` | One-click recovery lacked a remote comparison and affected count | Reviewed local/Google fields, explicit choice/count, failures retain review | Decisions need visible scope and recoverable error states |
| HIGH | `RichMarkdownEditor.tsx`, `suggestionAccessibility.ts` | Closed menus could read an unmounted editor view | DOM binding only for active suggestions | Editor lifecycle must not blank the workspace |
| HIGH | `RichMarkdownEditor.tsx` | Composing Enter could still run a paragraph-splitting keymap | Skip editor keymaps while allowing native composition | Input methods must commit text without changing document structure |
| MEDIUM | Shared rich/source suggestion controls | Active options lacked input relationships and could scroll out of view | Stable IDs, active-descendant relationships, reveal selected option | Keyboard choices must stay perceivable |
| MEDIUM | `EmojiTextField.tsx` | Source emoji choices had 32px minimum height | 40px options | Desktop hit areas match editor controls |
| HIGH | `tables.ts`, `HtmlTablePreview.tsx` | GFM lost rich table structure on save/reload | Safe HTML fallback with editable round trips and allowlisted preview | Content fidelity and safe rendering |
| MEDIUM | `history.ts`, `mixedMarkup.ts` | Mode switches/external replacements polluted undo; imported literal text could change meaning | Explicit history boundaries and structural HTML conversion | Editing behavior must remain predictable |

Considered and rejected: a new styling system (existing tokens suffice), eager
rich-editor loading for table previews (startup cost), title-based automatic task
adoption after a lost creation response (ambiguous identity), and custom menu
animations (frequent interaction with no useful motion signal).

Manual OS input-method and screen-reader validation, provider-specific clipboard
formats beyond this corpus, and other platform/theme combinations remain
unverified. Automated Chromium composition is narrower than an OS-native IME
session. Live Google verification remains a separate disposable-account check.

### Follow-up verification on 2026-10-21

The final combined `test:release-gate` run passed against the same production
build used for all desktop tests:

| Check | Result |
| --- | --- |
| Production build and both TypeScript configurations | Passed; no renderer circular-dependency warnings; rich editor stays deferred |
| Unit suite | 207 passed; 116 native database tests run separately |
| Native database/sync integration suite | All 116 passed |
| Electron desktop smoke suite | All 9 passed sequentially on the shared desktop |
| Clipboard/history/composition desktop flow | Complex table spans, nested content, Visual/Source undo, active-option scrolling, composing Enter, Chromium Japanese composition, SQLite save and preview reopen passed |
| Large-note lifecycle regression | 69 KB note editing and app restart passed without renderer page errors |
| Rebuilt unsigned macOS package | ASAR launch, deferred rich editor, SQLite worker, backup integrity, native menu/deep link, tray/shortcut, restart persistence and v8→v9 upgrade passed |

The 49-keystroke large-note observation was 1,591 ms including Playwright input
overhead on this busy host. It is a functional check, not a controlled latency
benchmark. Screenshots of the rich table editor and reopened preview were
inspected. No additional visual changes were needed after this review.

Verdict: the automated recovery and interoperability checks pass within the
documented scope. Manual OS input-method/screen-reader checks and live Google
verification remain unperformed. README.md was not edited.
