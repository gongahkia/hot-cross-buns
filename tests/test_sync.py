from datetime import UTC, datetime
from pathlib import Path

import pytest

from hcb.errors import GoogleApiError
from hcb.google_client import Page
from hcb.models import (
    Account,
    Calendar,
    EntityType,
    Metadata,
    MutationOperation,
    PendingMutation,
    SyncCursor,
    Task,
    TaskList,
)
from hcb.storage import Storage
from hcb.sync import SyncEngine

NOW = datetime(2026, 8, 21, 8, tzinfo=UTC)
EVENT = {
    "id": "event-r",
    "summary": "Standup",
    "start": {"dateTime": "2026-08-21T09:00:00Z"},
    "end": {"dateTime": "2026-08-21T09:30:00Z"},
    "updated": "2026-08-21T07:00:00Z",
    "etag": '"event-1"',
}


class FakeGateway:
    def __init__(self):
        self.task_list_pages = {None: Page(())}
        self.task_pages = {None: Page(())}
        self.calendar_pages = {None: Page(())}
        self.event_pages = {None: Page((), next_sync_token="sync-1")}
        self.calls = []
        self.fail = None
        self.created_task = {"id": "task-r", "etag": '"task-1"', "updated": "2026-08-21T08:00:00Z"}

    def list_task_lists(self, *, page_token=None):
        self.calls.append(("task-lists", page_token))
        return self.task_list_pages[page_token]

    def list_tasks(self, task_list_id, *, page_token=None, updated_min=None):
        self.calls.append(("tasks", task_list_id, page_token, updated_min))
        return self.task_pages[page_token]

    def list_calendars(self, *, page_token=None, sync_token=None):
        self.calls.append(("calendars", page_token, sync_token))
        return self.calendar_pages[page_token]

    def list_events(
        self,
        calendar_id,
        *,
        page_token=None,
        sync_token=None,
        time_min=None,
        time_max=None,
        single_events=False,
    ):
        self.calls.append(("events", calendar_id, page_token, sync_token, single_events))
        if self.fail:
            failure, self.fail = self.fail, None
            raise failure
        return self.event_pages[page_token]

    def create_task(self, task_list_id, body):
        self.calls.append(("create-task", task_list_id, body))
        if self.fail:
            failure, self.fail = self.fail, None
            raise failure
        return self.created_task

    def update_task(self, *args, **kwargs):
        if self.fail:
            raise self.fail
        return {"id": args[1]}

    def delete_task(self, *args, **kwargs):
        if self.fail:
            raise self.fail

    def move_task(self, *args, **kwargs):
        return {"id": args[1]}

    def create_task_list(self, body):
        return {"id": "list-r"}

    def update_task_list(self, task_list_id, body, *, etag=None):
        return {"id": task_list_id}

    def delete_task_list(self, task_list_id, *, etag=None):
        return None

    def create_calendar(self, body):
        return {"id": "cal-r"}

    def subscribe_calendar(self, calendar_id):
        self.calls.append(("subscribe-calendar", calendar_id))
        return {"id": calendar_id}

    def remove_calendar(self, calendar_id):
        self.calls.append(("remove-calendar", calendar_id))

    def update_calendar(self, calendar_id, body, *, etag=None):
        return {"id": calendar_id}

    def delete_calendar(self, calendar_id, *, etag=None):
        return None

    def create_event(self, calendar_id, body, **kwargs):
        self.calls.append(("create-event", calendar_id, body, kwargs))
        return {"id": "event-r"}

    def update_event(self, calendar_id, event_id, body, *, etag=None, **kwargs):
        return {"id": event_id}

    def delete_event(self, calendar_id, event_id, *, etag=None, **kwargs):
        return None

    def move_event(self, calendar_id, event_id, destination):
        return {"id": event_id}

    def respond_event(self, calendar_id, event_id, response_status, *, etag=None, **kwargs):
        return {"id": event_id}

    def freebusy(self, body):
        return {"calendars": {}}

    def drive_metadata(self, file_id, *, fields="*"):
        return {"id": file_id}

    def search_drive_metadata(self, query, *, page_token=None, page_size=100):
        return Page(({"id": "drive-1", "name": query},))


@pytest.fixture
def store(tmp_path: Path):
    with Storage(tmp_path / "sync.db") as result:
        result.upsert_account(Account("a", "a@example.test"))
        result.upsert_task_list(TaskList("list", "a", "Inbox", remote_id="list-r"))
        result.upsert_calendar(Calendar("cal", "a", "Primary", remote_id="cal-r"))
        yield result


def test_initial_and_incremental_task_sync_uses_overlap(store):
    gateway = FakeGateway()
    gateway.task_pages = {
        None: Page(
            (
                {
                    "id": "task-r",
                    "title": "One",
                    "status": "needsAction",
                    "updated": "2026-08-21T07:00:00Z",
                },
            )
        )
    }
    engine = SyncEngine(store, gateway, now=lambda: NOW)
    engine.sync_tasks("a", store.get_task_list("a", "list"))
    assert store.get_task("a", "task-r").title == "One"
    assert gateway.calls[-1][-1] is None

    engine.sync_tasks("a", store.get_task_list("a", "list"))
    assert gateway.calls[-1][-1] == "2026-08-21T07:55:00Z"


