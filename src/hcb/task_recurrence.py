"""Portable Google Tasks recurrence and reminder metadata.

The wire format intentionally matches the web client's HCB markers.  Dates are
date-only values: recurrence calculation never converts them through a local
time zone.
"""

from __future__ import annotations

import calendar
import json
import re
from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

Frequency = Literal["daily", "weekly", "monthly", "yearly"]
Priority = Literal["none", "low", "medium", "high"]
NoteState = Literal["unmanaged", "managed", "malformed", "unsupported-version"]

NOTES_LIMIT = 8_192
_RECURRENCE_PREFIX = "[HCB-RECURRENCE v"
_RECURRENCE_SUFFIX = "\n[/HCB-RECURRENCE]"
_TASK_PREFIX = "[HCB-TASK v"
_TASK_SUFFIX = "\n[/HCB-TASK]"
_FREQUENCIES = frozenset(("daily", "weekly", "monthly", "yearly"))
_PRIORITIES = frozenset(("none", "low", "medium", "high"))
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_DAY_NAMES = {"MO": 1, "TU": 2, "WE": 3, "TH": 4, "FR": 5, "SA": 6, "SU": 7}


@dataclass(frozen=True, slots=True)
class RecurrenceEnd:
    kind: Literal["never", "until", "count"]
    until_date: str | None = None
    count: int | None = None


@dataclass(frozen=True, slots=True)
class TaskRecurrenceMarker:
    series_id: str
    occurrence_id: str
    ordinal: int
    frequency: Frequency
    interval: int
    anchor_date: str
    time_zone: str
    end: RecurrenceEnd
    recurrence_rule: str
    exclusion_dates: tuple[str, ...]
    addition_dates: tuple[str, ...]
    template_title: str
    template_due_date: str
    template_priority: Priority


@dataclass(frozen=True, slots=True)
class TaskReminder:
    time: str
    time_zone: str


@dataclass(frozen=True, slots=True)
class TaskRecurrenceNotes:
    state: NoteState
    user_notes: str
    marker: TaskRecurrenceMarker | None = None
    reminder: TaskReminder | None = None
    diagnostic: str | None = None


@dataclass(frozen=True, slots=True)
class SerializationResult:
    notes: str | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class _Rule:
    frequency: Frequency
    interval: int
    weekdays: frozenset[int]
    ordinal_weekdays: dict[int, frozenset[int]]
    month_days: frozenset[int]
    months: frozenset[int]


def _integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _date(value: object) -> date | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _valid_zone(value: object) -> bool:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 128
        or value.strip() != value
        or "\0" in value
    ):
        return False
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def _valid_title(value: object) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= 500
        and value.strip() == value
        and "\0" not in value
    )


def _valid_dates(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) <= 10_000
        and all(_date(item) is not None for item in value)
        and len(set(value)) == len(value)
    )


def _parse_rule(rule: str) -> _Rule | None:
    if not rule or len(rule) > 512 or rule.strip() != rule or "\0" in rule:
        return None
    values: dict[str, str] = {}
    allowed = {"FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH"}
    for part in rule.split(";"):
        pieces = part.split("=")
        if (
            len(pieces) != 2
            or not pieces[0]
            or not pieces[1]
            or pieces[0] != pieces[0].upper()
            or pieces[1] != pieces[1].upper()
            or pieces[0] not in allowed
            or pieces[0] in values
        ):
            return None
        values[pieces[0]] = pieces[1]
    frequency = values.get("FREQ", "").lower()
    if frequency not in _FREQUENCIES:
        return None
    try:
        interval = int(values.get("INTERVAL", "1"))
    except ValueError:
        return None
    if str(interval) != values.get("INTERVAL", str(interval)) or not 1 <= interval <= 1_000:
        return None

    weekdays: set[int] = set()
    ordinal_weekdays: dict[int, set[int]] = {}
    for token in values.get("BYDAY", "").split(",") if "BYDAY" in values else ():
        match = re.fullmatch(r"(-?[1-5])?(MO|TU|WE|TH|FR|SA|SU)", token)
        if not match:
            return None
        day = _DAY_NAMES[match.group(2)]
        if match.group(1):
            ordinal_weekdays.setdefault(int(match.group(1)), set()).add(day)
        else:
            weekdays.add(day)

    def number_set(key: str, minimum: int, maximum: int, disallow_zero: bool) -> set[int] | None:
        output: set[int] = set()
        for token in values.get(key, "").split(",") if key in values else ():
            try:
                number = int(token)
            except ValueError:
                return None
            if str(number) != token or number < minimum or number > maximum:
                return None
            if disallow_zero and number == 0:
                return None
            output.add(number)
        return output

    month_days = number_set("BYMONTHDAY", -31, 31, True)
    months = number_set("BYMONTH", 1, 12, False)
    if month_days is None or months is None:
        return None
    return _Rule(
        frequency=frequency,  # type: ignore[arg-type]
        interval=interval,
        weekdays=frozenset(weekdays),
        ordinal_weekdays={key: frozenset(items) for key, items in ordinal_weekdays.items()},
        month_days=frozenset(month_days),
        months=frozenset(months),
    )


