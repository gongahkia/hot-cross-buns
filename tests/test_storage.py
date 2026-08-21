from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from hcb.models import (
    Account,
    Calendar,
    Conflict,
    ConflictStatus,
    DateTimeKind,
    EntityType,
    Event,
    EventDateTime,
    MutationOperation,
    PendingMutation,
    SyncCursor,
    Task,
    TaskList,
)
from hcb.storage import SCHEMA_VERSION, Storage


@pytest.fixture
def store(tmp_path: Path):
    with Storage(tmp_path / "hcb.db") as result:
        yield result


def seed(store: Storage, account_id: str = "a") -> None:
    store.upsert_account(Account(account_id, f"{account_id}@example.test"))
    store.upsert_task_list(TaskList("list", account_id, "Inbox"))
    store.upsert_calendar(Calendar("cal", account_id, "Primary"))


def test_schema_wal_and_account_partitioning(store: Storage) -> None:
    seed(store, "a")
    seed(store, "b")
    store.upsert_task(Task("same", "a", "list", "Alpha needle"))
    store.upsert_task(Task("same", "b", "list", "Beta"))
    assert store.get_task("a", "same").title == "Alpha needle"
    assert store.get_task("b", "same").title == "Beta"
    assert [task.id for task in store.search_tasks("a", "needle")] == ["same"]
    diagnostics = store.diagnostics()
    assert diagnostics["schema_version"] == SCHEMA_VERSION
    assert diagnostics["journal_mode"] == "wal"
    assert diagnostics["integrity"] == "ok"


def test_event_occurrences_and_range_queries(store: Storage) -> None:
    seed(store)
    event = Event(
        "occ",
        "a",
        "cal",
        "Planning",
        EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 9, tzinfo=UTC)),
        EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 10, tzinfo=UTC)),
        canonical_id="series",
        occurrence_id="2026-08-21T09:00:00+00:00",
        recurrence=("RRULE:FREQ=WEEKLY",),
    )
    store.upsert_event(event)
    assert store.get_event("a", "occ") == event
    assert store.get_event("a", "occ").is_occurrence
    assert len(store.list_events("a", start=date(2026, 8, 21), end=date(2026, 8, 22))) == 1
    assert store.search_events("a", "Plan") == [event]


def test_outbox_cursor_conflict_reminder_and_transaction(store: Storage) -> None:
    seed(store)
    mutation_id = store.enqueue(
        PendingMutation(
            None, "a", EntityType.TASK, "task", MutationOperation.CREATE, {"title": "New"}
        )
    )
    store.fail_mutation("a", mutation_id, "offline")
    assert store.pending_mutations("a")[0].attempts == 1
    store.complete_mutation("a", mutation_id)
    assert store.pending_mutations("a") == []

    store.set_cursor(SyncCursor("a", "tasks", "next"))
    assert store.get_cursor("a", "tasks").cursor == "next"
    checkpoint = store.start_checkpoint("a", "tasks")
    store.finish_checkpoint(checkpoint, cursor="next")

    conflict_id = store.add_conflict(
        Conflict(None, "a", EntityType.TASK, "task", {"title": "L"}, {"title": "R"})
    )
    assert store.list_conflicts("a")[0].id == conflict_id
    store.resolve_conflict("a", conflict_id, ConflictStatus.KEEP_LOCAL)
    assert store.list_conflicts("a") == []

    now = datetime.now(UTC)
    store.set_reminder("a", "event", now)
    assert store.due_reminders("a", now)[0]["event_id"] == "event"

    with pytest.raises(RuntimeError), store.transaction():
        store.upsert_task(Task("rolled-back", "a", "list", "No"))
        raise RuntimeError("stop")
    assert store.get_task("a", "rolled-back") is None
