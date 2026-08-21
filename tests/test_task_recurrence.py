from __future__ import annotations

from dataclasses import replace

from hcb.task_recurrence import (
    RecurrenceEnd,
    TaskRecurrenceMarker,
    TaskReminder,
    parse_task_recurrence_notes,
    serialize_task_notes,
    serialize_task_recurrence_notes,
    task_recurrence_date,
    task_recurrence_successor,
)

SERIES = "3a21dc8d-2cb4-4b9a-980f-7aaf75ae2f43"


def marker(**changes: object) -> TaskRecurrenceMarker:
    value = TaskRecurrenceMarker(
        series_id=SERIES,
        occurrence_id=f"{SERIES}:0",
        ordinal=0,
        frequency="weekly",
        interval=1,
        anchor_date="2026-08-17",
        time_zone="Asia/Singapore",
        end=RecurrenceEnd("count", count=3),
        recurrence_rule="FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
        exclusion_dates=("2026-08-24",),
        addition_dates=("2026-08-25",),
        template_title="Review roadmap",
        template_due_date="2026-08-17",
        template_priority="high",
    )
    return replace(value, **changes)


def test_v2_round_trip_and_exception_successor() -> None:
    original = marker()
    serialized = serialize_task_recurrence_notes("Personal context", original)
    assert serialized.error is None
    assert parse_task_recurrence_notes(serialized.notes or "") == (
        parse_task_recurrence_notes(serialized.notes or "")
    )
    parsed = parse_task_recurrence_notes(serialized.notes or "")
    assert (parsed.state, parsed.user_notes, parsed.marker) == (
        "managed",
        "Personal context",
        original,
    )
    assert task_recurrence_date(original, 1) == "2026-08-25"
    successor = task_recurrence_successor(original)
    assert successor is not None
    assert (successor.ordinal, successor.occurrence_id, successor.template_due_date) == (
        1,
        f"{SERIES}:1",
        "2026-08-25",
    )


def test_parses_legacy_v1_and_rejects_unknown_or_malformed_markers() -> None:
    payload = (
        '{"a":"2026-08-17","e":{"k":"never"},"i":1,"n":0,'
        f'"o":"{SERIES}:0","r":"daily","s":"{SERIES}",'
        '"t":{"d":"2026-08-17","p":"none","t":"Run"},"z":"UTC"}'
    )
    notes = f"memo\n\n[HCB-RECURRENCE v1]\n{payload}\n[/HCB-RECURRENCE]"
    parsed = parse_task_recurrence_notes(notes)
    assert parsed.state == "managed"
    assert parsed.marker is not None
    assert parsed.marker.recurrence_rule == ""
    assert parsed.marker.exclusion_dates == ()

    future = notes.replace("v1]", "v3]")
    assert parse_task_recurrence_notes(future).state == "unsupported-version"
    assert parse_task_recurrence_notes(future).user_notes == future
    malformed = notes.replace('"i":1', '"i":true')
    assert parse_task_recurrence_notes(malformed).state == "malformed"
    assert parse_task_recurrence_notes("[HCB-RECURRENCE v2]\n{}").state == "malformed"


def test_task_v1_envelope_supports_reminder_with_or_without_recurrence() -> None:
    both = serialize_task_notes(
        "context", marker(), TaskReminder("09:30", "Asia/Singapore")
    )
    parsed = parse_task_recurrence_notes(both.notes or "")
    assert parsed.state == "managed"
    assert parsed.marker == marker()
    assert parsed.reminder == TaskReminder("09:30", "Asia/Singapore")

    reminder = serialize_task_notes("Pay rent", reminder=TaskReminder("08:00", "UTC"))
    parsed = parse_task_recurrence_notes(reminder.notes or "")
    assert parsed.state == "unmanaged"
    assert parsed.user_notes == "Pay rent"
    assert parsed.reminder == TaskReminder("08:00", "UTC")


def test_strict_validation_and_limits() -> None:
    assert serialize_task_recurrence_notes("", marker(series_id="not-a-uuid")).error
    assert serialize_task_recurrence_notes(
        "", marker(recurrence_rule="freq=WEEKLY")
    ).error
    assert serialize_task_recurrence_notes(
        "", marker(exclusion_dates=("2026-08-17",))
    ).error
    assert serialize_task_notes("", reminder=TaskReminder("24:00", "UTC")).error
    assert serialize_task_notes("\0", marker()).error
    assert serialize_task_recurrence_notes("x" * 8_192, marker()).error


def test_month_clamping_ordinal_rules_and_end_conditions() -> None:
    monthly = marker(
        frequency="monthly",
        anchor_date="2024-01-31",
        template_due_date="2024-01-31",
        recurrence_rule="",
        exclusion_dates=(),
        addition_dates=(),
        end=RecurrenceEnd("never"),
    )
    assert task_recurrence_date(monthly, 1) == "2024-02-29"

    last_monday = marker(
        frequency="monthly",
        anchor_date="2026-01-01",
        template_due_date="2026-01-01",
        recurrence_rule="FREQ=MONTHLY;BYDAY=-1MO",
        exclusion_dates=(),
        addition_dates=(),
        end=RecurrenceEnd("until", until_date="2026-01-31"),
    )
    assert task_recurrence_date(last_monday, 0) == "2026-01-26"
    assert task_recurrence_successor(last_monday) is None

    one = replace(monthly, end=RecurrenceEnd("count", count=1))
    assert task_recurrence_successor(one) is None