def validate_marker(marker: TaskRecurrenceMarker) -> str | None:
    if not _UUID.fullmatch(marker.series_id):
        return "series identifier is invalid"
    if (
        not _integer(marker.ordinal)
        or marker.ordinal < 0
        or marker.occurrence_id != f"{marker.series_id}:{marker.ordinal}"
    ):
        return "occurrence identity is invalid"
    if (
        marker.frequency not in _FREQUENCIES
        or not _integer(marker.interval)
        or not 1 <= marker.interval <= 1_000
    ):
        return "rule is invalid"
    if (
        _date(marker.anchor_date) is None
        or _date(marker.template_due_date) is None
        or not _valid_title(marker.template_title)
        or marker.template_priority not in _PRIORITIES
    ):
        return "template is invalid"
    if not _valid_zone(marker.time_zone):
        return "timezone is invalid"
    rule = _parse_rule(marker.recurrence_rule) if marker.recurrence_rule else None
    if marker.recurrence_rule and rule is None:
        return "date-only recurrence rule is invalid"
    if rule and (rule.frequency != marker.frequency or rule.interval != marker.interval):
        return "date-only recurrence rule is invalid"
    exclusions = list(marker.exclusion_dates)
    additions = list(marker.addition_dates)
    if not _valid_dates(exclusions) or not _valid_dates(additions):
        return "recurrence date exceptions are invalid"
    if marker.anchor_date in exclusions or any(day < marker.anchor_date for day in additions):
        return "recurrence date exceptions are outside the series"
    if marker.end.kind == "never" and marker.end.until_date is None and marker.end.count is None:
        return None
    if marker.end.kind == "until" and marker.end.count is None:
        return (
            None
            if _date(marker.end.until_date) is not None
            and marker.end.until_date is not None
            and marker.end.until_date >= marker.anchor_date
            else "until end condition is invalid"
        )
    if marker.end.kind == "count" and marker.end.until_date is None:
        return (
            None
            if _integer(marker.end.count)
            and marker.end.count is not None
            and 1 <= marker.end.count <= 10_000
            else "count end condition is invalid"
        )
    return "end condition is invalid"


def _payload_to_marker(payload: object, version: int) -> TaskRecurrenceMarker | None:
    if not isinstance(payload, dict):
        return None
    expected = (
        {"a", "d", "e", "i", "n", "o", "q", "r", "s", "t", "x", "z"}
        if version == 2
        else {"a", "e", "i", "n", "o", "r", "s", "t", "z"}
    )
    if set(payload) != expected:
        return None
    end = payload["e"]
    template = payload["t"]
    if (
        not isinstance(end, dict)
        or not isinstance(template, dict)
        or set(template) != {"d", "p", "t"}
    ):
        return None
    if set(end) == {"k"} and end.get("k") == "never":
        end_value = RecurrenceEnd("never")
    elif set(end) == {"k", "u"} and end.get("k") == "until" and _date(end.get("u")):
        end_value = RecurrenceEnd("until", until_date=end["u"])
    elif set(end) == {"k", "c"} and end.get("k") == "count" and _integer(end.get("c")):
        end_value = RecurrenceEnd("count", count=end["c"])
    else:
        return None
    if (
        _date(template.get("d")) is None
        or not _valid_title(template.get("t"))
        or template.get("p") not in _PRIORITIES
        or _date(payload["a"]) is None
        or not _integer(payload["i"])
        or not _integer(payload["n"])
        or not isinstance(payload["o"], str)
        or payload["r"] not in _FREQUENCIES
        or not isinstance(payload["s"], str)
        or not _valid_zone(payload["z"])
    ):
        return None
    if version == 2 and (
        not isinstance(payload["q"], str)
        or not _valid_dates(payload["d"])
        or not _valid_dates(payload["x"])
    ):
        return None
    marker = TaskRecurrenceMarker(
        series_id=payload["s"],
        occurrence_id=payload["o"],
        ordinal=payload["n"],
        frequency=payload["r"],
        interval=payload["i"],
        anchor_date=payload["a"],
        time_zone=payload["z"],
        end=end_value,
        recurrence_rule=payload["q"] if version == 2 else "",
        exclusion_dates=tuple(payload["x"]) if version == 2 else (),
        addition_dates=tuple(payload["d"]) if version == 2 else (),
        template_title=template["t"],
        template_due_date=template["d"],
        template_priority=template["p"],
    )
    return marker if validate_marker(marker) is None else None


