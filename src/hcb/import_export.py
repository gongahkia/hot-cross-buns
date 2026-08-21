"""Bounded, offline import and export for tasks and calendar events.

Calendar recurrence lines are preserved as provider data.  In particular,
``parse_ics`` never expands an RRULE into synthetic Google event occurrences.
"""

from __future__ import annotations

import csv
import io
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_BYTES = 5 * 1024 * 1024
MAX_RECORDS = 1_000
MAX_DELIMITED_LINE = 32 * 1024
CSV_HEADER = (
    "kind",
    "title",
    "task_list",
    "calendar",
    "due",
    "notes",
    "priority",
    "rrule",
    "until",
    "count",
    "exclude",
    "include",
    "start",
    "end",
    "all_day",
    "time_zone",
    "description",
    "location",
    "recurrence",
)
_PRIORITIES = frozenset(("none", "low", "medium", "high"))
_RECURRENCE = re.compile(r"^(?:RRULE|EXRULE|RDATE|EXDATE):")
_SKIPPED_ICS = frozenset(("ATTENDEE", "VALARM", "ATTACH", "CONFERENCE", "URL"))


@dataclass(frozen=True, slots=True)
class ImportedTask:
    title: str
    list: str | None = None
    due: str | None = None
    notes: str | None = None
    priority: Literal["none", "low", "medium", "high"] = "none"
    rrule: str | None = None
    until: str | None = None
    count: int | None = None
    exclude: tuple[str, ...] = ()
    include: tuple[str, ...] = ()
    kind: Literal["task"] = "task"


@dataclass(frozen=True, slots=True)
class ImportedEvent:
    title: str
    start: str
    end: str
    all_day: bool
    calendar: str | None = None
    time_zone: str | None = None
    description: str | None = None
    location: str | None = None
    recurrence: tuple[str, ...] = ()
    kind: Literal["event"] = "event"


ImportedRecord = ImportedTask | ImportedEvent


@dataclass(frozen=True, slots=True)
class ImportPreviewRow:
    line: int
    record: ImportedRecord | None = None
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ImportPreview:
    rows: tuple[ImportPreviewRow, ...] = ()
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()


