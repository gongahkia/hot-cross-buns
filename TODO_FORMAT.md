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
  @repeat: every 2 weeks on wed; from 2026-10-14; series team-sync-20261014-a1b2c3; occurrence 2; ends after 13
  @repeat: every 1 month on second wed; from 2026-10-14; series team-sync-20261014-d4e5f6; occurrence 1
  @repeat: every 1 year on last fri of april; from 2026-04-24; series arbor-day-20260424-123abc; occurrence 1; ends on 2030-04-30
```

Day names are `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`. An after-completion interval can be 1–999 days, weeks, months, or years. Hito accepts rule text without regard to letter case and exports the spelling shown above. An item can have one repeat rule.

The extended scheduled form supports `every 1–999 days`, selected weekdays for `weeks`, a numbered day or `first`/`second`/`third`/`fourth`/`fifth`/`last` weekday for `months`, and a `MM-DD` date or ordinal weekday of a named month for `years`. For example, `every 2 months on 15` and `every 1 year on second wed of october` are valid rule beginnings. The `from`, `series`, and `occurrence` clauses are required for this form, in any order. Hito adds them when you use the repeat editor.

`from` fixes the day, week, month, or year cycle even when an item is completed late or moved. `series` is a stable, readable identifier shared by all occurrences of that rule; keep it when editing an occurrence, and use a new identifier when making an independent series. `occurrence` is the one-based number of this actual Hito item. An optional `ends on YYYY-MM-DD` includes that date; `ends after N` stops after N Hito items including the first. Omit the `ends` clause to repeat indefinitely. Hito rejects a duplicate pair of series identifier and occurrence number in one file.
Adding a scheduled rule to an existing item begins a new series at occurrence 1. Editing the rule on an older occurrence does not rewrite later items that were already created.

**Every rule creates only one next item when the current item becomes complete.** Hito never fills all future dates or recreates instances just because it reads an older completed line. Scheduled rules find the first matching date after completion, skipping missed dates while retaining the original `from` cycle. Skipped dates do not consume an `ends after` count. After-completion interval rules calculate from completion: completing `every 3 days after completion` on October 13 creates one item on October 16. Completion before an item's scheduled day uses that scheduled day as the earliest starting point.

The completed occurrence remains in its day, including its repeat rule and completed details. The new occurrence has the same title, time block, and schedule, an incremented occurrence number where applicable, and fresh unchecked details. An item completed from its main circle, its last detail, a drag into Done, or an imported file change to a previously pending item follows the same rule. Completion and next-item creation form one undoable change. Reopening an older occurrence later does not erase a later occurrence; use Undo to reverse an accidental completion immediately.

For `monthly on 31`, months without a 31st are skipped. A fifth weekday is skipped in months that have only four. For `yearly on 02-29`, non-leap years are skipped. After-completion month/year intervals clamp the destination to that month's last day (January 31 plus one month becomes February 28 or 29). A scheduled time block keeps its local clock range on each created item; this format does not store an appointment time zone.

### Plain-text editing and round trips

The date heading, item line, optional repeat metadata, and detail lines are the source of task meaning. A human can edit them in any text editor, then import or reopen the file. Invalid dates, malformed repeat rules, orphan details, and invalid time ranges are reported instead of silently becoming another kind of entry. Hito may normalize spacing, line order, rule casing, and legacy detail markers on export; it preserves the task meaning.

The parser and serializer are in [`src/todoText.ts`](src/todoText.ts). Recurrence calculation is in [`src/recurrence.ts`](src/recurrence.ts) and [`src/scheduledRecurrence.ts`](src/scheduledRecurrence.ts); time-block parsing is in [`src/timeBlock.ts`](src/timeBlock.ts). Tests covering round trips and next-occurrence behavior are in [`tests/recurrence.test.mjs`](tests/recurrence.test.mjs) and [`tests/scheduledRecurrence.test.mjs`](tests/scheduledRecurrence.test.mjs).
