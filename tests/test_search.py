from __future__ import annotations

from datetime import date

from hcb.models import (
    Calendar,
    DateTimeKind,
    Event,
    EventDateTime,
    EventStatus,
    Task,
    TaskStatus,
)
from hcb.search import (
    DateWindow,
    date_key,
    matches_calendar_result,
    matches_date_window,
    matches_event,
    matches_event_filters,
    matches_task,
    matches_task_filters,
    parse_date_window,
    parse_palette_query,
)


def test_parses_filters_quotes_free_text_and_unknown_tokens() -> None:
    parsed = parse_palette_query(
        'type:event in:"Team Calendar" date:2026-08-01..2026-08-31 launch'
    )
    assert parsed.text == "launch"
    assert parsed.filters.types == ("event",)
    assert parsed.filters.calendar_query == "Team Calendar"
    assert parsed.filters.date == DateWindow(
        "range", start="2026-08-01", end="2026-08-31"
    )
    assert parsed.has_filters

    unknown = parse_palette_query('owner:"Ada Lovelace" "quoted term"')
    assert unknown.text == 'owner:"Ada Lovelace" quoted term'
    assert not unknown.has_filters


def test_date_windows_are_calendar_correct_and_monday_based() -> None:
    assert parse_date_window("2024-02-29") == DateWindow("day", day="2024-02-29")
    assert parse_date_window("2023-02-29") is None
    assert parse_date_window("2026-09-01..2026-08-01") is None
    assert matches_date_window("2026-08-17", DateWindow("this-week"), "2026-08-21")
    assert matches_date_window("2026-08-24", DateWindow("next-week"), "2026-08-21")
    assert not matches_date_window("2026-08-23", DateWindow("next-week"), "2026-08-21")
    assert date_key("2026-08-21T00:00:00") == "2026-08-21"


def test_task_filtering_combines_overdue_completion_list_and_priority() -> None:
    parsed = parse_palette_query(
        'task:Open list:"My Tasks" due:past completed:false priority:high'
    )
    task = {
        "id": "open",
        "listId": "inbox",
        "title": "Open roadmap",
        "status": "needsAction",
        "due": "2026-08-15T00:00:00Z",
    }
    assert matches_task_filters(
        task, parsed.filters, "2026-08-16", {"priority": "high"}, "My Tasks"
    )
    assert matches_task(
        task,
        parsed,
        today="2026-08-16",
        metadata={"priority": "high"},
        list_name="My Tasks",
    )
    assert not matches_task_filters(
        {**task, "status": "completed"},
        parsed.filters,
        "2026-08-16",
        {"priority": "high"},
        "My Tasks",
    )


def test_title_first_matching_requires_explicit_body_opt_in() -> None:
    task = Task(
        id="t",
        account_id="a",
        list_id="l",
        title="Buy milk",
        notes="secret phrase",
        status=TaskStatus.NEEDS_ACTION,
    )
    assert not matches_task(task, "secret")
    assert matches_task(task, "body:secret")
    assert matches_task(task, "buy")

    event = Event(
        id="e",
        account_id="a",
        calendar_id="c",
        summary="Planning",
        start=EventDateTime(DateTimeKind.DATE, date(2026, 8, 20)),
        end=EventDateTime(DateTimeKind.DATE, date(2026, 8, 21)),
        description="hidden agenda",
        status=EventStatus.CONFIRMED,
        recurrence=("RRULE:FREQ=DAILY",),
    )
    assert not matches_event(event, "agenda")
    assert matches_event(event, "notes:agenda")
    assert matches_event(event, "planning")


def test_event_filters_match_canonical_record_without_expanding_recurrence() -> None:
    filters = parse_palette_query(
        'event:standup in:"Team Calendar" date:2026-08-01..2026-08-31'
    ).filters
    event = {
        "id": "standup",
        "calendarId": "team",
        "summary": "Daily standup",
        "recurrence": ["RRULE:FREQ=DAILY"],
        "start": {"date": "2026-08-16"},
        "end": {"date": "2026-08-17"},
    }
    assert matches_event_filters(event, filters, "Team Calendar")
    assert matches_event(event, parse_palette_query("event:standup"), calendar_name="Team")


def test_calendar_result_is_title_first_and_type_aware() -> None:
    calendar = Calendar(id="c", account_id="a", summary="Engineering")
    assert matches_calendar_result(calendar, "engineering")
    assert not matches_calendar_result(calendar, "type:task engineering")