def _parse_envelope(
    notes: str, prefix: str, suffix: str, supported: frozenset[int], task: bool
) -> TaskRecurrenceNotes | None:
    start = notes.find(prefix)
    if start < 0:
        return None
    label = "task" if task else "recurrence"
    if notes.find(prefix, start + len(prefix)) >= 0:
        return TaskRecurrenceNotes(
            "malformed",
            notes,
            diagnostic=f"HCB {label} marker is malformed: multiple marker headers exist",
        )
    header_end = notes.find("]\n", start + len(prefix))
    if start < 2 or notes[start - 2 : start] != "\n\n" or header_end < 0:
        return TaskRecurrenceNotes(
            "malformed",
            notes,
            diagnostic=f"HCB {label} marker is malformed: marker boundary is invalid",
        )
    version_text = notes[start + len(prefix) : header_end]
    end = notes.find(suffix, header_end + 2)
    if (
        not version_text.isdecimal()
        or int(version_text) < 1
        or end < 0
        or end + len(suffix) != len(notes)
    ):
        return TaskRecurrenceNotes(
            "malformed",
            notes,
            diagnostic=f"HCB {label} marker is malformed: marker envelope is invalid",
        )
    version = int(version_text)
    if version not in supported:
        return TaskRecurrenceNotes(
            "unsupported-version",
            notes,
            diagnostic=f"HCB {label} marker version is unsupported",
        )
    payload_text = notes[header_end + 2 : end]
    if not payload_text or "\n" in payload_text or len(payload_text.encode()) > NOTES_LIMIT:
        return TaskRecurrenceNotes(
            "malformed",
            notes,
            diagnostic=f"HCB {label} marker is malformed: marker payload is invalid",
        )
    try:
        payload: Any = json.loads(payload_text)
    except (json.JSONDecodeError, UnicodeError):
        return TaskRecurrenceNotes(
            "malformed",
            notes,
            diagnostic=f"HCB {label} marker is malformed: marker payload is not a JSON object",
        )
    user_notes = notes[: start - 2]
    if not task:
        marker = _payload_to_marker(payload, version)
        return (
            TaskRecurrenceNotes("managed", user_notes, marker=marker)
            if marker
            else TaskRecurrenceNotes(
                "malformed",
                notes,
                diagnostic="HCB recurrence marker is malformed: payload fields are invalid",
            )
        )
    if not isinstance(payload, dict) or not set(payload) <= {"m", "r"} or not payload:
        return TaskRecurrenceNotes(
            "malformed",
            notes,
            diagnostic="HCB task marker is malformed: payload fields are invalid",
        )
    reminder = None
    if "m" in payload:
        value = payload["m"]
        if (
            not isinstance(value, dict)
            or set(value) != {"t", "z"}
            or not isinstance(value["t"], str)
            or not _TIME.fullmatch(value["t"])
            or not _valid_zone(value["z"])
        ):
            return TaskRecurrenceNotes(
                "malformed",
                notes,
                diagnostic="HCB task marker is malformed: payload fields are invalid",
            )
        reminder = TaskReminder(value["t"], value["z"])
    marker = _payload_to_marker(payload["r"], 2) if "r" in payload else None
    if "r" in payload and marker is None:
        return TaskRecurrenceNotes(
            "malformed",
            notes,
            diagnostic="HCB task marker is malformed: payload fields are invalid",
        )
    return TaskRecurrenceNotes(
        "managed" if marker else "unmanaged", user_notes, marker=marker, reminder=reminder
    )


