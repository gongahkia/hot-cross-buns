# Shio Pan TODO.txt format

`TODO.txt` is Shio Pan's portable, human-readable journal. It is UTF-8 plain text. IndexedDB is a working copy; explicit import and download move data between the browser and the file. The file carries the meaning of items, details, spans, time blocks, and recurrence. Browser item IDs are implementation details.

## Dated items

A dated section starts with a valid `YYYY-MM-DD` heading. Completed items come first, followed by one blank line, then upcoming items. If all items are upcoming, put the blank line immediately after the heading. If all are done, put it after the last item. An empty date heading is meaningful and survives round trips. Import asks whether items are done or upcoming when a populated section lacks a divider.

```text
2026-10-13
09:00-09:30 Team sync #work
- [x] share update

Water plants
  @repeat: every 3 days after completion
- [ ] check soil

2026-10-14

14:00-15:30 Write report
```

Each item is one nonempty logical line. Long lines can wrap visually without a newline in the file. A literal title that looks like a date, detail, structural heading, or metadata can be prefixed with `\`; export writes this escape when needed.

### Details

Dated details start with `- [ ] ` or `- [x] ` below their item, with no indentation. They can also follow metadata. Completing a parent completes its details; reopening the parent reopens them. Completing the last detail completes its parent. Legacy `- detail` lines are accepted and inherit the parent's state. A location, guest name, meeting link, or description is ordinary detail text; Shio Pan does not assign them separate types.

### Time blocks and spans

An optional `HH:MM-HH:MM ` prefix gives an item a same-day time block. Use local 24-hour wall time, leading zeroes, and an end later than the start. A time block creates no alarm or invitation.

An optional `@span` line says an item occupies a full day or crosses dates:

```text
2026-10-15

Conference
  @span: all-day

Trip
  @span: all-day through 2026-10-17

Night shift
  @span: 22:00 to 2026-10-16 06:00
```

The `through` date is inclusive. A timed span ends on a later date. Shio Pan displays an item on every covered day but stores it once, under its starting date. A span and a same-day time prefix cannot appear on the same item. A dated item with neither is simply dated; `@span: all-day` makes all-day occupancy explicit.

Public holidays saved from Settings use ordinary all-day items. This is a one-time import for the chosen country and year; turning off the holiday setting does not remove saved items. The alternative date-only holiday view does not write to TODO.txt. Settings such as country, time zone, and week start are browser preferences rather than item fields.

## Undated lists

Undated items live in a distinct section at the end. The list heading groups items; neither these items nor their details have completion circles.

```text
UNDATED

LIST: Ideas
Plan a talk
- possible venue
- guest list

LIST: Inbox
Read this later
```

`UNDATED` and `LIST: name` are structural lines. Escape a literal item title matching either form with `\`. Adding a date moves an item into the dated view; making it undated moves it into a selected list. Undo and redo cover accidental moves. The text file records its current placement without a movement history.

Making an undated item a detail moves its title and existing details under the chosen parent, including one in another list. Promoting a detail creates an item after its parent in the same list. Both changes keep the text in TODO.txt and can be undone.

## Recurrence

A repeat rule is an optional metadata line indented by exactly two spaces. An item can have one rule. The human-readable forms include:

```text
  @repeat: daily; series morning-check
  @repeat: weekdays; series work-check
  @repeat: weekly on mon, wed, fri; series standup
  @repeat: monthly on 15; series monthly-review
  @repeat: yearly on 10-13; series birthday
  @repeat: every 2 weeks on wed; from 2026-10-14; series team-sync; ends after 13
  @repeat: every 2 weeks on sun; from 2026-10-18; series sunday-check; week starts sun
  @repeat: every 1 month on second wed; from 2026-10-14; series committee
  @repeat: every 1 month on last day; from 2026-10-31; series month-end
  @repeat: every 1 year on last fri of april; from 2026-04-24; series arbor-day; ends on 2030-04-30
  @repeat: every 3 days after completion; series water-plants; occurrence 2
```

Day names are `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`. The extended scheduled form supports intervals of 1–999 days, weeks, months, or years; selected weekdays for weeks; numbered, last, or ordinal weekdays of a month; and a `MM-DD` or ordinal weekday of a named month for years. `from` fixes the interval cycle. `week starts sun` is optional for multiweek schedules whose weeks begin on Sunday; Monday is the default. `series` is a stable identifier for one stored rule. A short scheduled rule without an identifier gets a stable one on import. `ends on YYYY-MM-DD` is inclusive; `ends after N` limits the count. `occurrence N` identifies the first actual occurrence stored when a count-limited series is imported after its original start.

**Scheduled recurrence is calculated from the rule.** Looking at a future week shows its occurrences without adding copies to TODO.txt or waiting for an earlier occurrence to be completed. Only an occurrence that is completed, moved, edited, or skipped needs a stored exception:

```text
2026-10-19

09:00-09:30 Weekly standup
  @repeat: weekly on mon; series weekly-standup
  @skip: 2026-11-02

2026-10-27

10:00-10:30 Weekly standup
  @replaces: weekly-standup on 2026-10-26
```

`@skip` suppresses one date from the rule. `@replaces` identifies the original series date and implicitly suppresses that calculated occurrence; the replacement's own heading gives its current date. A series identifier belongs to one rule, and one original occurrence can have one replacement. Editing a recurring item offers **this item**, **this and following items**, and **all items**. The middle choice ends the old rule before the selected occurrence and starts one new rule there. Explicit prior exceptions remain stored. Completing one occurrence records only that occurrence.

**After-completion recurrence waits for completion.** For `every 3 days after completion`, completing on October 13 creates one successor on October 16. A completed after-completion item records its actual completion date as `  @completed: YYYY-MM-DD`. Its `series` and one-based `occurrence` identify the successor across imports, so an imported completed item does not duplicate an existing successor. The import doctor requests the actual completion date and identity if either is missing; it never guesses. Completion and successor creation form one undoable change.

`monthly on 31` skips months without a 31st. A fifth weekday skips months with only four. `monthly on last day` covers every month. `yearly on 02-29` skips non-leap years. After-completion month and year intervals clamp to the last day of the destination month. This format stores local clock times, not appointment time zones.

## Plain-text editing and round trips

Dates and lists, item lines, optional metadata, and detail lines are the source of meaning. Invalid dates, malformed spans or rules, orphan details, invalid time ranges, and unknown metadata are reported instead of silently becoming another kind of item. The import doctor proposes narrow repairs in a working copy and asks for explicit decisions where meaning could change; it never overwrites the original file. See [TODO_DOCTOR.md](TODO_DOCTOR.md).

**Download TODO.txt** opens a read-only preview of the complete serialized journal. The default file is UTF-8 `TODO.txt` with LF line endings. Filename and CRLF choices do not change meaning; visual wrapping changes only the preview. Edit a downloaded file in a text editor and import it to apply text changes. An unfinished draft left by an older browser editor remains available as a separate download.

Parsing and serialization are in [`src/todoText.ts`](src/todoText.ts). Scheduled occurrence projection is in [`src/seriesView.ts`](src/seriesView.ts); repeat calculations are in [`src/recurrence.ts`](src/recurrence.ts) and [`src/scheduledRecurrence.ts`](src/scheduledRecurrence.ts). The Google snapshot converter is described in [GOOGLE_SNAPSHOT.md](GOOGLE_SNAPSHOT.md).
