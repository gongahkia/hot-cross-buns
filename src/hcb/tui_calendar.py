"""Calendar-grid projection and geometry shared by HCB's TUI widgets.

The calendar widgets deliberately consume this small, UI-neutral geometry
model.  Keeping timezone conversion and collision packing out of Textual's
render loop makes the behaviour testable without a terminal.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from .models import DateTimeKind, Event, Task, TaskStatus

CalendarSurface = Literal["Day", "Week", "Month"]
CalendarKind = Literal["event", "task"]


@dataclass(frozen=True, slots=True)
class CalendarRange:
    """The complete range painted by a calendar surface, end-exclusive."""

    start: date
    end: date
    days: int


@dataclass(frozen=True, slots=True)
class CalendarItem:
    """A domain item normalized to local calendar dates and clock minutes."""

    kind: CalendarKind
    item_id: str
    title: str
    color: str
    all_day: bool
    start_date: date
    end_date: date
    start_minute: int | None
    end_minute: int | None
    completed: bool = False
    recurring: bool = False


@dataclass(frozen=True, slots=True)
class CalendarBlock:
    """A visible item fragment with a day span and optional timed geometry."""

    item: CalendarItem
    start_day: int
    end_day: int
    lane: int = 0
    column: int = 0
    column_count: int = 1
    start_minute: int | None = None
    end_minute: int | None = None


def calendar_range(
    surface: CalendarSurface, selected_date: date, week_starts_on: int
) -> CalendarRange:
    """Return the full painted date range for the requested calendar surface."""
    if surface == "Day":
        return CalendarRange(selected_date, selected_date + timedelta(days=1), 1)
    if surface == "Week":
        offset = (selected_date.weekday() - week_starts_on) % 7
        start = selected_date - timedelta(days=offset)
        return CalendarRange(start, start + timedelta(days=7), 7)
    first = selected_date.replace(day=1)
    offset = (first.weekday() - week_starts_on) % 7
    start = first - timedelta(days=offset)
    # A month grid is always six rows so its geometry is stable while moving
    # between months, including February and a Sunday/Monday week preference.
    return CalendarRange(start, start + timedelta(days=42), 42)


def _local_datetime(value: datetime, zone: ZoneInfo) -> datetime:
    return (value if value.tzinfo else value.replace(tzinfo=zone)).astimezone(zone)


def _event_color(event: Event, calendar_colors: dict[str, str], fallback: str) -> str:
    if event.color_id and event.color_id.startswith("#"):
        return event.color_id
    return calendar_colors.get(event.calendar_id, fallback)


def calendar_items(
    events: tuple[Event, ...],
    tasks: tuple[Task, ...],
    *,
    visible: CalendarRange,
    zone: ZoneInfo,
    calendar_colors: dict[str, str],
    fallback_color: str,
) -> tuple[CalendarItem, ...]:
    """Normalize visible events and due tasks for one calendar grid.

    All-day end dates use the iCalendar/Google exclusive convention. Timed
    values are converted to the configured display timezone before geometry is
    calculated, which keeps placement stable across DST boundaries.
    """
    result: list[CalendarItem] = []
    for event in events:
        if event.start.kind is DateTimeKind.DATE:
            start = event.start.value
            end = event.end.value
            assert isinstance(start, date) and not isinstance(start, datetime)
            assert isinstance(end, date) and not isinstance(end, datetime)
            if end <= visible.start or start >= visible.end:
                continue
            result.append(
                CalendarItem(
                    "event",
                    event.id,
                    event.summary,
                    _event_color(event, calendar_colors, fallback_color),
                    True,
                    start,
                    end,
                    None,
                    None,
                    recurring=event.is_occurrence or bool(event.recurrence),
                )
            )
            continue
        start_value = event.start.value
        end_value = event.end.value
        assert isinstance(start_value, datetime) and isinstance(end_value, datetime)
        start = _local_datetime(start_value, zone)
        end = _local_datetime(end_value, zone)
        if end.date() < visible.start or start.date() >= visible.end:
            continue
        result.append(
            CalendarItem(
                "event",
                event.id,
                event.summary,
                _event_color(event, calendar_colors, fallback_color),
                False,
                start.date(),
                # Timed end dates are inclusive for fragmentation; the actual
                # minute boundary is retained below.
                end.date(),
                start.hour * 60 + start.minute,
                end.hour * 60 + end.minute,
                recurring=event.is_occurrence or bool(event.recurrence),
            )
        )
    for task in tasks:
        if task.due is None or not visible.start <= task.due < visible.end:
            continue
        result.append(
            CalendarItem(
                "task",
                task.id,
                task.title,
                fallback_color,
                True,
                task.due,
                task.due + timedelta(days=1),
                None,
                None,
                completed=task.status is TaskStatus.COMPLETED,
            )
        )
    return tuple(result)


def all_day_blocks(
    items: tuple[CalendarItem, ...], visible: CalendarRange
) -> tuple[CalendarBlock, ...]:
    """Pack all-day spans into stable non-overlapping horizontal lanes."""
    candidates = [item for item in items if item.all_day]
    candidates.sort(
        key=lambda item: (item.start_date, -(item.end_date - item.start_date).days, item.title)
    )
    lanes: list[list[tuple[int, int]]] = []
    result: list[CalendarBlock] = []
    for item in candidates:
        start = max(item.start_date, visible.start)
        end = min(item.end_date, visible.end)
        start_day = (start - visible.start).days
        end_day = (end - visible.start).days
        lane = next(
            (
                index
                for index, occupied in enumerate(lanes)
                if all(
                    end_day <= other_start or start_day >= other_end
                    for other_start, other_end in occupied
                )
            ),
            len(lanes),
        )
        if lane == len(lanes):
            lanes.append([])
        lanes[lane].append((start_day, end_day))
        result.append(CalendarBlock(item, start_day, end_day, lane=lane))
    return tuple(result)


def _split_timed(item: CalendarItem, visible: CalendarRange) -> list[CalendarBlock]:
    assert item.start_minute is not None and item.end_minute is not None
    result: list[CalendarBlock] = []
    first = max(item.start_date, visible.start)
    last = min(item.end_date, visible.end - timedelta(days=1))
    day = first
    while day <= last:
        start = item.start_minute if day == item.start_date else 0
        end = item.end_minute if day == item.end_date else 24 * 60
        # An event ending exactly at midnight belongs to the previous day only.
        if day == item.end_date and end == 0:
            break
        if end > start:
            index = (day - visible.start).days
            result.append(
                CalendarBlock(
                    item,
                    index,
                    index + 1,
                    start_minute=start,
                    end_minute=end,
                )
            )
        day += timedelta(days=1)
    return result


def timed_blocks(
    items: tuple[CalendarItem, ...], visible: CalendarRange
) -> tuple[CalendarBlock, ...]:
    """Split timed events per day and pack overlaps into side-by-side columns."""
    fragments = [
        block for item in items if not item.all_day for block in _split_timed(item, visible)
    ]
    result: list[CalendarBlock] = []
    for day in range(visible.days):
        day_items = sorted(
            (block for block in fragments if block.start_day == day),
            key=lambda block: (block.start_minute or 0, -(block.end_minute or 0), block.item.title),
        )
        groups: list[list[CalendarBlock]] = []
        active: list[CalendarBlock] = []
        for block in day_items:
            start = block.start_minute or 0
            active = [candidate for candidate in active if (candidate.end_minute or 0) > start]
            if not active:
                groups.append([])
            groups[-1].append(block)
            active.append(block)
        for group in groups:
            columns: list[list[CalendarBlock]] = []
            placed: list[CalendarBlock] = []
            for block in group:
                column = next(
                    (
                        index
                        for index, occupied in enumerate(columns)
                        if not occupied
                        or (occupied[-1].end_minute or 0) <= (block.start_minute or 0)
                    ),
                    len(columns),
                )
                if column == len(columns):
                    columns.append([])
                columns[column].append(block)
                placed.append(
                    CalendarBlock(
                        block.item,
                        block.start_day,
                        block.end_day,
                        column=column,
                        column_count=0,
                        start_minute=block.start_minute,
                        end_minute=block.end_minute,
                    )
                )
            result.extend(
                CalendarBlock(
                    block.item,
                    block.start_day,
                    block.end_day,
                    column=block.column,
                    column_count=max(1, len(columns)),
                    start_minute=block.start_minute,
                    end_minute=block.end_minute,
                )
                for block in placed
            )
    return tuple(result)


def month_blocks(
    items: tuple[CalendarItem, ...], visible: CalendarRange
) -> tuple[CalendarBlock, ...]:
    """Return date-cell chips for all-day, due-task, and timed event fragments."""
    display_items: list[CalendarItem] = []
    for item in items:
        if item.all_day:
            display_items.append(item)
            continue
        for fragment in _split_timed(item, visible):
            day = visible.start + timedelta(days=fragment.start_day)
            minute = fragment.start_minute or 0
            display_items.append(
                replace(
                    item,
                    all_day=True,
                    title=f"{minute // 60:02d}:{minute % 60:02d} {item.title}",
                    start_date=day,
                    end_date=day + timedelta(days=1),
                )
            )
    return all_day_blocks(tuple(display_items), visible)


def month_label(day: date) -> str:
    """Use a brief month label where a grid crosses a month boundary."""
    return f"{day.day} {calendar.month_abbr[day.month]}"


def local_point(day: date, minute: int, zone: ZoneInfo) -> datetime:
    """Return a display-zone local instant for a snapped calendar coordinate."""
    return datetime.combine(day, time(hour=minute // 60, minute=minute % 60), tzinfo=zone)