def test_page_checkpoint_resumes_without_replaying_committed_page(store):
    gateway = FakeGateway()
    gateway.task_pages = {
        None: Page(({"id": "one", "title": "One"},), next_page_token="p2"),
        "p2": Page(({"id": "two", "title": "Two"},)),
    }
    original = gateway.list_tasks
    failed = False

    def interrupted(task_list_id, *, page_token=None, updated_min=None):
        nonlocal failed
        if page_token == "p2" and not failed:
            failed = True
            raise GoogleApiError(503, "temporary")
        return original(task_list_id, page_token=page_token, updated_min=updated_min)

    gateway.list_tasks = interrupted
    engine = SyncEngine(store, gateway, now=lambda: NOW)
    with pytest.raises(GoogleApiError):
        engine.sync_tasks("a", store.get_task_list("a", "list"))
    assert store.get_task("a", "one") is not None

    engine.sync_tasks("a", store.get_task_list("a", "list"))
    assert [call[2] for call in gateway.calls if call[0] == "tasks"] == [None, "p2"]
    assert store.get_task("a", "two") is not None


def test_calendar_410_resets_only_expired_calendar_cursor(store):
    gateway = FakeGateway()
    store.set_cursor(SyncCursor("a", "events:cal-r", "old"))
    store.set_cursor(SyncCursor("a", "events:other", "keep"))
    gateway.fail = GoogleApiError(410, "expired")
    SyncEngine(store, gateway).sync_events("a", store.get_calendar("a", "cal"))
    event_calls = [call for call in gateway.calls if call[0] == "events"]
    assert [call[3] for call in event_calls] == ["old", None]
    assert store.get_cursor("a", "events:cal-r").cursor == "sync-1"
    assert store.get_cursor("a", "events:other").cursor == "keep"


def test_outbox_create_reconciles_id_and_retry_retains_write(store):
    gateway = FakeGateway()
    store.upsert_task(Task("tmp", "a", "list", "Local"))
    mutation = PendingMutation(
        None,
        "a",
        EntityType.TASK,
        "tmp",
        MutationOperation.CREATE,
        {"list_id": "list", "body": {"title": "Local"}},
    )
    store.enqueue(mutation)
    gateway.fail = GoogleApiError(429, "slow", retry_after=9)
    result = SyncEngine(store, gateway).flush_outbox("a")
    assert result.retry_pending and result.retry_after == 9
    assert store.pending_mutations("a")[0].attempts == 1

    gateway.fail = None
    result = SyncEngine(store, gateway).flush_outbox("a")
    assert result.pushed == 1
    assert store.pending_mutations("a") == []
    assert store.get_task("a", "tmp").remote_id == "task-r"


@pytest.mark.parametrize("status", [409, 410, 412])
def test_outbox_conflicts_are_recorded_without_dropping_later_writes(store, status):
    gateway = FakeGateway()
    store.upsert_task(Task("tmp", "a", "list", "Local"))
    for title in ("first", "second"):
        store.enqueue(
            PendingMutation(
                None,
                "a",
                EntityType.TASK,
                "tmp",
                MutationOperation.CREATE,
                {"list_id": "list", "body": {"title": title}},
            )
        )
    gateway.fail = GoogleApiError(status, "conflict")
    result = SyncEngine(store, gateway).flush_outbox("a")
    assert result.conflicts == 1 and result.pushed == 1
    assert len(store.list_conflicts("a")) == 1
    assert store.pending_mutations("a") == []


def test_pull_preserves_dirty_local_write_and_accounts_are_isolated(store):
    store.upsert_account(Account("b", "b@example.test"))
    store.upsert_task_list(TaskList("list", "b", "B", remote_id="list-b"))
    dirty = Task(
        "local",
        "a",
        "list",
        "Local",
        remote_id="task-r",
        metadata=Metadata(dirty=True),
    )
    store.upsert_task(dirty)
    gateway = FakeGateway()
    gateway.task_pages = {None: Page(({"id": "task-r", "title": "Remote"},))}
    SyncEngine(store, gateway).sync_tasks("a", store.get_task_list("a", "list"))
    assert store.get_task("a", "local").title == "Local"
    assert store.list_tasks("b") == []


def test_calendar_list_mutations_use_distinct_gateway_resources(store):
    gateway = FakeGateway()
    store.enqueue(
        PendingMutation(
            None,
            "a",
            EntityType.CALENDAR,
            "cal",
            MutationOperation.SUBSCRIBE,
            {"remote_id": "shared@example.test"},
        )
    )
    store.enqueue(
        PendingMutation(
            None,
            "a",
            EntityType.CALENDAR,
            "cal",
            MutationOperation.REMOVE,
            {"remote_id": "shared@example.test"},
        )
    )
    result = SyncEngine(store, gateway).flush_outbox("a")
    assert result.pushed == 2
    assert ("subscribe-calendar", "cal-r") in gateway.calls
    assert ("remove-calendar", "cal-r") in gateway.calls
