#!/usr/bin/env python3
"""Convert a read-only Google snapshot into Shio Pan's human-readable TODO.txt."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


class ConversionError(ValueError):
    pass


WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
DAY_NAMES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
RESERVED = re.compile(r"^(?:\\|- |\s*@[a-z][\w-]*:|\d{4}-\d{2}-\d{2}$|UNDATED$|LIST: )", re.I)


def escape_line(value: str) -> str:
    return "\\" + value if RESERVED.match(value) else value


def clean_line(value: str) -> str:
    return re.sub(r"[\r\n]+", " ", value).strip()


def details(value: str | None) -> list[str]:
    if not value:
        return []
    return [clean_line(line) for line in value.splitlines() if clean_line(line)]


def records(collection: dict) -> list[dict]:
    return [item for page in collection.get("pages", []) for item in page.get("items", [])]


def local_datetime(value: dict, zone: ZoneInfo) -> datetime | None:
    if "dateTime" not in value:
        return None
    stamp = datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=zone)
    return stamp.astimezone(zone)


def event_start(event: dict, zone: ZoneInfo) -> date:
    start = event.get("start") or {}
    if "date" in start:
        return date.fromisoformat(start["date"])
    stamp = local_datetime(start, zone)
    if stamp is None:
        raise ConversionError("Calendar event has no valid start date.")
    return stamp.date()


def event_end(event: dict, zone: ZoneInfo) -> datetime:
    end = event.get("end") or {}
    if "date" in end:
        return datetime.combine(date.fromisoformat(end["date"]), time.min, zone)
    stamp = local_datetime(end, zone)
    if stamp is None:
        raise ConversionError("Calendar event has no valid end date.")
    return stamp


def rrule_fields(event: dict) -> dict[str, str]:
    values = event.get("recurrence") or []
    rules = [part for part in values if part.startswith("RRULE:")]
    if len(rules) != 1 or any(not value.startswith("RRULE:") for value in values):
        raise ConversionError("A recurring Calendar event has unsupported recurrence lines.")
    fields: dict[str, str] = {}
    for clause in rules[0][6:].split(";"):
        key, separator, value = clause.partition("=")
        if not separator or key in fields:
            raise ConversionError("A Calendar repeat rule has a malformed clause.")
        fields[key] = value
    allowed = {"FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL", "WKST"}
    if set(fields) - allowed or fields.get("FREQ") not in {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}:
        raise ConversionError("A Calendar repeat rule cannot yet be represented by Shio Pan.")
    return fields


def until_limit(fields: dict[str, str], start: datetime, zone: ZoneInfo) -> datetime | date | None:
    raw = fields.get("UNTIL")
    if not raw:
        return None
    try:
        if re.fullmatch(r"\d{8}", raw):
            return date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
        if re.fullmatch(r"\d{8}T\d{6}Z", raw):
            return datetime.strptime(raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).astimezone(zone)
    except ValueError as error:
        raise ConversionError("Invalid Calendar repeat end.") from error
    raise ConversionError("Unsupported Calendar repeat end.")


def recurrence_matches(fields: dict[str, str], origin: date, candidate: date) -> bool:
    if candidate < origin:
        return False
    frequency = fields["FREQ"]
    interval = int(fields.get("INTERVAL", "1"))
    if interval < 1 or interval > 999:
        raise ConversionError("Calendar repeat interval is outside Shio Pan's range.")
    byday = fields.get("BYDAY")
    days = byday.split(",") if byday else []
    if frequency == "DAILY":
        if days:
            raise ConversionError("This daily Calendar repeat cannot yet be represented.")
        if fields.get("BYMONTH") or fields.get("BYMONTHDAY") or days:
            raise ConversionError("This daily Calendar repeat cannot yet be represented.")
        return (candidate - origin).days % interval == 0
    if frequency == "WEEKLY":
        if any(day not in WEEKDAYS for day in days):
            raise ConversionError("Malformed weekly BYDAY cannot yet be represented.")
        if fields.get("BYMONTH") or fields.get("BYMONTHDAY"):
            raise ConversionError("This weekly Calendar repeat cannot yet be represented.")
        if fields.get("WKST", "MO") not in WEEKDAYS:
            raise ConversionError("Invalid Calendar week start.")
        week_start = WEEKDAYS.index(fields.get("WKST", "MO"))
        origin_week = origin - timedelta(days=(origin.weekday() - week_start) % 7)
        candidate_week = candidate - timedelta(days=(candidate.weekday() - week_start) % 7)
        return (candidate_week - origin_week).days // 7 % interval == 0 and WEEKDAYS[candidate.weekday()] in (days or [WEEKDAYS[origin.weekday()]])
    if frequency == "MONTHLY":
        if fields.get("BYMONTH"):
            raise ConversionError("This monthly Calendar repeat cannot yet be represented.")
        if days:
            if len(days) != 1 or fields.get("BYMONTHDAY"):
                raise ConversionError("This monthly BYDAY combination cannot yet be represented.")
            ordinal = re.fullmatch(r"(-1|[1-5])(MO|TU|WE|TH|FR|SA|SU)", days[0])
            if not ordinal:
                raise ConversionError("This monthly BYDAY cannot yet be represented.")
            matching_day = WEEKDAYS[candidate.weekday()] == ordinal[2]
            if ordinal[1] == "-1":
                return ((candidate.year - origin.year) * 12 + candidate.month - origin.month) % interval == 0 and matching_day and (candidate + timedelta(days=7)).month != candidate.month
            return ((candidate.year - origin.year) * 12 + candidate.month - origin.month) % interval == 0 and matching_day and (candidate.day - 1) // 7 + 1 == int(ordinal[1])
        month_day = int(fields.get("BYMONTHDAY", origin.day))
        if month_day == -1:
            return ((candidate.year - origin.year) * 12 + candidate.month - origin.month) % interval == 0 and (candidate + timedelta(days=1)).month != candidate.month
        if month_day < 1 or month_day > 31:
            raise ConversionError("Unsupported monthly day.")
        return ((candidate.year - origin.year) * 12 + candidate.month - origin.month) % interval == 0 and candidate.day == month_day
    if days:
        raise ConversionError("This yearly Calendar repeat cannot yet be represented.")
    month = int(fields.get("BYMONTH", origin.month))
    month_day = int(fields.get("BYMONTHDAY", origin.day))
    if not (1 <= month <= 12 and 1 <= month_day <= 31):
        raise ConversionError("Unsupported yearly date.")
    return (candidate.year - origin.year) % interval == 0 and candidate.month == month and candidate.day == month_day


def occurrences(event: dict, fields: dict[str, str], zone: ZoneInfo, as_of: datetime, include_past: bool) -> tuple[date, int] | None:
    origin = event_start(event, zone)
    start_stamp = local_datetime(event.get("start") or {}, zone) or datetime.combine(origin, time.min, zone)
    duration = event_end(event, zone) - start_stamp
    limit = until_limit(fields, start_stamp, zone)
    count_limit = int(fields["COUNT"]) if "COUNT" in fields else None
    if count_limit is not None and (count_limit < 1 or count_limit > 9999):
        raise ConversionError("Calendar repeat count is outside Shio Pan's range.")
    # A bounded scan also catches ended series. It stores just the first needed occurrence.
    end_scan = max(as_of.date() + timedelta(days=366 * 8), origin + timedelta(days=366 * 8))
    if limit:
        end_scan = min(end_scan, limit.date() if isinstance(limit, datetime) else limit)
    candidate = origin
    number = 0
    while candidate <= end_scan:
        if recurrence_matches(fields, origin, candidate):
            stamp = datetime.combine(candidate, start_stamp.timetz()).astimezone(zone)
            if limit is not None and (stamp > limit if isinstance(limit, datetime) else candidate > limit):
                break
            number += 1
            if count_limit is not None and number > count_limit:
                break
            if include_past or stamp + duration > as_of:
                return candidate, number
        candidate += timedelta(days=1)
    if limit is None and count_limit is None:
        raise ConversionError("Could not locate the next occurrence within eight years.")
    return None


def series_id(event: dict, start: date) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", clean_line(event.get("summary") or "item").lower()).strip("-")[:24] or "item"
    digest = hashlib.sha256(event["id"].encode()).hexdigest()[:8]
    return f"{slug}-{start:%Y%m%d}-{digest}"


def repeat_line(fields: dict[str, str], original: date, first: date, number: int, identifier: str, zone: ZoneInfo, event: dict) -> str:
    frequency = fields["FREQ"]
    interval = int(fields.get("INTERVAL", "1"))
    count = int(fields["COUNT"]) if "COUNT" in fields else None
    if frequency == "DAILY":
        short = "daily"
        extended = f"every {interval} day" if interval == 1 else f"every {interval} days"
    elif frequency == "WEEKLY":
        days = [day for day in WEEKDAYS if day in fields.get("BYDAY", WEEKDAYS[original.weekday()]).split(",")]
        names = ", ".join(DAY_NAMES[WEEKDAYS.index(day)] for day in days)
        short = f"weekly on {names}"
        extended = f"every {interval} week{'s' if interval != 1 else ''} on {names}"
    elif frequency == "MONTHLY":
        ordinal = re.fullmatch(r"(-1|[1-5])(MO|TU|WE|TH|FR|SA|SU)", fields.get("BYDAY", ""))
        if ordinal:
            names = {"-1": "last", "1": "first", "2": "second", "3": "third", "4": "fourth", "5": "fifth"}
            on = f"{names[ordinal[1]]} {DAY_NAMES[WEEKDAYS.index(ordinal[2])]}"
            short = ""
        elif fields.get("BYMONTHDAY") == "-1":
            on = "last day"
            short = ""
        else:
            day = int(fields.get("BYMONTHDAY", original.day))
            on = str(day)
            short = f"monthly on {day}"
        extended = f"every {interval} month{'s' if interval != 1 else ''} on {on}"
    else:
        month = int(fields.get("BYMONTH", original.month))
        day = int(fields.get("BYMONTHDAY", original.day))
        short = f"yearly on {month:02d}-{day:02d}"
        extended = f"every {interval} year{'s' if interval != 1 else ''} on {month:02d}-{day:02d}"
    until = until_limit(fields, local_datetime(event.get("start") or {}, zone) or datetime.combine(original, time.min, zone), zone)
    end_date = (until.date() if isinstance(until, datetime) else until)
    if interval == 1 and count is None and short:
        return short + f"; series {identifier}" + (f"; ends on {end_date}" if end_date else "")
    week_start = fields.get("WKST", "MO")
    start_clause = f"; week starts {DAY_NAMES[WEEKDAYS.index(week_start)]}" if frequency == "WEEKLY" and week_start != "MO" else ""
    return extended + f"; from {original}; series {identifier}" + (f"; occurrence {number}" if number > 1 else "") + start_clause + (f"; ends after {count}" if count else f"; ends on {end_date}" if end_date else "")


def event_lines(event: dict, zone: ZoneInfo, occurrence_date: date | None = None) -> tuple[date, list[str]]:
    start = event.get("start") or {}
    end = event.get("end") or {}
    original = event_start(event, zone)
    first = occurrence_date or original
    shift = first - original
    title = clean_line(event.get("summary") or "(untitled)")
    extras: list[str] = []
    if "date" in start:
        if "date" not in end:
            raise ConversionError("All-day event has a timed end.")
        through = date.fromisoformat(end["date"]) - timedelta(days=1) + shift
        if through < first:
            raise ConversionError("All-day event ends before it starts.")
        extras.append(f"  @span: all-day{' through ' + str(through) if through > first else ''}")
    else:
        beginning = local_datetime(start, zone)
        finish = local_datetime(end, zone)
        if beginning and finish and shift:
            beginning += shift
            finish += shift
        if not beginning or not finish or finish <= beginning:
            raise ConversionError("Timed event has an invalid duration.")
        if finish.date() == first:
            title = f"{beginning:%H:%M}-{finish:%H:%M} {title}"
        else:
            extras.append(f"  @span: {beginning:%H:%M} to {finish:%Y-%m-%d %H:%M}")
    content = details(event.get("description"))
    if event.get("location"):
        content.append("Location: " + clean_line(event["location"]))
    if event.get("hangoutLink"):
        content.append("Meeting link: " + clean_line(event["hangoutLink"]))
    return first, [escape_line(title), *extras, *(f"- [ ] {escape_line(line)}" for line in content)]


def insert_skip(lines: list[str], original: date) -> None:
    marker = f"  @skip: {original}"
    position = next((index for index, line in enumerate(lines) if line.startswith("- ") or line.startswith("  @skip:") and line > marker), len(lines))
    lines.insert(position, marker)


def convert(snapshot: dict, as_of: datetime, include_past_events: bool) -> tuple[str, dict[str, int]]:
    if snapshot.get("format") != "shio-pan-google-raw-v1":
        raise ConversionError("Unsupported snapshot format.")
    calendar_entries = records(snapshot["calendarList"])
    zones = {entry["id"]: ZoneInfo(entry.get("timeZone") or "UTC") for entry in calendar_entries}
    task_lists: dict[str, str] = {}
    used_list_names: set[str] = set()
    for entry in records(snapshot["taskLists"]):
        base = clean_line(entry.get("title") or "Untitled list") or "Untitled list"
        name = base
        suffix = 2
        while name in used_list_names:
            name = f"{base} ({suffix})"
            suffix += 1
        used_list_names.add(name)
        task_lists[entry["id"]] = name
    by_day: dict[date, list[list[str]]] = defaultdict(list)
    undated: dict[str, list[list[str]]] = defaultdict(list)
    stats = defaultdict(int)
    for group in snapshot["tasksByList"]:
        name = task_lists.get(group["taskListId"], "Untitled list")
        for task in records(group["tasks"]):
            if task.get("deleted") or task.get("status") != "needsAction":
                continue
            title = clean_line(task.get("title") or "(untitled)")
            lines = [escape_line(title), *(f"- [ ] {escape_line(line)}" for line in details(task.get("notes")))]
            due = task.get("due")
            if due:
                by_day[date.fromisoformat(due[:10])].append(lines)
                stats["dated_tasks"] += 1
            else:
                undated[name].append([escape_line(title), *(f"- {escape_line(line)}" for line in details(task.get("notes")))])
                stats["undated_tasks"] += 1
    for calendar in snapshot["calendarEvents"]:
        zone = zones.get(calendar["calendarId"], ZoneInfo("UTC"))
        events = records(calendar["events"])
        included: dict[str, tuple[date, list[str], str]] = {}
        for event in events:
            if event.get("status") == "cancelled" or event.get("recurringEventId"):
                continue
            if event.get("recurrence"):
                fields = rrule_fields(event)
                next_occurrence = occurrences(event, fields, zone, as_of.astimezone(zone), include_past_events)
                if next_occurrence is None:
                    continue
                first, number = next_occurrence
                original = event_start(event, zone)
                identifier = series_id(event, original)
                _, lines = event_lines(event, zone, first)
                lines.insert(1, "  @repeat: " + repeat_line(fields, original, first, number, identifier, zone, event))
                included[event["id"]] = (first, lines, identifier)
                by_day[first].append(lines)
                stats["series"] += 1
                continue
            if not include_past_events and event_end(event, zone) <= as_of.astimezone(zone):
                continue
            first, lines = event_lines(event, zone)
            by_day[first].append(lines)
            stats["events"] += 1
        for event in events:
            master_id = event.get("recurringEventId")
            if not master_id:
                continue
            original = event.get("originalStartTime") or {}
            original_date = date.fromisoformat(original.get("date") or original.get("dateTime", "")[:10])
            parent = included.get(master_id)
            if event.get("status") != "cancelled" and (include_past_events or event_end(event, zone) > as_of.astimezone(zone)) and (not parent or not include_past_events and original_date < parent[0]):
                actual_date, lines = event_lines(event, zone)
                by_day[actual_date].append(lines)
                stats["moved_standalone"] += 1
                continue
            if not parent:
                continue
            anchor, master_lines, identifier = parent
            if not include_past_events and original_date < anchor:
                continue
            if event.get("status") == "cancelled":
                insert_skip(master_lines, original_date)
                stats["skips"] += 1
            elif event.get("status") != "cancelled":
                if not include_past_events and event_end(event, zone) <= as_of.astimezone(zone):
                    insert_skip(master_lines, original_date)
                    stats["skips"] += 1
                    continue
                actual_date, lines = event_lines(event, zone)
                lines.insert(1, f"  @replaces: {identifier} on {original_date}")
                by_day[actual_date].append(lines)
                stats["replacements"] += 1
    sections = []
    for day in sorted(by_day):
        sections.append("\n".join([str(day), "", *(line for item in by_day[day] for line in item)]))
    if undated:
        section = ["UNDATED"]
        for name, items in undated.items():
            section.extend(["", f"LIST: {name}", *(line for item in items for line in item)])
        sections.append("\n".join(section))
    return ("\n\n".join(sections) + "\n" if sections else ""), dict(stats)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path, help="Raw JSON file from pull_google_snapshot.py")
    parser.add_argument("--output", type=Path, help="TODO.txt destination (must not exist)")
    parser.add_argument("--include-past-events", action="store_true", help="Include non-cancelled historical Calendar events")
    parser.add_argument("--as-of", help="Override the conversion cutoff as YYYY-MM-DD in the calendar's local zone")
    args = parser.parse_args()
    data = json.loads(args.snapshot.read_text(encoding="utf-8"))
    as_of = datetime.now(timezone.utc)
    if args.as_of:
        calendars = records(data.get("calendarList") or {})
        primary = next((entry for entry in calendars if entry.get("primary")), calendars[0] if calendars else {})
        zone = ZoneInfo(primary.get("timeZone") or "UTC")
        as_of = datetime.combine(date.fromisoformat(args.as_of), time.min, zone)
    output, counts = convert(data, as_of, args.include_past_events)
    destination = args.output or args.snapshot.with_name(args.snapshot.stem + "-TODO.txt")
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as file:
        file.write(output)
    print(f"Saved {destination} ({len(output.encode('utf-8'))} bytes)")
    print(", ".join(f"{key}: {value}" for key, value in sorted(counts.items())))


if __name__ == "__main__":
    try:
        main()
    except (ConversionError, KeyError, ValueError) as error:
        raise SystemExit(f"Conversion stopped: {error}") from error
