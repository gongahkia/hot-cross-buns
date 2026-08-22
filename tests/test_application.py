from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from hcb.application import ApplicationService
from hcb.models import (
    Account,
    Calendar,
    DateTimeKind,
    EventDateTime,
    NotesProjection,
    ReminderOverride,
    TaskList,
    TaskPriority,
)
from hcb.storage import Storage
from hcb.task_recurrence import (
    RecurrenceEnd,
    TaskRecurrenceMarker,
    parse_task_recurrence_notes,
    serialize_task_notes,
)


@pytest.fixture
def app(tmp_path: Path):
    with Storage(tmp_path / "application.db") as storage:
        storage.upsert_account(Account("a", "private@example.test"))
        storage.upsert_task_list(TaskList("inbox", "a", "Inbox", remote_id="remote-inbox"))
        storage.upsert_calendar(Calendar("cal", "a", "Primary", remote_id="remote-cal"))
        yield ApplicationService(storage)


def test_task_write_is_optimistic_and_transactional(app: ApplicationService) -> None:
    task = app.create_task(
        "a",
        "inbox",
        "Pay bill",
        due=date(2026, 8, 22),
        due_time_zone="Asia/Singapore",
        priority=TaskPriority.HIGH,
    )
    assert app.storage.get_task("a", task.id) == task
    mutation = app.storage.pending_mutations("a")[0]
    assert mutation.entity_id == task.id
    assert mutation.payload["body"]["due"].startswith("2026-08-22T00:00:00")
    assert "priority" not in mutation.payload["body"]

    original = app.storage.enqueue

    def fail_enqueue(*_args, **_kwargs):
        raise RuntimeError("outbox unavailable")

    app.storage.enqueue = fail_enqueue  # type: ignore[method-assign]
    with pytest.raises(RuntimeError):
        app.create_task("a", "inbox", "Must roll back", id="rollback")
    app.storage.enqueue = original  # type: ignore[method-assign]
    assert app.storage.get_task("a", "rollback") is None


def test_notes_projection_and_date_only_constraint(app: ApplicationService) -> None:
    app.set_notes_projection("a", NotesProjection.DISABLED)
    task = app.create_task("a", "inbox", "Private", notes="secret")
    assert app.storage.get_task("a", task.id).notes == "secret"
    assert "notes" not in app.storage.pending_mutations("a")[-1].payload["body"]
    with pytest.raises(ValueError, match="date-only"):
        app.create_task("a", "inbox", "Bad due", due=datetime.now(UTC))  # type: ignore[arg-type]


def test_calendar_list_preferences_and_event_rich_clears(app: ApplicationService) -> None:
    calendar = app.update_calendar(
        "a",
        "cal",
        color="#112233",
        selected=False,
        notification_settings=({"type": "eventCreation", "method": "email"},),
        default_reminders=(ReminderOverride("popup", 10),),
    )
    assert calendar.color == "#112233"
    mutations = app.storage.pending_mutations("a")
    assert mutations[-1].payload["resource"] == "calendar-list"

    start = EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 9, tzinfo=UTC))
    end = EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 10, tzinfo=UTC))
    event = app.create_event(
        "a",
        "cal",
        "Review",
        start,
        end,
        description="Details",
        recurrence=("RRULE:FREQ=WEEKLY",),
        attendees=({"email": "guest@example.test"},),
    )
    updated = app.update_event(
        "a",
        event.id,
        description=None,
        recurrence=(),
        attendees=(),
        conference=None,
    )
    assert updated.description is None
    body = app.storage.pending_mutations("a")[-1].payload["body"]
    assert body["description"] is None
    assert body["recurrence"] == []
    assert body["attendees"] == []
    assert body["conferenceData"] is None


def test_event_duplicate_invitations_and_cached_instance_agenda(app: ApplicationService) -> None:
    start = EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 9, tzinfo=UTC))
    end = EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 10, tzinfo=UTC))
    series = app.create_event(
        "a",
        "cal",
        "Standup",
        start,
        end,
        recurrence=("RRULE:FREQ=DAILY",),
        attendees=({"email": "guest@example.test"},),
        id="series",
    )
    copied = app.duplicate_event("a", series.id)
    assert copied.recurrence == ()
    assert copied.attendees == ()

    instance = app.storage.get_event("a", series.id)
    assert instance is not None
    app.storage.upsert_event(replace(instance, remote_id="series-remote"))
    instance = app.storage.get_event("a", series.id)
    assert instance is not None
    app.storage.upsert_event(
        replace(
            instance,
            id="instance",
            remote_id="instance-remote",
            canonical_id="series-remote",
            occurrence_id="2026-08-21T09:00:00Z",
            recurrence=(),
            derived=True,
        )
    )
    agenda = app.agenda_events(
        "a", start=date(2026, 8, 21), end=date(2026, 8, 22), calendar_id="cal"
    )
    assert {item.id for item in agenda} == {"instance", copied.id}


