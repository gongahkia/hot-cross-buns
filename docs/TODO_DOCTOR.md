# Markdown import review

The import doctor validates [Planner.md](MARKDOWN_FORMAT.md) before changing the durable browser journal. Its filename remains for existing links; it no longer repairs the historical TXT syntax. Ordinary imports do not write the selected file. Linking or reviewing a linked target permits later saves only after explicit approval; cancelling leaves the source and journal intact.

Review keeps the exact original source alongside an editable working copy, with complete original and working-source downloads. **Check file** reruns validation without committing. **Apply import** is the explicit commit. No guessed checkbox state, completion date, ID repair or metadata normalization is applied automatically. Invalid/unsupported source remains recoverable. Session checkpoints retain working review drafts across reload for download; they are not automatically applied to a newer journal.

| Finding | Behavior |
| --- | --- |
| Missing/unsupported `hcb-format`, invalid document identity or reserved section structure | Show diagnostics and block import until the working source is corrected. Keep the original available. |
| Invalid date/time/span, repeat, completion date, skip or replacement | Require explicit source correction; do not guess scheduling intent. |
| Duplicate IDs, series/occurrences/replacements, unknown planning fields or malformed/unclosed metadata | Block structured use; preserve source for a compatible reader or manual correction. |
| Parent/detail checkbox disagreement or undated completion state | Require explicit correction of the checkboxes; do not infer done/open from blank lines. |
| Broken `#hcb-` link or inert `hcb` example outside a direct planning entry | Warn without discarding or activating the source. |
| Ordinary prose, tables, comments, code, unfamiliar Markdown or empty date headings | Retain source; do not format the whole file or flatten bodies into task titles. |
| Invalid Unicode, file above 5 MiB or more than 100,000 logical lines | Reject before parsing; the selected external file remains untouched. |

Applying valid source may open whole-document conflict review. It offers browser/file choice, a narrow **keep both** for one safe non-recurring entry, or manual source merging. It does not merge arbitrary content by task-array index. See [source conflict policy](MARKDOWN_RUNTIME.md#conflicts-and-recovery).

Approval rechecks observed target bytes, the saved browser source, link generation and selected immutable branch. A stale review or failed IndexedDB transaction does not partially commit the journal/link/baseline. Applied linked-file repairs retain original observed contents in comparison recovery. Downloads and validation do not advance sync baselines. Protected targets publish a complete protocol-2 revision before the projection write; external edits overwritten before observation remain outside that protection.