def _valid_date(value: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _datetime(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed


def _valid_zone(value: str) -> bool:
    if not value or len(value) > 128 or value.strip() != value or "\0" in value:
        return False
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def _values(value: object) -> tuple[str, ...]:
    if value is None or value == "":
        return ()
    if isinstance(value, str):
        return tuple(item.strip() for item in value.split(",") if item.strip())
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return tuple(value)
    return ("\0INVALID",)


def _optional(fields: Mapping[str, object], name: str) -> str | None:
    value = fields.get(name)
    return value if isinstance(value, str) and value != "" else None


def _task(fields: Mapping[str, object], line: int) -> ImportPreviewRow:
    errors: list[str] = []
    raw_title = fields.get("title")
    title = raw_title.strip() if isinstance(raw_title, str) else ""
    if not title:
        errors.append("Task title is required")
    due = _optional(fields, "due")
    if due and not _valid_date(due):
        errors.append("Task due must be YYYY-MM-DD")
    priority_value = fields.get("priority") or "none"
    priority = priority_value if isinstance(priority_value, str) else ""
    if priority not in _PRIORITIES:
        errors.append("Task priority must be none, low, medium, or high")
    until = _optional(fields, "until")
    if until and not _valid_date(until):
        errors.append("Task recurrence end date must be YYYY-MM-DD")
    raw_count = fields.get("count")
    count: int | None = None
    if raw_count not in (None, ""):
        if isinstance(raw_count, int) and not isinstance(raw_count, bool):
            count = raw_count
        elif isinstance(raw_count, str) and raw_count.isdecimal():
            count = int(raw_count)
        if count is None or not 1 <= count <= 10_000:
            errors.append("Task recurrence count must be an integer between 1 and 10,000")
            count = None
    exclude = _values(fields.get("exclude"))
    include = _values(fields.get("include"))
    if any(not _valid_date(item) for item in (*exclude, *include)):
        errors.append("Task recurrence exceptions must be YYYY-MM-DD dates")
    rrule = _optional(fields, "rrule")
    if rrule and not due:
        errors.append("A recurring task needs a due date")
    if errors:
        return ImportPreviewRow(line, errors=tuple(errors))
    list_name = _optional(fields, "list") or _optional(fields, "task_list")
    return ImportPreviewRow(
        line,
        record=ImportedTask(
            title=title,
            list=list_name,
            due=due,
            notes=_optional(fields, "notes"),
            priority=priority,  # type: ignore[arg-type]
            rrule=rrule.strip() if rrule else None,
            until=until,
            count=count,
            exclude=exclude,
            include=include,
        ),
    )


def _event(fields: Mapping[str, object], line: int) -> ImportPreviewRow:
    errors: list[str] = []
    raw_title = fields.get("title")
    title = raw_title.strip() if isinstance(raw_title, str) else ""
    if not title:
        errors.append("Event title is required")
    all_day_value = fields.get("all_day", False)
    all_day = all_day_value is True or all_day_value in ("true", "1")
    raw_start = fields.get("start")
    raw_end = fields.get("end")
    start = raw_start if isinstance(raw_start, str) else ""
    end = raw_end if isinstance(raw_end, str) else ""
    if all_day:
        valid_times = _valid_date(start) and _valid_date(end)
    else:
        valid_times = _datetime(start) is not None and _datetime(end) is not None
    if not valid_times:
        errors.append(
            "All-day event start and end must be YYYY-MM-DD"
            if all_day
            else "Timed event start and end must be valid ISO timestamps"
        )
    elif (
        date.fromisoformat(end) <= date.fromisoformat(start)
        if all_day
        else _comparable_datetime(end) <= _comparable_datetime(start)
    ):
        errors.append("Event end must be after start")
    recurrence = _values(fields.get("recurrence"))
    if any(not _RECURRENCE.match(item) for item in recurrence):
        errors.append("Calendar recurrence must use RRULE, EXRULE, RDATE, or EXDATE lines")
    time_zone = _optional(fields, "time_zone")
    if time_zone and not _valid_zone(time_zone):
        errors.append("Event time zone is invalid")
    if errors:
        return ImportPreviewRow(line, errors=tuple(errors))
    return ImportPreviewRow(
        line,
        record=ImportedEvent(
            title=title,
            calendar=_optional(fields, "calendar"),
            start=start,
            end=end,
            all_day=all_day,
            time_zone=time_zone,
            description=_optional(fields, "description"),
            location=_optional(fields, "location"),
            recurrence=recurrence,
        ),
    )


def _comparable_datetime(value: str) -> datetime:
    parsed = _datetime(value)
    assert parsed is not None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def parse_csv(text: str) -> ImportPreview:
    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except (csv.Error, UnicodeError):
        return ImportPreview(errors=("CSV is empty or has malformed quoting",))
    if not rows:
        return ImportPreview(errors=("CSV is empty or has malformed quoting",))
    if tuple(rows[0]) != CSV_HEADER:
        return ImportPreview(errors=("CSV must use the documented exact header",))
    output: list[ImportPreviewRow] = []
    for index, values in enumerate(rows[1 : MAX_RECORDS + 1], start=2):
        if len(values) != len(CSV_HEADER):
            output.append(
                ImportPreviewRow(index, errors=("CSV row has the wrong number of fields",))
            )
            continue
        fields = dict(zip(CSV_HEADER, values, strict=True))
        output.append(
            _task(fields, index)
            if fields["kind"] == "task"
            else _event(fields, index)
            if fields["kind"] == "event"
            else ImportPreviewRow(index, errors=("CSV kind must be task or event",))
        )
    errors = (
        (f"Import accepts at most {MAX_RECORDS} records",) if len(rows) - 1 > MAX_RECORDS else ()
    )
    return ImportPreview(tuple(output), errors)


def parse_json(text: str) -> ImportPreview:
    try:
        payload: Any = json.loads(text)
    except json.JSONDecodeError:
        return ImportPreview(errors=("JSON is invalid",))
    if (
        not isinstance(payload, dict)
        or set(payload) != {"version", "records"}
        or payload["version"] != 1
    ):
        return ImportPreview(errors=("JSON must be an HCB version 1 export",))
    records = payload["records"]
    if not isinstance(records, list):
        return ImportPreview(errors=("JSON records must be an array",))
    output: list[ImportPreviewRow] = []
    for line, item in enumerate(records[:MAX_RECORDS], start=1):
        if not isinstance(item, dict):
            output.append(ImportPreviewRow(line, errors=("JSON record must be an object",)))
        elif item.get("kind") == "task":
            output.append(_task(item, line))
        elif item.get("kind") == "event":
            output.append(_event(item, line))
        else:
            output.append(ImportPreviewRow(line, errors=("JSON kind must be task or event",)))
    errors = (
        (f"Import accepts at most {MAX_RECORDS} records",) if len(records) > MAX_RECORDS else ()
    )
    return ImportPreview(tuple(output), errors)


def _unescape_ics(value: str) -> str:
    return re.sub(
        r"\\([nN,;\\])",
        lambda match: "\n" if match.group(1).lower() == "n" else match.group(1),
        value,
    )


def _ics_date(value: str, zone: str | None = None) -> tuple[str, bool] | None:
    if re.fullmatch(r"\d{8}", value):
        result = f"{value[:4]}-{value[4:6]}-{value[6:8]}"
        return (result, True) if _valid_date(result) else None
    match = re.fullmatch(r"(\d{8})T(\d{6})(Z)?", value)
    if not match:
        return None
    result = (
        f"{match.group(1)[:4]}-{match.group(1)[4:6]}-{match.group(1)[6:8]}"
        f"T{match.group(2)[:2]}:{match.group(2)[2:4]}:{match.group(2)[4:6]}"
        f"{'Z' if match.group(3) else ''}"
    )
    if _datetime(result) is None:
        return None
    if zone and not _valid_zone(zone):
        return None
    return result, False


def _duration_end(start: tuple[str, bool], duration: str) -> tuple[str, bool] | None:
    match = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", duration)
    if not match:
        return None
    seconds = (
        int(match.group(1) or 0) * 86_400
        + int(match.group(2) or 0) * 3_600
        + int(match.group(3) or 0) * 60
        + int(match.group(4) or 0)
    )
    if seconds <= 0 or (start[1] and seconds % 86_400):
        return None
    if start[1]:
        return (date.fromisoformat(start[0]) + timedelta(seconds=seconds)).isoformat(), True
    parsed = _datetime(start[0])
    if parsed is None:
        return None
    result = parsed + timedelta(seconds=seconds)
    text = result.isoformat(timespec="seconds").replace("+00:00", "Z")
    return text, False


def _content_line(line: str) -> tuple[str, dict[str, str], str] | None:
    separator = line.find(":")
    if separator < 1:
        return None
    left, value = line[:separator], line[separator + 1 :]
    pieces = left.split(";")
    name = pieces[0].upper()
    params: dict[str, str] = {}
    for piece in pieces[1:]:
        if "=" in piece:
            key, parameter = piece.split("=", 1)
            params[key.upper()] = parameter.strip('"')
    return name, params, value


def _first_ics(fields: Mapping[str, list[tuple[dict[str, str], str]]], name: str) -> str:
    values = fields.get(name)
    return values[0][1] if values else ""


def parse_ics(text: str) -> ImportPreview:
    unfolded = re.sub(r"\r?\n[ \t]", "", text)
    lines = unfolded.splitlines()
    components: list[list[str]] = []
    current: list[str] | None = None
    for line in lines:
        if line.upper() == "BEGIN:VEVENT":
            if current is not None:
                return ImportPreview(errors=("iCalendar contains nested VEVENT components",))
            current = []
        elif line.upper() == "END:VEVENT":
            if current is None:
                continue
            components.append(current)
            current = None
        elif current is not None:
            current.append(line)
    if current is not None:
        return ImportPreview(errors=("iCalendar VEVENT is not terminated",))

    output: list[ImportPreviewRow] = []
    for index, component in enumerate(components[:MAX_RECORDS], start=1):
        fields: dict[str, list[tuple[dict[str, str], str]]] = {}
        warnings: list[str] = []
        for source in component:
            parsed = _content_line(source)
            if parsed is None:
                continue
            name, params, value = parsed
            if name in _SKIPPED_ICS:
                warning = f"{name} is not imported"
                if warning not in warnings:
                    warnings.append(warning)
                continue
            fields.setdefault(name, []).append((params, _unescape_ics(value)))

        starts = fields.get("DTSTART", [])
        ends = fields.get("DTEND", [])
        zone = starts[0][0].get("TZID") if starts else None
        start = _ics_date(starts[0][1], zone) if len(starts) == 1 else None
        end = _ics_date(ends[0][1], ends[0][0].get("TZID")) if len(ends) == 1 else None
        if end is None and start and len(fields.get("DURATION", [])) == 1:
            end = _duration_end(start, fields["DURATION"][0][1])
        if start is None or end is None or start[1] != end[1]:
            output.append(
                ImportPreviewRow(
                    index,
                    errors=("VEVENT needs matching valid DTSTART and DTEND",),
                    warnings=tuple(warnings),
                )
            )
            continue
        recurrence = tuple(
            f"{name}:{value}"
            for name in ("RRULE", "EXRULE", "RDATE", "EXDATE")
            for _params, value in fields.get(name, [])
        )
        row = _event(
            {
                "title": _first_ics(fields, "SUMMARY"),
                "calendar": "",
                "start": start[0],
                "end": end[0],
                "all_day": start[1],
                "time_zone": zone or "",
                "description": _first_ics(fields, "DESCRIPTION"),
                "location": _first_ics(fields, "LOCATION"),
                "recurrence": list(recurrence),
            },
            index,
        )
        output.append(
            ImportPreviewRow(row.line, row.record, row.errors, tuple((*row.warnings, *warnings)))
        )
    errors = (
        (f"Import accepts at most {MAX_RECORDS} records",) if len(components) > MAX_RECORDS else ()
    )
    return ImportPreview(tuple(output), errors)


def _decode(source: str | bytes) -> str | None:
    if isinstance(source, str):
        return source
    try:
        return source.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return None


def parse_import(filename: str, source: str | bytes) -> ImportPreview:
    size = len(source.encode("utf-8")) if isinstance(source, str) else len(source)
    if size > MAX_BYTES:
        return ImportPreview(errors=("Import source exceeds 5 MiB",))
    text = _decode(source)
    if text is None:
        return ImportPreview(errors=("Import source is not valid UTF-8",))
    lower = filename.lower()
    if lower.endswith(".csv"):
        return parse_csv(text)
    if lower.endswith((".ics", ".ical")):
        return parse_ics(text)
    if lower.endswith(".json"):
        return parse_json(text)
    return ImportPreview(errors=("Import format must be .csv, .json, .ics, or .ical",))


def _record_dict(record: ImportedRecord) -> dict[str, object]:
    value = asdict(record)
    value["exclude"] = list(value.get("exclude", ()))
    value["include"] = list(value.get("include", ()))
    value["recurrence"] = list(value.get("recurrence", ()))
    return value


def export_json(records: Iterable[ImportedRecord]) -> str:
    values = list(records)
    if len(values) > MAX_RECORDS:
        raise ValueError(f"Export accepts at most {MAX_RECORDS} records")
    return json.dumps(
        {"version": 1, "records": [_record_dict(record) for record in values]},
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )


def export_csv(records: Iterable[ImportedRecord]) -> str:
    values = list(records)
    if len(values) > MAX_RECORDS:
        raise ValueError(f"Export accepts at most {MAX_RECORDS} records")
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=CSV_HEADER, lineterminator="\r\n")
    writer.writeheader()
    for record in values:
        value = _record_dict(record)
        row: dict[str, Any] = {name: "" for name in CSV_HEADER}
        row.update(value)
        row["task_list"] = value.get("list", "")
        row["all_day"] = (
            "true" if value.get("all_day") is True else ("false" if record.kind == "event" else "")
        )
        for name in ("exclude", "include", "recurrence"):
            item = value.get(name)
            row[name] = ",".join(item) if isinstance(item, list) else ""
        row.pop("list", None)
        writer.writerow(row)
    return stream.getvalue()


def _escape_ics(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )


def _ics_timestamp(value: str, all_day: bool) -> str:
    if all_day:
        if not _valid_date(value):
            raise ValueError("All-day event dates must be YYYY-MM-DD")
        return value.replace("-", "")
    parsed = _datetime(value)
    if parsed is None:
        raise ValueError("Timed event values must be ISO timestamps")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC)
        return parsed.strftime("%Y%m%dT%H%M%SZ")
    return parsed.strftime("%Y%m%dT%H%M%S")


