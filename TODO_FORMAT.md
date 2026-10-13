# Hito TODO.txt format

`TODO.txt` is Hito's portable, human-readable journal. It is UTF-8 plain text. Hito keeps a browser working copy and writes the file when you download it or explicitly save a connected file. The file contains the complete meaning of tasks, details, time blocks, and recurrence; none of those require hidden browser-only metadata.

## Example

```text
2026-10-13
09:00-09:30 Team sync #work
  @repeat: weekdays
- [x] share update

Water plants
  @repeat: every 3 days after completion
- [ ] check soil

2026-10-14

14:00-15:30 Write report
```

Each section begins with a valid `YYYY-MM-DD` date. Within a day, completed items come first, then one blank line, then upcoming items. Hito writes that canonical arrangement when exporting. Each item is one nonempty line. It can be a task or an appointment; both use the same completion circle. A normal item has no required prefix.

### Details

Detail lines begin with `- [ ] ` or `- [x] `, directly under their parent item (possibly after its repeat rule). The checkbox records that detail's state. Legacy `- detail` lines are also accepted and inherit their parent's state. Completing a parent completes all details; reopening it reopens all details. Completing the last detail completes the parent.

### Time blocks

An optional `HH:MM-HH:MM ` prefix gives an item a time block on its heading's date:

```text
09:00-10:30 Review drafts
```

Use 24-hour local wall time, leading zeroes, a plain hyphen, and an end time later than the start. Blocks stay within one date. Hito shows the range beside the item and offers an editor; exporting writes the same prefix. The range does not itself create an alarm, invitation, or separate event type. An item without a range is an all-day or floating item on that date.

### Recurrence

A repeat rule is an optional metadata line, indented by exactly two spaces, below its item and before any blank divider. It can appear before or after detail lines; Hito writes it before details. Supported rules are:

```text
  @repeat: daily
  @repeat: weekdays
  @repeat: weekly on mon, wed, fri
  @repeat: monthly on 15
  @repeat: yearly on 10-13
  @repeat: every 3 days after completion
  @repeat: every 2 weeks after completion
  @repeat: every 1 month after completion
  @repeat: every 1 year after completion
```

Day names are `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`. An after-completion interval can be 1–999 days, weeks, months, or years. Hito accepts rule text without regard to letter case and exports the spelling shown above. An item can have one repeat rule.

**Every rule creates only one next item when the current item becomes complete.** Hito never fills all future dates or recreates instances just because it reads an older completed line. Fixed rules (`daily`, `weekdays`, `weekly`, `monthly`, `yearly`) find the first matching date after completion, skipping missed dates. Interval rules calculate from completion: completing `every 3 days after completion` on October 13 creates one item on October 16. Completion before an item's scheduled day uses that scheduled day as the earliest starting point.

The completed occurrence remains in its day, including its repeat rule and completed details. The new occurrence has the same title, time block, and rule, with fresh unchecked details. An item completed from its main circle, its last detail, a drag into Done, or an imported file change to a previously pending item follows the same rule. Completion and next-item creation form one undoable change. Reopening an older occurrence later does not erase a later occurrence; use Undo to reverse an accidental completion immediately.

For `monthly on 31`, months without a 31st are skipped. For `yearly on 02-29`, non-leap years are skipped. After-completion month/year intervals clamp the destination to that month's last day (January 31 plus one month becomes February 28 or 29).

### Plain-text editing and round trips

The date heading, item line, optional repeat metadata, and detail lines are the source of task meaning. A human can edit them in any text editor, then import or reopen the file. Invalid dates, malformed repeat rules, orphan details, and invalid time ranges are reported instead of silently becoming another kind of entry. Hito may normalize spacing, line order, rule casing, and legacy detail markers on export; it preserves the task meaning.

The parser and serializer are in [`src/todoText.ts`](src/todoText.ts). Recurrence calculation is in [`src/recurrence.ts`](src/recurrence.ts), and time-block parsing is in [`src/timeBlock.ts`](src/timeBlock.ts). Tests covering round trips and next-occurrence behavior are in [`tests/recurrence.test.mjs`](tests/recurrence.test.mjs).
