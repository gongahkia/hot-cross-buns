"""Structured, title-first search shared by TUI task and calendar views."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal, Mapping

ResultType = Literal["task", "event", "calendar", "drive"]
WindowKind = Literal["today", "past", "upcoming", "this-week", "next-week", "day", "range"]
Source = Literal["google", "local"]
Priority = Literal["none", "low", "medium", "high"]

_RESULT_TYPES = frozenset(("task", "event", "calendar", "drive"))
_PRIORITIES = frozenset(("none", "low", "medium", "high"))
_TOKEN = re.compile(r'[^\s"]+:"[^"]*"|"[^"]*"|\S+')


@dataclass(frozen=True, slots=True)
class DateWindow:
    kind: WindowKind
    day: str | None = None
    start: str | None = None
    end: str | None = None


@dataclass(frozen=True, slots=True)
class PaletteFilters:
    types: tuple[ResultType, ...] = ()
    calendar_query: str | None = None
    list_query: str | None = None
    source: Source | None = None
    status: str | None = None
    priority: Priority | None = None
    due: DateWindow | Literal["none"] | None = None
    completed: bool | None = None
    date: DateWindow | None = None


@dataclass(frozen=True, slots=True)
class ParsedPaletteQuery:
    text: str
    filters: PaletteFilters
    has_filters: bool
    search_body: bool = False


def _value(item: object, *names: str) -> Any:
    if isinstance(item, Mapping):
        for name in names:
            if name in item:
                return item[name]
        return None
    for name in names:
        if hasattr(item, name):
            return getattr(item, name)
    return None


def _enum_text(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw) if raw is not None else ""


def _valid_date(value: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def date_key(value: str | date | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone().date().isoformat() if value.tzinfo else value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if _valid_date(value):
        return value
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed.astimezone().date().isoformat() if parsed.tzinfo else parsed.date().isoformat()


def parse_date_window(value: str) -> DateWindow | None:
    normalized = value.lower()
    if normalized in {"today", "past", "upcoming", "this-week", "next-week"}:
        return DateWindow(normalized)  # type: ignore[arg-type]
    if _valid_date(value):
        return DateWindow("day", day=value)
    pieces = value.split("..")
    if (
        len(pieces) == 2
        and _valid_date(pieces[0])
        and _valid_date(pieces[1])
        and pieces[0] <= pieces[1]
    ):
        return DateWindow("range", start=pieces[0], end=pieces[1])
    return None


def matches_date_window(
    day: str | date | datetime | None,
    window: DateWindow | None,
    today: str | date | None = None,
) -> bool:
    if window is None:
        return True
    key = date_key(day)
    if key is None:
        return False
    today_key = date_key(today) if today is not None else date.today().isoformat()
    if today_key is None:
        raise ValueError("today must be a valid date")
    if window.kind == "today":
        return key == today_key
    if window.kind == "past":
        return key < today_key
    if window.kind == "upcoming":
        return key >= today_key
    monday = date.fromisoformat(today_key) - timedelta(
        days=date.fromisoformat(today_key).weekday()
    )
    if window.kind == "this-week":
        return monday.isoformat() <= key <= (monday + timedelta(days=6)).isoformat()
    if window.kind == "next-week":
        start = monday + timedelta(days=7)
        return start.isoformat() <= key <= (start + timedelta(days=6)).isoformat()
    if window.kind == "day":
        return key == window.day
    return window.start is not None and window.end is not None and window.start <= key <= window.end


def _unquote(value: str) -> str:
    return value[1:-1] if len(value) >= 2 and value.startswith('"') and value.endswith('"') else value


def _completed(value: str) -> bool | None:
    normalized = value.lower()
    if normalized in {"true", "yes", "done", "completed"}:
        return True
    if normalized in {"false", "no", "open", "incomplete"}:
        return False
    return None


def parse_palette_query(text: str) -> ParsedPaletteQuery:
    types: list[ResultType] = []
    terms: list[str] = []
    calendar_query = list_query = source = status = priority = None
    due: DateWindow | Literal["none"] | None = None
    completed: bool | None = None
    event_date: DateWindow | None = None
    has_filters = False
    search_body = False

    def add_type(value: str) -> None:
        if value in _RESULT_TYPES and value not in types:
            types.append(value)  # type: ignore[arg-type]

    for token in _TOKEN.findall(text.strip()):
        separator = token.find(":")
        if separator <= 0:
            terms.append(_unquote(token))
            continue
        key = token[:separator].lower()
        value = _unquote(token[separator + 1 :])
        normalized = value.lower()
        if key == "type" and normalized in _RESULT_TYPES:
            add_type(normalized)
            has_filters = True
        elif key in {"task", "event", "drive"}:
            add_type(key)
            has_filters = True
            if value:
                terms.append(value)
        elif key == "calendar":
            has_filters = True
            if value:
                calendar_query = value
                add_type("event")
            else:
                add_type("calendar")
        elif key == "in" and value:
            calendar_query = value
            add_type("event")
            has_filters = True
        elif key == "list" and value:
            list_query = value
            add_type("task")
            has_filters = True
        elif key == "source" and normalized in {"google", "local"}:
            source = normalized
            has_filters = True
        elif key == "status" and value:
            status = normalized
            has_filters = True
        elif key == "priority" and normalized in _PRIORITIES:
            priority = normalized
            add_type("task")
            has_filters = True
        elif key == "start" and (window := parse_date_window(value)):
            event_date = window
            add_type("event")
            has_filters = True
        elif key in {"notes", "body"} and normalized != "false":
            search_body = True
            has_filters = True
            if value and normalized != "true":
                terms.append(value)
        elif key == "due" and (
            (window_or_none := ("none" if normalized == "none" else parse_date_window(value)))
            is not None
        ):
            due = window_or_none
            add_type("task")
            has_filters = True
        elif key == "completed" and (done := _completed(value)) is not None:
            completed = done
            add_type("task")
            has_filters = True
        elif key == "date" and (window := parse_date_window(value)):
            event_date = window
            add_type("event")
            has_filters = True
        else:
            terms.append(_unquote(token))
    return ParsedPaletteQuery(
        text=" ".join(terms).strip(),
        filters=PaletteFilters(
            types=tuple(types),
            calendar_query=calendar_query,
            list_query=list_query,
            source=source,  # type: ignore[arg-type]
            status=status,
            priority=priority,  # type: ignore[arg-type]
            due=due,
            completed=completed,
            date=event_date,
        ),
        has_filters=has_filters,
        search_body=search_body,
    )


def includes_result_type(filters: PaletteFilters, result_type: ResultType) -> bool:
    return not filters.types or result_type in filters.types


def matches_calendar(
    calendar_id: str, calendar_name: str | None, query: str | None
) -> bool:
    if not query:
        return True
    target = query.casefold()
    return target in calendar_id.casefold() or (
        calendar_name is not None and target in calendar_name.casefold()
    )


def event_date_key(event: object) -> str | None:
    point = _value(event, "original_start_time", "originalStartTime") or _value(event, "start")
    if point is None:
        return None
    if isinstance(point, Mapping):
        return date_key(point.get("date") or point.get("dateTime") or point.get("date_time"))
    return date_key(_value(point, "value", "date", "date_time", "dateTime"))


def matches_task_filters(
    task: object,
    filters: PaletteFilters,
    today: str | date | None = None,
    metadata: object | None = None,
    list_name: str | None = None,
) -> bool:
    if not includes_result_type(filters, "task"):
        return False
    status = _enum_text(_value(task, "status"))
    if filters.completed is not None and (status == "completed") != filters.completed:
        return False
    if filters.status and status.lower() != filters.status and not (
        filters.status == "open" and status == "needsAction"
    ):
        return False
    task_priority = _enum_text(_value(metadata, "priority")) or "none"
    if filters.priority and task_priority != filters.priority:
        return False
    list_id = str(_value(task, "list_id", "listId") or "")
    if filters.list_query:
        target = filters.list_query.casefold()
        if target not in list_id.casefold() and (
            list_name is None or target not in list_name.casefold()
        ):
            return False
    if filters.source == "local":
        return False
    due_value = _value(task, "due")
    if filters.due == "none":
        return due_value is None
    if filters.due is None:
        return True
    if filters.due.kind == "past" and status == "completed":
        return False
    return matches_date_window(due_value, filters.due, today)


def matches_event_filters(
    event: object,
    filters: PaletteFilters,
    calendar_name: str | None = None,
    today: str | date | None = None,
) -> bool:
    if not includes_result_type(filters, "event") or filters.source == "local":
        return False
    status = _enum_text(_value(event, "status"))
    if filters.status and status.lower() != filters.status:
        return False
    calendar_id = str(_value(event, "calendar_id", "calendarId") or "")
    return matches_calendar(calendar_id, calendar_name, filters.calendar_query) and matches_date_window(
        event_date_key(event), filters.date, today
    )


def _contains(value: object, query: str) -> bool:
    return isinstance(value, str) and query.casefold() in value.casefold()


def matches_task(
    task: object,
    query: str | ParsedPaletteQuery,
    *,
    today: str | date | None = None,
    metadata: object | None = None,
    list_name: str | None = None,
) -> bool:
    parsed = parse_palette_query(query) if isinstance(query, str) else query
    if not matches_task_filters(task, parsed.filters, today, metadata, list_name):
        return False
    if not parsed.text:
        return True
    if _contains(_value(task, "title"), parsed.text):
        return True
    return parsed.search_body and _contains(_value(task, "notes"), parsed.text)


def matches_event(
    event: object,
    query: str | ParsedPaletteQuery,
    *,
    calendar_name: str | None = None,
    today: str | date | None = None,
) -> bool:
    parsed = parse_palette_query(query) if isinstance(query, str) else query
    if not matches_event_filters(event, parsed.filters, calendar_name, today):
        return False
    if not parsed.text:
        return True
    if _contains(_value(event, "summary", "title"), parsed.text):
        return True
    return parsed.search_body and any(
        _contains(_value(event, field), parsed.text)
        for field in ("description", "location")
    )


def matches_calendar_result(calendar: object, query: str | ParsedPaletteQuery) -> bool:
    parsed = parse_palette_query(query) if isinstance(query, str) else query
    if not includes_result_type(parsed.filters, "calendar"):
        return False
    if parsed.filters.source == "local":
        return False
    if not parsed.text:
        return True
    return _contains(_value(calendar, "summary", "name"), parsed.text)
