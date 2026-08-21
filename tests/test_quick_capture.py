from __future__ import annotations

from dataclasses import replace
from datetime import datetime

from hcb.quick_capture import (
    QuickCapturePreferences,
    QuickCaptureRecognition,
    parse_quick_capture,
)

NOW = datetime(2026, 7, 28, 16, 0, 0)


def parse(
    text: str,
    kind: str = "event",
    preferences: QuickCapturePreferences | None = None,
    disabled: tuple[str, ...] = (),
    now: datetime = NOW,
):
    return parse_quick_capture(text, kind, preferences, disabled, now)  # type: ignore[arg-type]


def recognition_ids(result) -> list[str]:
    return [item.id for item in result.recognitions]


def by_prefix(result, prefix: str) -> QuickCaptureRecognition | None:
    for item in result.recognitions:
        if item.id.startswith(f"{prefix}:"):
            return item
    return None


def test_parses_timed_recurring_event() -> None:
    result = parse("Team sync tomorrow at 9am for 45m every 2 weeks")
    assert result.kind == "event"
    assert result.date == "2026-07-29"
    assert result.time == "09:00"
    assert result.event_duration_minutes == 45
    assert result.recurrence is not None
    assert result.recurrence.frequency == "weekly"
    assert result.recurrence.interval == 2
    assert result.recurrence.rrule == "RRULE:FREQ=WEEKLY;INTERVAL=2"
    assert result.parsed_title == "Team sync"
    assert result.raw_title == "Team sync tomorrow at 9am for 45m every 2 weeks"
    assert result.all_day is False
    assert result.event_ready is True
    assert by_prefix(result, "duration").label == "45 minutes"
    assert by_prefix(result, "recurrence").label == "Repeats every 2 weeks"


def test_preserves_task_time_while_extracting_metadata() -> None:
    result = parse("Call Sam tomorrow at 5pm P1 every day", kind="task")
    assert result.kind == "task"
    assert result.date == "2026-07-29"
    assert result.time == "17:00"
    assert result.task_priority == "high"
    assert result.recurrence is not None
    assert result.recurrence.rrule == "RRULE:FREQ=DAILY;INTERVAL=1"
    assert result.parsed_title == "Call Sam at 5pm"
    time_note = by_prefix(result, "time")
    assert time_note is not None
    assert time_note.label == "17:00 remains in task title"
    assert time_note.removable is False
    assert result.event_ready is True


def test_creates_all_day_events_from_named_dates() -> None:
    result = parse("Offsite August 3")
    assert result.date == "2026-08-03"
    assert result.time is None
    assert result.all_day is True
    assert result.event_ready is True
    assert result.parsed_title == "Offsite"


def test_named_date_without_year_rolls_forward() -> None:
    result = parse("Kickoff January 1st")
    assert result.date == "2027-01-01"
    assert result.parsed_title == "Kickoff"


def test_named_date_with_explicit_year_stays_in_the_past() -> None:
    result = parse("Kickoff January 1, 2025")
    assert result.date == "2025-01-01"


def test_today_and_relative_offsets() -> None:
    assert parse("Standup today").date == "2026-07-28"
    assert parse("Standup in 3 days").date == "2026-07-31"
    assert parse("Standup in 2 weeks").date == "2026-08-11"
    assert parse("Standup in 0 days").date == "2026-07-28"


def test_iso_date_and_invalid_calendar_dates() -> None:
    assert parse("Ship 2026-12-01").date == "2026-12-01"
    invalid = parse("Ship 2026-02-31 today")
    assert invalid.date == "2026-07-28"
    assert parse("Ship 2026-02-31").date is None


def test_next_weekday_is_always_in_the_future() -> None:
    assert parse("Sync next sunday").date == "2026-08-02"
    assert parse("Sync next tuesday").date == "2026-08-04"
    monday = parse("Sync next monday", now=datetime(2026, 7, 27, 9, 0, 0))
    assert monday.date == "2026-08-03"


def test_rolls_timed_events_without_dates_to_the_next_future_slot() -> None:
    past = parse("Dentist at 10am")
    assert past.date == "2026-07-29"
    assert past.time == "10:00"
    assert past.event_duration_minutes == 30
    assert past.all_day is False
    assert past.event_ready is True

    future = parse("Dentist at 5pm")
    assert future.date == "2026-07-28"
    assert future.time == "17:00"

    equal = parse("Dentist at 16:00")
    assert equal.date == "2026-07-29"
    assert equal.time == "16:00"