def export_ics(records: Iterable[ImportedRecord], *, product_id: str = "-//HCB//TUI//EN") -> str:
    values = list(records)
    if len(values) > MAX_RECORDS:
        raise ValueError(f"Export accepts at most {MAX_RECORDS} records")
    if "\r" in product_id or "\n" in product_id:
        raise ValueError("product_id cannot contain newlines")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:{product_id}", "CALSCALE:GREGORIAN"]
    for record in values:
        if not isinstance(record, ImportedEvent):
            continue
        lines.extend(("BEGIN:VEVENT", f"SUMMARY:{_escape_ics(record.title)}"))
        parameter = (
            ";VALUE=DATE"
            if record.all_day
            else (f";TZID={record.time_zone}" if record.time_zone else "")
        )
        lines.append(f"DTSTART{parameter}:{_ics_timestamp(record.start, record.all_day)}")
        lines.append(f"DTEND{parameter}:{_ics_timestamp(record.end, record.all_day)}")
        if record.description:
            lines.append(f"DESCRIPTION:{_escape_ics(record.description)}")
        if record.location:
            lines.append(f"LOCATION:{_escape_ics(record.location)}")
        for recurrence in record.recurrence:
            if not _RECURRENCE.match(recurrence) or "\r" in recurrence or "\n" in recurrence:
                raise ValueError("Invalid calendar recurrence line")
            lines.append(recurrence)
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
