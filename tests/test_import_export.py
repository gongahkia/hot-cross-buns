from __future__ import annotations

import csv
import io
import json

import pytest

from hcb.import_export import (
    CSV_HEADER,
    MAX_BYTES,
    ImportedEvent,
    ImportedTask,
    export_csv,
    export_ics,
    export_json,
    parse_csv,
    parse_ics,
    parse_import,
    parse_json,
)


def test_csv_exact_schema_quoted_fields_and_round_trip() -> None:
    records = (
        ImportedTask(
            "Review, roadmap",
            list="Inbox",
            due="2026-08-20",
            notes='line one\n"line two"',
            priority="high",
            rrule="FREQ=WEEKLY",
            exclude=("2026-08-27",),
        ),
        ImportedEvent(
            "Planning",
            "2026-08-20T09:00:00Z",
            "2026-08-20T10:00:00Z",
            False,
            calendar="Team",
            recurrence=("RRULE:FREQ=WEEKLY",),
        ),
    )
    exported = export_csv(records)
    assert next(csv.reader(io.StringIO(exported))) == list(CSV_HEADER)
    preview = parse_csv(exported)
    assert preview.errors == ()
    assert tuple(row.record for row in preview.rows) == records

    assert parse_csv("kind,title\ntask,nope").errors == (
        "CSV must use the documented exact header",
    )
    malformed = ",".join(CSV_HEADER) + '\n"unterminated'
    assert parse_csv(malformed).errors


def test_versioned_json_round_trip_and_strict_envelope() -> None:
    records = (
        ImportedTask("Pay rent", due="2026-09-01"),
        ImportedEvent("Holiday", "2026-12-25", "2026-12-26", True),
    )
    encoded = export_json(records)
    assert json.loads(encoded)["version"] == 1
    preview = parse_json(encoded)
    assert tuple(row.record for row in preview.rows) == records
    assert parse_json("[]").errors == ("JSON must be an HCB version 1 export",)
    assert parse_json('{"version":2,"records":[]}').errors
    assert parse_json("{").errors == ("JSON is invalid",)


def test_ics_duration_unfolding_warnings_and_recurrence_preservation() -> None:
    text = "\r\n".join(
        (
            "BEGIN:VCALENDAR",
            "BEGIN:VEVENT",
            "SUMMARY:Focus ",
            " block",
            "DTSTART:20260820T090000Z",
            "DURATION:PT90M",
            "RRULE:FREQ=DAILY;COUNT=3",
            "EXDATE:20260821T090000Z",
            "ATTENDEE:mailto:person@example.test",
            "END:VEVENT",
            "END:VCALENDAR",
        )
    )
    preview = parse_ics(text)
    assert preview.errors == ()
    row = preview.rows[0]
    assert row.warnings == ("ATTENDEE is not imported",)
    assert row.record == ImportedEvent(
        "Focus block",
        "2026-08-20T09:00:00Z",
        "2026-08-20T10:30:00Z",
        False,
        recurrence=("RRULE:FREQ=DAILY;COUNT=3", "EXDATE:20260821T090000Z"),
    )
    # Only one canonical VEVENT is returned; recurrence is not expanded locally.
    assert len(preview.rows) == 1


def test_ics_export_escapes_text_and_round_trips_all_day_and_timed_events() -> None:
    records = (
        ImportedEvent(
            "One, two",
            "2026-08-20",
            "2026-08-21",
            True,
            description="line one\nline two",
        ),
        ImportedEvent(
            "Standup",
            "2026-08-20T09:00:00+08:00",
            "2026-08-20T09:30:00+08:00",
            False,
            recurrence=("RRULE:FREQ=DAILY",),
        ),
    )
    encoded = export_ics(records)
    assert "SUMMARY:One\\, two" in encoded
    assert "DESCRIPTION:line one\\nline two" in encoded
    preview = parse_ics(encoded)
    assert preview.errors == ()
    assert len(preview.rows) == 2
    assert preview.rows[0].record == records[0]
    timed = preview.rows[1].record
    assert isinstance(timed, ImportedEvent)
    assert timed.start == "2026-08-20T01:00:00Z"
    assert timed.recurrence == ("RRULE:FREQ=DAILY",)


def test_import_limits_utf8_and_event_validation_are_safe() -> None:
    assert parse_import("x.json", b"\xff").errors == (
        "Import source is not valid UTF-8",
    )
    assert parse_import("x.json", "x" * (MAX_BYTES + 1)).errors == (
        "Import source exceeds 5 MiB",
    )
    assert parse_import("x.txt", "").errors == (
        "Import format must be .csv, .json, .ics, or .ical",
    )
    bad_event = {
        "version": 1,
        "records": [
            {
                "kind": "event",
                "title": "Backwards",
                "start": "2026-08-21",
                "end": "2026-08-20",
                "all_day": True,
            }
        ],
    }
    assert parse_json(json.dumps(bad_event)).rows[0].errors == (
        "Event end must be after start",
    )


def test_export_rejects_recurrence_content_line_injection() -> None:
    event = ImportedEvent(
        "Safe",
        "2026-08-20",
        "2026-08-21",
        True,
        recurrence=("RRULE:FREQ=DAILY\r\nATTENDEE:evil",),
    )
    with pytest.raises(ValueError, match="recurrence"):
        export_ics((event,))