def test_twelve_and_twenty_four_hour_times() -> None:
    assert parse("Meet at 12am").time == "00:00"
    assert parse("Meet at 12pm").time == "12:00"
    assert parse("Meet 9:05 PM").time == "21:05"
    assert parse("Meet at 14:30").time == "14:30"
    assert parse("Meet 9:30").time == "09:30"
    assert parse("Meet 13am").time is None
    assert parse("Meet 9:60am").time is None


def test_duration_hours_and_bounds() -> None:
    hours = parse("Focus for 2 hours tomorrow")
    assert hours.event_duration_minutes == 120
    too_long = parse("Focus for 25 hours tomorrow")
    assert too_long.event_duration_minutes == 30
    assert by_prefix(too_long, "duration") is None
    zero = parse("Focus for 0 min tomorrow")
    assert zero.event_duration_minutes == 30
    prefs = QuickCapturePreferences(default_event_duration_minutes=0)
    assert parse("Focus tomorrow", preferences=prefs).event_duration_minutes == 30
    prefs = QuickCapturePreferences(default_event_duration_minutes=2000)
    assert parse("Focus tomorrow", preferences=prefs).event_duration_minutes == 1440
    prefs = QuickCapturePreferences(default_event_duration_minutes=-5)
    assert parse("Focus tomorrow", preferences=prefs).event_duration_minutes == 1


def test_duration_is_ignored_for_tasks() -> None:
    result = parse("Write notes for 45m tomorrow", kind="task")
    assert result.event_duration_minutes == 30
    assert by_prefix(result, "duration") is None
    assert "for 45m" in result.parsed_title


def test_kind_aliases_prefer_the_earlier_match() -> None:
    event_first = parse("event then task review tomorrow")
    assert event_first.kind == "event"
    assert by_prefix(event_first, "type").label == "Event"

    task_first = parse("task then event review tomorrow", kind="event")
    assert task_first.kind == "task"
    assert by_prefix(task_first, "type").label == "Task"

    same_start = parse("task review", kind="event")
    assert same_start.kind == "task"


def test_custom_aliases_and_priority_levels() -> None:
    prefs = QuickCapturePreferences(
        task_aliases=("todo", "task"),
        event_aliases=("meet",),
        high_priority_aliases=("p1", "urgent"),
        medium_priority_aliases=("p2",),
        low_priority_aliases=("p3",),
    )
    task = parse("Todo review P1 tomorrow", kind="event", preferences=prefs)
    assert task.kind == "task"
    assert task.task_priority == "high"
    medium = parse("Todo review p2 tomorrow", kind="task", preferences=prefs)
    assert medium.task_priority == "medium"
    low = parse("Todo review p3 tomorrow", kind="task", preferences=prefs)
    assert low.task_priority == "low"
    meet = parse("Meet standup tomorrow", kind="task", preferences=prefs)
    assert meet.kind == "event"
    assert meet.task_priority == "none"


def test_empty_aliases_do_not_match() -> None:
    prefs = QuickCapturePreferences(task_aliases=("", "  "), event_aliases=())
    result = parse("task event review", kind="event", preferences=prefs)
    assert result.kind == "event"
    assert by_prefix(result, "type") is None


def test_alias_regex_metacharacters_are_literal() -> None:
    prefs = QuickCapturePreferences(task_aliases=("ta*sk",), event_aliases=("ev.ent",))
    star = parse("ta*sk inbox tomorrow", kind="event", preferences=prefs)
    assert star.kind == "task"
    dotted = parse("ev.ent planning tomorrow", kind="task", preferences=prefs)
    assert dotted.kind == "event"
    unescaped = parse("task inbox tomorrow", kind="event", preferences=prefs)
    assert unescaped.kind == "event"


def test_priority_is_skipped_when_kind_is_event() -> None:
    result = parse("event planning P1 tomorrow")
    assert result.kind == "event"
    assert result.task_priority == "none"
    assert by_prefix(result, "priority") is None
    assert "P1" in result.parsed_title


def test_high_priority_falls_through_when_its_span_is_unusable() -> None:
    prefs = QuickCapturePreferences(task_aliases=("p1",), high_priority_aliases=("p1",))
    result = parse("p1 and p2 later", kind="task", preferences=prefs)
    assert result.kind == "task"
    assert result.task_priority == "medium"
    assert by_prefix(result, "type") is not None
    assert by_prefix(result, "priority").label == "Medium priority"


def test_recurrence_forms_and_task_date_inference() -> None:
    daily = parse("Water plants every day", kind="task")
    assert daily.date == "2026-07-28"
    assert daily.recurrence.frequency == "daily"
    assert daily.recurrence.interval == 1
    assert by_prefix(daily, "recurrence").label == "Repeats every day"

    monthly = parse("Pay rent every month tomorrow", kind="task")
    assert monthly.recurrence.frequency == "monthly"
    yearly = parse("Birthday every year", kind="event")
    assert yearly.recurrence.frequency == "yearly"
    assert yearly.date is None
    assert yearly.event_ready is False