def parse_task_recurrence_notes(notes: str = "") -> TaskRecurrenceNotes:
    if _TASK_PREFIX in notes:
        result = _parse_envelope(notes, _TASK_PREFIX, _TASK_SUFFIX, frozenset({1}), True)
        assert result is not None
        return result
    result = _parse_envelope(
        notes, _RECURRENCE_PREFIX, _RECURRENCE_SUFFIX, frozenset({1, 2}), False
    )
    return result if result is not None else TaskRecurrenceNotes("unmanaged", notes)


def _recurrence_payload(marker: TaskRecurrenceMarker) -> dict[str, object]:
    if marker.end.kind == "never":
        end: dict[str, object] = {"k": "never"}
    elif marker.end.kind == "until":
        end = {"k": "until", "u": marker.end.until_date}
    else:
        end = {"c": marker.end.count, "k": "count"}
    return {
        "a": marker.anchor_date,
        "d": list(marker.addition_dates),
        "e": end,
        "i": marker.interval,
        "n": marker.ordinal,
        "o": marker.occurrence_id,
        "q": marker.recurrence_rule,
        "r": marker.frequency,
        "s": marker.series_id,
        "t": {
            "d": marker.template_due_date,
            "p": marker.template_priority,
            "t": marker.template_title,
        },
        "x": list(marker.exclusion_dates),
        "z": marker.time_zone,
    }


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def serialize_task_recurrence_notes(
    user_notes: str, marker: TaskRecurrenceMarker
) -> SerializationResult:
    if "\0" in user_notes:
        return SerializationResult(error="Task notes contain a null character")
    error = validate_marker(marker)
    if error:
        return SerializationResult(error=f"HCB recurrence marker is invalid: {error}")
    notes = (
        f"{user_notes}\n\n{_RECURRENCE_PREFIX}2]\n"
        f"{_json(_recurrence_payload(marker))}{_RECURRENCE_SUFFIX}"
    )
    return (
        SerializationResult(notes=notes)
        if len(notes.encode()) <= NOTES_LIMIT
        else SerializationResult(error="Task notes and recurrence marker exceed Google Tasks limit")
    )


def serialize_task_notes(
    user_notes: str,
    marker: TaskRecurrenceMarker | None = None,
    reminder: TaskReminder | None = None,
) -> SerializationResult:
    if reminder is None:
        if marker is not None:
            return serialize_task_recurrence_notes(user_notes, marker)
        return SerializationResult(notes=user_notes or None)
    if "\0" in user_notes:
        return SerializationResult(error="Task notes contain a null character")
    if not _TIME.fullmatch(reminder.time) or not _valid_zone(reminder.time_zone):
        return SerializationResult(error="Task reminder time or time zone is invalid")
    error = validate_marker(marker) if marker else None
    if error:
        return SerializationResult(error=f"HCB recurrence marker is invalid: {error}")
    payload: dict[str, object] = {"m": {"t": reminder.time, "z": reminder.time_zone}}
    if marker:
        payload["r"] = _recurrence_payload(marker)
    notes = f"{user_notes}\n\n{_TASK_PREFIX}1]\n{_json(payload)}{_TASK_SUFFIX}"
    return (
        SerializationResult(notes=notes)
        if len(notes.encode()) <= NOTES_LIMIT
        else SerializationResult(error="Task notes and reminder marker exceed Google Tasks limit")
    )