def test_schedule_search_orphan_and_undo_redo(app: ApplicationService) -> None:
    task = app.create_task("a", "inbox", "Deep work", priority="high")
    start = EventDateTime(
        DateTimeKind.DATETIME,
        datetime(2026, 8, 21, 9, tzinfo=UTC),
        "UTC",
    )
    end = EventDateTime(
        DateTimeKind.DATETIME,
        datetime(2026, 8, 21, 10, tzinfo=UTC),
        "UTC",
    )
    event, link = app.schedule_task("a", task.id, "cal", start, end)
    assert link.event_id == event.id
    assert app.search("a", "type:task priority:high Deep")[0].item.id == task.id

    app.delete_event("a", event.id)
    assert app.list_task_event_links("a", orphaned_only=True)[0].orphaned
    assert app.undo("a") is not None
    assert app.storage.get_event("a", event.id).metadata.deleted is False
    assert app.redo("a") is not None
    assert app.storage.get_event("a", event.id).metadata.deleted is True


def test_import_apply_is_atomic_and_diagnostics_are_redacted(
    app: ApplicationService,
) -> None:
    preview = app.preview_import(
        "tasks.json",
        '{"version":1,"records":[{"kind":"task","title":"Imported","priority":"low"}]}',
    )
    result = app.apply_import("a", preview, default_task_list_id="inbox")
    assert result.tasks[0].priority is TaskPriority.LOW
    diagnostics = app.diagnostics()
    assert diagnostics["path"] == "<redacted>"
    assert "private@example.test" not in str(diagnostics)


def test_event_fields_round_trip_through_storage_and_outbox(app: ApplicationService) -> None:
    start = EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 9, tzinfo=UTC), "UTC")
    end = EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 10, tzinfo=UTC), "UTC")
    event = app.create_event(
        "a",
        "cal",
        "Focus",
        start,
        end,
        attendees=({"email": "guest@example.test", "optional": True},),
        reminder_use_default=False,
        reminder_overrides=(ReminderOverride("popup", 10),),
        event_type="focusTime",
        visibility="private",
        transparency="opaque",
        color_id="5",
        attachments=({"fileId": "drive-1", "title": "Brief"},),
        conference={"createRequest": {"requestId": "stable-request"}},
        guests_can_modify=False,
        focus_time_properties={"autoDeclineMode": "declineAllConflictingInvitations"},
        send_updates="all",
        supports_attachments=True,
        conference_data_version=1,
    )
    assert app.storage.get_event("a", event.id) == event
    payload = app.storage.pending_mutations("a")[-1].payload
    assert payload["body"]["attendees"][0]["optional"] is True
    assert payload["body"]["reminders"]["overrides"] == [{"method": "popup", "minutes": 10}]
    assert payload["body"]["focusTimeProperties"]["autoDeclineMode"].startswith("decline")
    assert (
        payload["send_updates"],
        payload["supports_attachments"],
        payload["conference_data_version"],
    ) == ("all", True, 1)


def test_calendar_list_operations_notes_projection_and_schedule_idempotency(
    app: ApplicationService,
) -> None:
    subscribed = app.subscribe_calendar("a", "shared@example.test", summary="Shared")
    assert app.storage.pending_mutations("a")[-1].operation.value == "subscribe"
    app.remove_calendar_from_list("a", subscribed.id)
    assert app.storage.pending_mutations("a")[-1].operation.value == "remove"

    note = app.create_task("a", "inbox", "Undated root")
    dated = app.create_task("a", "inbox", "Dated", due=date(2026, 8, 22))
    app.set_notes_projection("a", "notes-only")
    assert {item.id for item in app.notes_listing("a")} == {note.id}
    assert {item.id for item in app.task_listing("a")} == {dated.id}

    start = EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 9, tzinfo=UTC), "UTC")
    end = EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 10, tzinfo=UTC), "UTC")
    first, _ = app.schedule_task("a", dated.id, "cal", start, end)
    moved, _ = app.schedule_task("a", dated.id, "cal", start, end)
    assert moved.id == first.id
    assert len([link for link in app.list_task_event_links("a") if link.task_id == dated.id]) == 1


def test_completed_recurring_task_creates_one_successor(app: ApplicationService) -> None:
    series = "3a21dc8d-2cb4-4b9a-980f-7aaf75ae2f43"
    marker = TaskRecurrenceMarker(
        series,
        f"{series}:0",
        0,
        "daily",
        1,
        "2026-08-21",
        "UTC",
        RecurrenceEnd("count", count=2),
        "",
        (),
        (),
        "Daily task",
        "2026-08-21",
        "none",
    )
    notes = serialize_task_notes("memo", marker).notes
    task = app.create_task(
        "a", "inbox", "Daily task", notes=notes, due=date(2026, 8, 21), due_time_zone="UTC"
    )
    app.complete_task("a", task.id)
    app.reconcile_task_recurrence("a")
    occurrences = [
        parse_task_recurrence_notes(item.notes or "").marker
        for item in app.storage.list_tasks("a")
        if parse_task_recurrence_notes(item.notes or "").marker
    ]
    assert [item.occurrence_id for item in occurrences].count(f"{series}:1") == 1


def test_undo_redo_unpushed_create_restores_projection_and_outbox(
    app: ApplicationService,
) -> None:
    task = app.create_task("a", "inbox", "Undo me")
    app.undo("a")
    assert app.storage.get_task("a", task.id) is None
    assert all(item.entity_id != task.id for item in app.storage.pending_mutations("a"))
    app.redo("a")
    assert app.storage.get_task("a", task.id).title == "Undo me"
    assert app.storage.pending_mutations("a")[-1].operation.value == "create"