def test_disabled_type_keeps_requested_kind() -> None:
    initial = parse("event standup tomorrow", kind="task")
    type_id = by_prefix(initial, "type").id
    disabled = parse("event standup tomorrow", kind="task", disabled=(type_id,))
    assert disabled.kind == "task"
    assert "event" in disabled.parsed_title
    assert by_prefix(disabled, "type") is None


def test_disabled_priority_leaves_token_in_title() -> None:
    prefs = QuickCapturePreferences(task_aliases=("todo",))
    initial = parse("Todo review P1 tomorrow", kind="event", preferences=prefs)
    priority_id = by_prefix(initial, "priority").id
    disabled = parse(
        "Todo review P1 tomorrow",
        kind="event",
        preferences=prefs,
        disabled=(priority_id,),
    )
    assert disabled.kind == "task"
    assert disabled.task_priority == "none"
    assert "P1" in disabled.parsed_title
    assert disabled.date == "2026-07-29"


def test_disabled_recurrence_does_not_apply_rule() -> None:
    initial = parse("Standup every week tomorrow")
    recurrence_id = by_prefix(initial, "recurrence").id
    disabled = parse("Standup every week tomorrow", disabled=(recurrence_id,))
    assert disabled.recurrence is None
    assert "every week" in disabled.parsed_title


def test_disabled_date_still_sets_date_but_keeps_text() -> None:
    initial = parse("Offsite tomorrow")
    date_id = by_prefix(initial, "date").id
    disabled = parse("Offsite tomorrow", disabled=(date_id,))
    assert disabled.date == "2026-07-29"
    assert "tomorrow" in disabled.parsed_title
    assert by_prefix(disabled, "date") is None
    assert disabled.event_ready is True


def test_disabled_event_time_keeps_clock_but_not_span_removal() -> None:
    initial = parse("Dentist at 5pm")
    time_id = by_prefix(initial, "time").id
    disabled = parse("Dentist at 5pm", disabled=(time_id,))
    assert disabled.time == "17:00"
    assert "at 5pm" in disabled.parsed_title
    assert by_prefix(disabled, "time") is None


def test_disabled_task_time_omits_remaining_label() -> None:
    initial = parse("Call Sam at 5pm tomorrow", kind="task")
    time_id = by_prefix(initial, "time").id
    assert time_id is not None
    disabled = parse("Call Sam at 5pm tomorrow", kind="task", disabled=(time_id,))
    assert disabled.time == "17:00"
    assert all("remains in task title" not in item.label for item in disabled.recognitions)
    assert "at 5pm" in disabled.parsed_title


def test_remove_recognized_text_false_keeps_raw_words() -> None:
    prefs = QuickCapturePreferences(remove_recognized_text=False)
    result = parse("Team sync tomorrow at 9am for 45m every 2 weeks", preferences=prefs)
    assert result.parsed_title == result.raw_title
    assert result.date == "2026-07-29"
    assert result.time == "09:00"
    assert result.recurrence is not None
    assert result.recognitions


def test_title_cleanup_collapses_whitespace_after_span_removal() -> None:
    result = parse("  Briefing   tomorrow   at 9am  ")
    assert result.raw_title == "Briefing   tomorrow   at 9am"
    assert result.parsed_title == "Briefing"


def test_unsupported_text_is_untouched() -> None:
    result = parse("Draft the project brief", kind="task")
    assert result.parsed_title == "Draft the project brief"
    assert result.date is None
    assert result.time is None
    assert result.recurrence is None
    assert result.task_priority == "none"
    assert result.recognitions == ()
    assert result.event_ready is True
    assert result.all_day is False


def test_events_without_a_date_are_not_ready() -> None:
    result = parse("Hold a slot")
    assert result.kind == "event"
    assert result.event_ready is False
    assert result.date is None


def test_recognition_ids_encode_prefix_index_and_length() -> None:
    result = parse("tomorrow")
    date = by_prefix(result, "date")
    assert date is not None
    assert date.id == "date:0:8"
    assert date.removable is True
    assert date.label == "2026-07-29"


def test_replace_preferences_keeps_unused_defaults() -> None:
    prefs = replace(QuickCapturePreferences(), default_event_duration_minutes=90)
    result = parse("Chat tomorrow", preferences=prefs)
    assert result.event_duration_minutes == 90