def _add_months(value: date, amount: int) -> date:
    month_index = value.year * 12 + value.month - 1 + amount
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def _matches_rule(value: date, anchor: date, rule: _Rule) -> bool:
    if value < anchor or (rule.months and value.month not in rule.months):
        return False
    days = (value - anchor).days
    months = (value.year - anchor.year) * 12 + value.month - anchor.month
    years = value.year - anchor.year
    if rule.frequency == "daily" and days % rule.interval:
        return False
    if rule.frequency == "weekly":
        anchor_week = anchor - timedelta(days=anchor.isoweekday() - 1)
        value_week = value - timedelta(days=value.isoweekday() - 1)
        if ((value_week - anchor_week).days // 7) % rule.interval:
            return False
    if rule.frequency == "monthly" and (months < 0 or months % rule.interval):
        return False
    if rule.frequency == "yearly" and (years < 0 or years % rule.interval):
        return False
    if rule.weekdays and value.isoweekday() not in rule.weekdays:
        return False
    if rule.ordinal_weekdays:
        month_end = calendar.monthrange(value.year, value.month)[1]
        from_start = (value.day - 1) // 7 + 1
        from_end = -((month_end - value.day) // 7 + 1)
        if value.isoweekday() not in rule.ordinal_weekdays.get(
            from_start, ()
        ) and value.isoweekday() not in rule.ordinal_weekdays.get(from_end, ()):
            return False
    last_day = calendar.monthrange(value.year, value.month)[1]
    if (
        rule.month_days
        and value.day not in rule.month_days
        and value.day - last_day - 1 not in rule.month_days
    ):
        return False
    if not rule.weekdays and not rule.ordinal_weekdays and not rule.month_days:
        if rule.frequency == "weekly" and value.isoweekday() != anchor.isoweekday():
            return False
        if rule.frequency == "monthly" and value != _add_months(anchor, months):
            return False
        if rule.frequency == "yearly" and value != _add_months(anchor, years * 12):
            return False
    return True


def task_recurrence_date(marker: TaskRecurrenceMarker, ordinal: int) -> str | None:
    if not _integer(ordinal) or ordinal < 0 or validate_marker(marker):
        return None
    anchor = date.fromisoformat(marker.anchor_date)
    if marker.recurrence_rule:
        rule = _parse_rule(marker.recurrence_rule)
        if rule is None:
            return None
        excluded = set(marker.exclusion_dates)
        additions = set(marker.addition_dates)
        current = anchor
        seen = 0
        try:
            horizon = _add_months(anchor, 12_000)
        except ValueError:
            horizon = date.max
        while current <= horizon:
            text = current.isoformat()
            if text not in excluded and (text in additions or _matches_rule(current, anchor, rule)):
                if seen == ordinal:
                    return text
                seen += 1
                if seen > 10_000:
                    return None
            if current == date.max:
                break
            current += timedelta(days=1)
        return None
    if marker.frequency == "daily":
        result = anchor + timedelta(days=marker.interval * ordinal)
    elif marker.frequency == "weekly":
        result = anchor + timedelta(days=marker.interval * ordinal * 7)
    elif marker.frequency == "monthly":
        result = _add_months(anchor, marker.interval * ordinal)
    else:
        result = _add_months(anchor, marker.interval * ordinal * 12)
    return result.isoformat()


def task_recurrence_successor(marker: TaskRecurrenceMarker) -> TaskRecurrenceMarker | None:
    if marker.ordinal >= 2_147_483_647 or validate_marker(marker):
        return None
    ordinal = marker.ordinal + 1
    due = task_recurrence_date(marker, ordinal)
    if (
        due is None
        or (
            marker.end.kind == "until"
            and marker.end.until_date is not None
            and due > marker.end.until_date
        )
        or (
            marker.end.kind == "count"
            and marker.end.count is not None
            and ordinal >= marker.end.count
        )
    ):
        return None
    return replace(
        marker,
        ordinal=ordinal,
        occurrence_id=f"{marker.series_id}:{ordinal}",
        template_due_date=due,
    )


def task_recurrence_summary(marker: TaskRecurrenceMarker) -> str:
    if marker.recurrence_rule:
        result = f"Custom: {marker.recurrence_rule}"
        if marker.exclusion_dates:
            result += f" · skips {len(marker.exclusion_dates)} date(s)"
        if marker.addition_dates:
            result += f" · adds {len(marker.addition_dates)} date(s)"
        return result
    plural = "days" if marker.frequency == "daily" else f"{marker.frequency}s"
    result = (
        f"Every {marker.frequency}" if marker.interval == 1 else f"Every {marker.interval} {plural}"
    )
    if marker.end.kind == "until":
        result += f" until {marker.end.until_date}"
    if marker.end.kind == "count":
        result += f" for {marker.end.count} occurrences"
    return result
