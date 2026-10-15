# TODO.txt import doctor

The doctor runs before an import changes Hito's IndexedDB working copy. It shows the imported file and a separate editable working copy. It never rewrites the file you selected. Only **Apply import** changes the browser journal. If both the browser journal and file changed the same item, a separate merge review follows the format review.

The doctor proposes narrow repairs when the intended structure is recognizable. Every proposal is shown with its original and replacement text. You can edit the working copy, then choose **Check file** to run the doctor again. You can cancel without applying anything.

| Input pattern or problem | Doctor result | Why |
| --- | --- | --- |
| Recognizable `@repeat:` rule with extra indentation, tabs, or different marker case, such as `\t@REPEAT: daily` | Proposes `  @repeat: daily` | A valid rule can keep its meaning with the canonical marker. The rule value stays as written. |
| Valid `@completed:` date with noncanonical indentation or marker case | Proposes `  @completed: YYYY-MM-DD` | The date value stays the same. |
| Indented checkbox detail, such as `  - [ ] check soil` | Proposes `- [ ] check soil` | A visible checkbox detail marker identifies the intended structure. |
| Checkbox detail without the usual spaces, such as `-[ ] task` or `- [ ]task` | Proposes `- [ ] task` | The checkbox remains in the same state. Review the proposed text before importing. |
| Date contains items but no blank completed/upcoming divider | Requires **mark this day upcoming** or **mark this day done** | The doctor cannot infer item status from a missing separator. It inserts the divider only after your choice. |
| Completed recurring item has no `@completed:` date | Requires the actual completion date | Inferring a date from the heading or import time would create the wrong next occurrence. |
| Completed short-form recurring rule has no `series` and `occurrence` | Offers **start a new series here**, or you can edit the working copy to link an existing series | A stable occurrence identity prevents duplicates after reimport. Starting a series appends a generated readable identifier and `occurrence 1`. |
| Invalid date, duplicate heading, malformed metadata or repeat rule, invalid time range, orphan detail, duplicate occurrence, or completion date on an upcoming item | Shows a line-numbered error; import stays blocked | These cases cannot be repaired safely from the text alone. Edit the working copy and check it again. |
| Empty valid date heading | Keeps the heading | An empty date is intentional journal structure. |

## Editing rules

- Date headings use `YYYY-MM-DD` and must occur once per file.
- Metadata begins with exactly two spaces. Detail lines begin at the left margin. Put `\` before a line that should be a literal item title even though it resembles a date, detail, or metadata marker.
- A blank line separates completed items above from upcoming items below. Keep it even when one section has no items.
- A completed recurrence needs its actual `@completed:` date and a stable `series` plus one-based `occurrence` to reconstruct the next item across machines or imports. If an existing successor belongs to the same series, preserve its identity and increment the occurrence number. Do not select **start a new series here** to link an existing one.
- The doctor does not discard invalid lines, invent task text, infer completion times, or silently choose a side in an item merge.
