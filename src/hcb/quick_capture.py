"""Natural-language quick capture parser.

The matching, span, and date/time rules follow the web TypeScript parser. Dates
and times are computed from a timezone-naive local datetime, using wall-clock
fields the same way JavaScript ``Date`` local getters do.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from .models import CapturePreferences as QuickCapturePreferences

QuickCaptureKind = Literal["task", "event"]
TaskPriority = Literal["none", "low", "medium", "high"]
RecurrenceFrequency = Literal["daily", "weekly", "monthly", "yearly"]

_REGEX_FLAGS = re.IGNORECASE | re.ASCII
_ALIAS_ESCAPE = re.compile(r"[.*+?^${}()|[\]\\]")
_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b", _REGEX_FLAGS)
_TODAY = re.compile(r"\btoday\b", _REGEX_FLAGS)
_TOMORROW = re.compile(r"\btomorrow\b", _REGEX_FLAGS)
_NEXT_WEEKDAY = re.compile(
    r"\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
    _REGEX_FLAGS,
)
_RELATIVE = re.compile(r"\bin\s+(\d{1,3})\s+(days?|weeks?)\b", _REGEX_FLAGS)
_NAMED_DATE = re.compile(
    r"\b(january|february|march|april|may|june|july|august|september|october|november|december)"
    r"\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b",
    _REGEX_FLAGS,
)
_TWELVE_HOUR = re.compile(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", _REGEX_FLAGS)
_TWENTY_FOUR_HOUR = re.compile(r"\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b", _REGEX_FLAGS)
_RECURRENCE = re.compile(r"\bevery(?:\s+(\d{1,3}))?\s+(day|week|month|year)s?\b", _REGEX_FLAGS)
_DURATION = re.compile(
    r"\bfor\s+(\d{1,4})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b",
    _REGEX_FLAGS,
)
_WEEKDAYS = ("sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday")
_MONTHS = (
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
)
_FREQUENCIES: dict[str, RecurrenceFrequency] = {
    "day": "daily",
    "week": "weekly",
    "month": "monthly",
    "year": "yearly",
}


@dataclass(frozen=True, slots=True)
class QuickCaptureRecognition:
    id: str
    label: str
    removable: bool


@dataclass(frozen=True, slots=True)
class QuickCaptureRecurrence:
    frequency: RecurrenceFrequency
    interval: int
    rrule: str


@dataclass(frozen=True, slots=True)
class QuickCaptureResult:
    kind: QuickCaptureKind
    raw_title: str
    parsed_title: str
    all_day: bool
    event_duration_minutes: int
    task_priority: TaskPriority
    recognitions: tuple[QuickCaptureRecognition, ...]
    event_ready: bool
    date: str | None = None
    time: str | None = None
    recurrence: QuickCaptureRecurrence | None = None


@dataclass(frozen=True, slots=True)
class _Span:
    id: str
    label: str
    removable: bool
    start: int
    length: int

    def as_recognition(self) -> QuickCaptureRecognition:
        return QuickCaptureRecognition(id=self.id, label=self.label, removable=self.removable)


def _local_date(value: datetime) -> str:
    return f"{value.year:04d}-{value.month:02d}-{value.day:02d}"


def _add_days(value: datetime, amount: int) -> datetime:
    return value + timedelta(days=amount)


def _js_weekday(value: datetime) -> int:
    return (value.weekday() + 1) % 7


def _escape_alias(alias: str) -> str:
    return _ALIAS_ESCAPE.sub(lambda match: f"\\{match.group(0)}", alias)


def _alias_match(text: str, aliases: Sequence[str]) -> re.Match[str] | None:
    safe = [_escape_alias(alias.strip()) for alias in aliases if alias.strip()]
    if not safe:
        return None
    return re.search(rf"\b(?:{'|'.join(safe)})\b", text, _REGEX_FLAGS)


def _span_for(match: re.Match[str], prefix: str, label: str, removable: bool = True) -> _Span:
    start = match.start()
    length = len(match.group(0))
    return _Span(
        id=f"{prefix}:{start}:{length}",
        label=label,
        removable=removable,
        start=start,
        length=length,
    )


def _overlaps(left: _Span, right: _Span) -> bool:
    return left.start < right.start + right.length and right.start < left.start + left.length


def _use_span(
    spans: list[_Span],
    disabled: set[str],
    span: _Span,
    recognitions: list[QuickCaptureRecognition],
) -> bool:
    if span.id in disabled or any(_overlaps(existing, span) for existing in spans):
        return False
    spans.append(span)
    recognitions.append(span.as_recognition())
    return True


def _try_datetime(
    year: int, month: int, day: int, hour: int = 0, minute: int = 0
) -> datetime | None:
    try:
        return datetime(year, month, day, hour, minute)
    except ValueError:
        return None


def _parse_date(text: str, now: datetime) -> tuple[str, _Span] | None:
    numeric = _ISO_DATE.search(text)
    if numeric:
        year, month, day = (int(numeric.group(1)), int(numeric.group(2)), int(numeric.group(3)))
        candidate = _try_datetime(year, month, day)
        if candidate is not None:
            return _local_date(candidate), _span_for(numeric, "date", _local_date(candidate))

    today = _TODAY.search(text)
    if today:
        return _local_date(now), _span_for(today, "date", _local_date(now))

    tomorrow = _TOMORROW.search(text)
    if tomorrow:
        date = _add_days(now, 1)
        return _local_date(date), _span_for(tomorrow, "date", _local_date(date))

    next_weekday = _NEXT_WEEKDAY.search(text)
    if next_weekday:
        target = _WEEKDAYS.index(next_weekday.group(1).lower())
        days = ((target - _js_weekday(now) + 6) % 7) + 1
        date = _add_days(now, days)
        return _local_date(date), _span_for(next_weekday, "date", _local_date(date))

    relative = _RELATIVE.search(text)
    if relative:
        unit = relative.group(2).lower()
        date = _add_days(now, int(relative.group(1)) * (7 if unit.startswith("week") else 1))
        return _local_date(date), _span_for(relative, "date", _local_date(date))

    named = _NAMED_DATE.search(text)
    if named:
        month = _MONTHS.index(named.group(1).lower()) + 1
        day = int(named.group(2))
        year = int(named.group(3)) if named.group(3) else now.year
        named_date = _try_datetime(year, month, day)
        if named_date is None:
            return None
        if named.group(3) is None and named_date < datetime(now.year, now.month, now.day):
            rolled = _try_datetime(year + 1, month, day)
            if rolled is None:
                return None
            named_date = rolled
        return _local_date(named_date), _span_for(named, "date", _local_date(named_date))
    return None


def _parse_time(text: str) -> tuple[str, _Span] | None:
    twelve_hour = _TWELVE_HOUR.search(text)
    if twelve_hour:
        hour = int(twelve_hour.group(1))
        minute = int(twelve_hour.group(2) or "0")
        if 1 <= hour <= 12 and minute <= 59:
            hour %= 12
            if twelve_hour.group(3).lower() == "pm":
                hour += 12
            time = f"{hour:02d}:{minute:02d}"
            return time, _span_for(twelve_hour, "time", time)

    twenty_four_hour = _TWENTY_FOUR_HOUR.search(text)
    if twenty_four_hour is None:
        return None
    time = f"{int(twenty_four_hour.group(1)):02d}:{twenty_four_hour.group(2)}"
    return time, _span_for(twenty_four_hour, "time", time)


def _remove_spans(text: str, spans: Sequence[_Span]) -> str:
    result = text
    removable = sorted(
        (span for span in spans if span.removable),
        key=lambda span: span.start,
        reverse=True,
    )
    for span in removable:
        result = f"{result[: span.start]}{result[span.start + span.length :]}"
    return re.sub(r"\s+", " ", result).strip()


def parse_quick_capture(
    text: str,
    requested_kind: QuickCaptureKind,
    preferences: QuickCapturePreferences | None = None,
    disabled_recognition_ids: Sequence[str] = (),
    now: datetime | None = None,
) -> QuickCaptureResult:
    preferences = preferences or QuickCapturePreferences()
    current = now if now is not None else datetime.now()
    disabled = set(disabled_recognition_ids)
    spans: list[_Span] = []
    recognitions: list[QuickCaptureRecognition] = []
    kind: QuickCaptureKind = requested_kind

    task_alias = _alias_match(text, preferences.task_aliases)
    event_alias = _alias_match(text, preferences.event_aliases)
    first_alias: tuple[QuickCaptureKind, re.Match[str], str] | None
    if task_alias is None or (event_alias is not None and event_alias.start() < task_alias.start()):
        first_alias = ("event", event_alias, "Event") if event_alias is not None else None
    else:
        first_alias = ("task", task_alias, "Task")
    if first_alias is not None:
        match_kind, match, label = first_alias
        span = _span_for(match, "type", label)
        if _use_span(spans, disabled, span, recognitions):
            kind = match_kind

    task_priority: TaskPriority = "none"
    if kind == "task":
        priorities: tuple[tuple[tuple[str, ...], TaskPriority, str], ...] = (
            (preferences.high_priority_aliases, "high", "High priority"),
            (preferences.medium_priority_aliases, "medium", "Medium priority"),
            (preferences.low_priority_aliases, "low", "Low priority"),
        )
        for aliases, priority, label in priorities:
            priority_match = _alias_match(text, aliases)
            if priority_match and _use_span(
                spans, disabled, _span_for(priority_match, "priority", label), recognitions
            ):
                task_priority = priority
                break

    recurrence: QuickCaptureRecurrence | None = None
    recurrence_match = _RECURRENCE.search(text)
    if recurrence_match:
        interval = int(recurrence_match.group(1) or "1")
        unit = recurrence_match.group(2).lower()
        frequency = _FREQUENCIES[unit]
        label = f"Repeats every {unit}" if interval == 1 else f"Repeats every {interval} {unit}s"
        if _use_span(
            spans, disabled, _span_for(recurrence_match, "recurrence", label), recognitions
        ):
            recurrence = QuickCaptureRecurrence(
                frequency=frequency,
                interval=interval,
                rrule=f"RRULE:FREQ={frequency.upper()};INTERVAL={interval}",
            )

    event_duration_minutes = max(1, min(1_440, preferences.default_event_duration_minutes or 30))
    if kind == "event":
        duration = _DURATION.search(text)
        if duration:
            unit = duration.group(2).lower()
            minutes = int(duration.group(1)) * (60 if unit.startswith("h") else 1)
            if 1 <= minutes <= 1_440 and _use_span(
                spans,
                disabled,
                _span_for(duration, "duration", f"{minutes} minutes"),
                recognitions,
            ):
                event_duration_minutes = minutes

    parsed_date = _parse_date(text, current)
    date = parsed_date[0] if parsed_date else None
    if parsed_date:
        _use_span(spans, disabled, parsed_date[1], recognitions)

    parsed_time = _parse_time(text)
    time = parsed_time[0] if parsed_time else None
    if parsed_time and kind == "event":
        _use_span(spans, disabled, parsed_time[1], recognitions)
    if parsed_time and kind == "task" and parsed_time[1].id not in disabled:
        recognitions.append(
            QuickCaptureRecognition(
                id=parsed_time[1].id,
                label=f"{parsed_time[0]} remains in task title",
                removable=False,
            )
        )
    if kind == "task" and recurrence is not None and date is None:
        date = _local_date(current)
    if kind == "event" and time is not None and date is None:
        hour, minute = (int(part) for part in time.split(":"))
        today_at_time = datetime(current.year, current.month, current.day, hour, minute)
        date = _local_date(_add_days(current, 1) if today_at_time <= current else current)

    parsed_title = (
        text.strip() if preferences.remove_recognized_text is False else _remove_spans(text, spans)
    )
    return QuickCaptureResult(
        kind=kind,
        raw_title=text.strip(),
        parsed_title=parsed_title,
        date=date,
        time=time,
        all_day=kind == "event" and bool(date) and not time,
        event_duration_minutes=event_duration_minutes,
        task_priority=task_priority,
        recurrence=recurrence,
        recognitions=tuple(recognitions),
        event_ready=kind == "task" or bool(date),
    )
