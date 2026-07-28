# Importing Tasks and events

Hot Cross Buns supports two explicit UTF-8 import formats. Both parse locally, show every accepted or skipped row, validate destinations and fields, then require a second confirmation. All accepted rows are created in one local SQLite transaction. Google sync is queued afterward; Google batch APIs are not transactional, so remote failures remain individually retryable and visible through normal sync status.

## Delimited paste or file

Open **Import Tasks and events** from Tasks, Calendar, Settings, or the command palette. Paste one item per line, then select **Preview pasted text**. Blank lines and lines whose trimmed text starts with `#` are ignored.

Each line starts with `task` or `event`, followed by whitespace-separated `key=value` fields:

```text
task title="Buy milk" list="Inbox" due="2026-07-29" priority=high notes="2 litres"
event title="Planning" calendar="Work" start="2026-07-29T09:00:00+08:00" end="2026-07-29T10:00:00+08:00" time_zone="Asia/Singapore"
```

Values without spaces may be unquoted. Quoted values support `\n`, `\r`, `\t`, `\"`, and `\\`. Keys are case-insensitive, cannot repeat, and unknown keys reject only that line.

Task fields:

| Field | Required | Meaning |
|---|---:|---|
| `title` | yes | Task title |
| `list` | no | Exact, unique Task-list title; blank uses the selected default |
| `due` | no | ISO `YYYY-MM-DD` or ISO date-time |
| `notes` | no | Google Task notes |
| `priority` | no | `none`, `low`, `medium`, or `high` |
| `rrule` | no | HCB-managed date-only rule using `FREQ`, `INTERVAL`, `BYDAY`, `BYMONTHDAY`, and/or `BYMONTH` |
| `until` | no | Inclusive ISO end date; requires `rrule` and conflicts with `count` |
| `count` | no | Occurrence count from 1 through 10,000; requires `rrule` |
| `exclude` | no | Comma-separated unique ISO skip dates; requires `rrule` |
| `include` | no | Comma-separated unique ISO additional dates; requires `rrule` |

A recurring Task requires `due`. HCB writes its portable recurrence marker into Google Task notes.

Event fields:

| Field | Required | Meaning |
|---|---:|---|
| `title` | yes | Event title |
| `calendar` | no | Exact, unique calendar title; blank uses the selected default |
| `start` | yes | ISO date-time with time and offset/zone |
| `end` | yes | ISO date-time later than `start` |
| `all_day` | no | `true` or `false`; defaults to `false` |
| `time_zone` | no | Valid IANA time-zone ID, applied to start and end |
| `description` | no | Event description |
| `location` | no | Event location |
| `recurrence` | no | One or more Google recurrence lines, separated by escaped `\n` |

Calendar recurrence lines must start with `RRULE:`, `EXRULE:`, `RDATE:`, or `EXDATE:`. HCB preserves accepted lines and Google-resolved instances remain authoritative.

## CSV schema version 1

Choose a `.csv` file. The header must match this line exactly:

```csv
schema_version,kind,title,list,calendar,due,notes,priority,rrule,until,count,exclude,include,start,end,all_day,time_zone,description,location,recurrence
```

Every data row must contain all 20 columns and set `schema_version` to `1`. `kind` is `task` or `event`; use the applicable fields above and leave the other kind's fields empty. CSV follows standard double-quote escaping: commas/newlines may appear inside quoted fields and a literal quote is `""`.

```csv
schema_version,kind,title,list,calendar,due,notes,priority,rrule,until,count,exclude,include,start,end,all_day,time_zone,description,location,recurrence
1,task,Buy milk,Inbox,,2026-07-29,2 litres,high,,,,,,,,,,,,
1,event,Planning,,Work,,,,,,,,,2026-07-29T09:00:00+08:00,2026-07-29T10:00:00+08:00,false,Asia/Singapore,,Room 4,
```

## Validation and limits

- UTF-8 only; an optional UTF-8 BOM is accepted.
- Maximum input size: 5 MiB.
- Maximum records: 1,000.
- Delimited line limit: 32 KiB.
- Field limit: 524,416 characters, with lower product/API limits applied during destination validation.
- Explicit destination titles must match exactly once. Blank destinations require a valid selected default.
- Events require a writable calendar (`writer` or `owner` when Google supplies an access role).
- Invalid rows are skipped and reported; accepted rows are never written until the final confirmation.
- Cancelling before confirmation performs no writes.

Imports intentionally exclude subtasks/parent links, attendees, Meet creation, attachments, and calendar ACLs.
