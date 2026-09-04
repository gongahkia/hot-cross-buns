from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from hcb.models import DateTimeKind, Event, EventDateTime, Task, TaskStatus
from hcb.tui_calendar import (
    all_day_blocks,
    calendar_items,
    calendar_range,
    month_blocks,
    timed_blocks,
)


def timed_event(identifier: str, start_hour: int, end_hour: int) -> Event:
    return Event(
        identifier,
        "account",
        "calendar",
        identifier,
        EventDateTime(DateTimeKind.DATETIME, datetime(2026, 9, 7, start_hour, tzinfo=UTC)),
        EventDateTime(DateTimeKind.DATETIME, datetime(2026, 9, 7, end_hour, tzinfo=UTC)),
    )


def test_week_calendar_packs_overlaps_and_includes_due_tasks() -> None:
    visible = calendar_range("Week", date(2026, 9, 7), 0)
    task = Task("task", "account", "list", "Due task", due=date(2026, 9, 8))
    items = calendar_items(
        (timed_event("first", 9, 11), timed_event("second", 10, 12)),
        (task,),
        visible=visible,
        zone=ZoneInfo("UTC"),
        calendar_colors={"calendar": "#123456"},
        fallback_color="#abcdef",
    )

    timed = timed_blocks(items, visible)
    assert {block.item.item_id for block in timed} == {"first", "second"}
    assert {block.column_count for block in timed} == {2}
    assert {block.column for block in timed} == {0, 1}
    due = next(block for block in all_day_blocks(items, visible) if block.item.item_id == "task")
    assert due.start_day == 1
    assert due.item.completed is False


def test_month_calendar_always_covers_six_complete_weeks() -> None:
    visible = calendar_range("Month", date(2026, 2, 1), 0)

    assert visible.days == 42
    assert visible.start.weekday() == 0
    assert visible.end - visible.start == timedelta(days=42)


def test_month_calendar_promotes_timed_events_into_date_cell_chips() -> None:
    visible = calendar_range("Month", date(2026, 9, 1), 0)
    items = calendar_items(
        (timed_event("meeting", 9, 10),),
        (),
        visible=visible,
        zone=ZoneInfo("UTC"),
        calendar_colors={"calendar": "#123456"},
        fallback_color="#abcdef",
    )

    blocks = month_blocks(items, visible)

    assert len(blocks) == 1
    assert blocks[0].item.title == "09:00 meeting"
    assert blocks[0].item.start_minute == 9 * 60


def test_all_day_end_is_exclusive_and_completed_tasks_remain_semantic() -> None:
    visible = calendar_range("Day", date(2026, 9, 7), 0)
    event = Event(
        "event",
        "account",
        "calendar",
        "All day",
        EventDateTime(DateTimeKind.DATE, date(2026, 9, 6)),
        EventDateTime(DateTimeKind.DATE, date(2026, 9, 7)),
    )
    task = Task(
        "task",
        "account",
        "list",
        "Done",
        due=date(2026, 9, 7),
        status=TaskStatus.COMPLETED,
    )
    items = calendar_items(
        (event,),
        (task,),
        visible=visible,
        zone=ZoneInfo("UTC"),
        calendar_colors={},
        fallback_color="#abcdef",
    )

    assert [item.item_id for item in items] == ["task"]
    assert items[0].completed
