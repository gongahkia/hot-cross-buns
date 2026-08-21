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
    TaskList,
    TaskPriority,
)
from hcb.storage import Storage


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
