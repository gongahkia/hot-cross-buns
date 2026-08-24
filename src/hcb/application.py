"""UI-independent, optimistic application services.

All provider-backed writes in this module update the local projection and append
an outbox record inside one SQLite transaction.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .errors import ConflictError, NotFoundError
from .import_export import (
    ImportedEvent,
    ImportedTask,
    ImportPreview,
    parse_import,
)
from .models import (
    Account,
    Calendar,
    Conflict,
    ConflictStatus,
    DateTimeKind,
    DriveFile,
    EntityType,
    Event,
    EventDateTime,
    EventStatus,
    Metadata,
    MutationOperation,
    NotesProjection,
    PendingMutation,
    ReminderOverride,
    Task,
    TaskList,
    TaskPriority,
    TaskStatus,
    utc_now,
)
from .quick_capture import (
    QuickCaptureKind,
    QuickCapturePreferences,
    QuickCaptureResult,
    parse_quick_capture,
)
from .search import parse_palette_query
from .storage import Storage
from .task_recurrence import (
    parse_task_recurrence_notes,
    serialize_task_notes,
    task_recurrence_successor,
)

Json = dict[str, Any]
ResponseStatus = Literal["accepted", "declined", "tentative", "needsAction"]


class _Unset:
    pass


_UNSET = _Unset()


@dataclass(frozen=True, slots=True)
class SavedSearch:
    id: str
    account_id: str
    name: str
    query: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class TaskEventLink:
    account_id: str
    task_id: str
    event_id: str
    created_at: datetime
    orphaned: bool = False


@dataclass(frozen=True, slots=True)
class SearchResult:
    kind: Literal["task", "event", "calendar", "task-list", "drive", "saved-search", "conflict"]
    item: Task | Event | Calendar | TaskList | DriveFile | SavedSearch | Conflict
    score: int

    @property
    def display_title(self) -> str:
        if isinstance(self.item, (Task, TaskList)):
            return self.item.title
        if isinstance(self.item, Event | Calendar):
            return self.item.summary
        if isinstance(self.item, DriveFile):
            return self.item.name
        if isinstance(self.item, SavedSearch):
            return self.item.name
        return f"{self.item.entity_type.value.title()} conflict · {self.item.entity_id}"


@dataclass(frozen=True, slots=True)
class ImportApplyResult:
    tasks: tuple[Task, ...] = ()
    events: tuple[Event, ...] = ()


@dataclass(frozen=True, slots=True)
class WorkspaceSnapshot:
    account: Account
    tasks: tuple[Task, ...]
    events: tuple[Event, ...]
    task_lists: tuple[TaskList, ...]
    calendars: tuple[Calendar, ...]
    pending: int


@dataclass(frozen=True, slots=True)
class TimeSlot:
    start: datetime
    end: datetime


@dataclass(frozen=True, slots=True)
class BatchMovePreview:
    """Validated local plan for a serial task or event move."""

    entity_type: Literal["task", "event"]
    destination_id: str
    items: tuple[Task | Event, ...]


@dataclass(frozen=True, slots=True)
class BatchActionPreview:
    """Validated local plan for a batch action before it changes the mirror."""

    entity_type: Literal["task", "event"]
    action: Literal["complete", "reopen", "delete", "respond"]
    items: tuple[Task | Event, ...]
    response_status: ResponseStatus | None = None


def _id() -> str:
    return uuid4().hex


def _dirty(metadata: Metadata, *, deleted: bool | None = None) -> Metadata:
    return replace(
        metadata,
        dirty=True,
        deleted=metadata.deleted if deleted is None else deleted,
        local_updated_at=utc_now(),
    )


def _event_point(value: EventDateTime) -> Json:
    if value.kind is DateTimeKind.DATE:
        return {"date": value.value.isoformat()}
    result: Json = {"dateTime": value.value.isoformat()}
    if value.time_zone:
        result["timeZone"] = value.time_zone
    return result


class ApplicationService:
    """Optimistic local domain boundary used by every UI."""

    def __init__(
        self,
        storage: Storage,
        *,
        notes_projection: NotesProjection | str | None = None,
    ) -> None:
        self.storage = storage
        self._notes_projection = NotesProjection(notes_projection) if notes_projection else None

    def _account(self, account_id: str) -> None:
        if self.storage.get_account(account_id) is None:
            raise NotFoundError(f"Account {account_id!r} does not exist")

    def workspace(self, account_id: str) -> WorkspaceSnapshot:
        """Return one local-only snapshot for interactive clients."""
        account = self.storage.get_account(account_id)
        if account is None:
            raise NotFoundError(f"Account {account_id!r} does not exist")
        return WorkspaceSnapshot(
            account=account,
            tasks=tuple(self.storage.list_tasks(account_id)),
            events=tuple(self.storage.list_events(account_id)),
            task_lists=tuple(self.storage.list_task_lists(account_id)),
            calendars=tuple(self.storage.list_calendars(account_id)),
            pending=len(self.storage.pending_mutations(account_id)),
        )

    def find_time(
        self,
        account_id: str,
        day: date,
        *,
        duration_minutes: int = 30,
        day_start: int = 9,
        day_end: int = 17,
        step_minutes: int = 30,
    ) -> tuple[TimeSlot, ...]:
        """Find candidate wall-clock slots using only cached selected calendars."""
        self._account(account_id)
        if duration_minutes <= 0 or step_minutes <= 0:
            raise ValueError("duration and step must be positive")
        if not 0 <= day_start < day_end <= 24:
            raise ValueError("working hours must satisfy 0 <= start < end <= 24")
        window_start = datetime.combine(day, datetime.min.time()) + timedelta(hours=day_start)
        window_end = datetime.combine(day, datetime.min.time()) + timedelta(hours=day_end)
        selected = {item.id for item in self.storage.list_calendars(account_id) if item.selected}
        busy: list[tuple[datetime, datetime]] = []
        for event in self.storage.list_events(account_id, start=day, end=day + timedelta(days=1)):
            if event.calendar_id not in selected or event.status is EventStatus.CANCELLED:
                continue
            if event.start.kind is DateTimeKind.DATE:
                busy.append((window_start, window_end))
                continue
            start = event.start.value
            end = event.end.value
            assert isinstance(start, datetime) and isinstance(end, datetime)
            busy.append((start.replace(tzinfo=None), end.replace(tzinfo=None)))
        duration = timedelta(minutes=duration_minutes)
        step = timedelta(minutes=step_minutes)
        result: list[TimeSlot] = []
        cursor = window_start
        while cursor + duration <= window_end:
            end = cursor + duration
            if not any(cursor < busy_end and end > busy_start for busy_start, busy_end in busy):
                result.append(TimeSlot(cursor, end))
            cursor += step
        return tuple(result)

    def agenda_events(
        self,
        account_id: str,
        *,
        start: date | datetime,
        end: date | datetime,
        calendar_id: str | None = None,
    ) -> tuple[Event, ...]:
        """Return a local range view, preferring refreshed instances over series masters."""
        events = self.storage.list_events(account_id, calendar_id, start=start, end=end)
        expanded_series = {
            event.canonical_id for event in events if event.derived and event.canonical_id
        }
        return tuple(
            event
            for event in events
            if event.derived or not event.recurrence or event.remote_id not in expanded_series
        )

    def invitations(self, account_id: str) -> tuple[Event, ...]:
        """List cached events where the authenticated attendee has an RSVP state."""
        return tuple(
            event for event in self.storage.list_events(account_id) if event.attendee_response
        )

    def notes_projection(self, account_id: str) -> NotesProjection:
        if self._notes_projection is not None:
            return self._notes_projection
        row = self.storage.connection.execute(
            "SELECT value FROM app_settings WHERE account_id=? AND key='notes_projection'",
            (account_id,),
        ).fetchone()
        return NotesProjection(row["value"]) if row else NotesProjection.MIRRORED

    def task_listing(self, account_id: str) -> tuple[Task, ...]:
        tasks = tuple(self.storage.list_tasks(account_id))
        if self.notes_projection(account_id) is NotesProjection.NOTES_ONLY:
            return tuple(
                task for task in tasks if task.due is not None or task.parent_id is not None
            )
        return tasks

    def notes_listing(self, account_id: str) -> tuple[Task, ...]:
        if self.notes_projection(account_id) is NotesProjection.DISABLED:
            return ()
        return tuple(
            task
            for task in self.storage.list_tasks(account_id)
            if task.due is None and task.parent_id is None
        )

    def set_notes_projection(
        self, account_id: str, projection: NotesProjection | str
    ) -> NotesProjection:
        self._account(account_id)
        value = NotesProjection(projection)
        with self.storage.transaction():
            self.storage.connection.execute(
                """INSERT INTO app_settings(account_id,key,value) VALUES (?,?,?)
                ON CONFLICT(account_id,key) DO UPDATE SET value=excluded.value""",
                (account_id, "notes_projection", value.value),
            )
        return value

    def _enqueue(
        self,
        account_id: str,
        entity_type: EntityType,
        entity_id: str,
        operation: MutationOperation,
        payload: Json,
    ) -> int:
        return self.storage.enqueue(
            PendingMutation(None, account_id, entity_type, entity_id, operation, payload)
        )

    def _snapshot(self, table: str, account_id: str, entity_id: str) -> Json | None:
        row = self.storage.connection.execute(
            f"SELECT * FROM {table} WHERE account_id=? AND id=?",  # noqa: S608
            (account_id, entity_id),
        ).fetchone()
        return dict(row) if row else None

    def _intent(
        self,
        account_id: str,
        action: str,
        entity_type: EntityType,
        entity_id: str,
        before: Json | None,
        after: Json | None,
    ) -> None:
        self.storage.connection.execute(
            "DELETE FROM intents WHERE account_id=? AND state='undone'", (account_id,)
        )
        self.storage.connection.execute(
            """INSERT INTO intents(account_id,action,entity_type,entity_id,before_payload,
            after_payload,state,created_at) VALUES (?,?,?,?,?,?,?,?)""",
            (
                account_id,
                action,
                entity_type.value,
                entity_id,
                json.dumps(before, sort_keys=True) if before is not None else None,
                json.dumps(after, sort_keys=True) if after is not None else None,
                "applied",
                utc_now().isoformat(),
            ),
        )

    @staticmethod
    def _task_body(task: Task, projection: NotesProjection) -> Json:
        body: Json = {"title": task.title, "status": task.status.value}
        if projection is not NotesProjection.DISABLED and task.notes is not None:
            body["notes"] = task.notes
        if task.due is not None:
            body["due"] = datetime.combine(task.due, datetime.min.time(), UTC).isoformat()
        if task.completed_at is not None:
            body["completed"] = task.completed_at.isoformat()
        return body

    @staticmethod
    def _event_body(event: Event) -> Json:
        body: Json = {
            "summary": event.summary,
            "start": _event_point(event.start),
            "end": _event_point(event.end),
            "status": event.status.value,
        }
        if event.description is not None:
            body["description"] = event.description
        if event.location is not None:
            body["location"] = event.location
        if event.recurrence:
            body["recurrence"] = list(event.recurrence)
        body["reminders"] = {
            "useDefault": event.reminder_use_default,
            "overrides": [
                {"method": item.method, "minutes": item.minutes}
                for item in event.reminder_overrides
            ],
        }
        for key, value in (
            ("attendees", list(event.attendees)),
            ("eventType", event.event_type),
            ("transparency", event.transparency),
            ("visibility", event.visibility),
            ("colorId", event.color_id),
            ("attachments", list(event.attachments)),
            ("conferenceData", event.conference),
            ("guestsCanInviteOthers", event.guests_can_invite_others),
            ("guestsCanModify", event.guests_can_modify),
            ("guestsCanSeeOtherGuests", event.guests_can_see_other_guests),
            ("anyoneCanAddSelf", event.anyone_can_add_self),
            ("focusTimeProperties", event.focus_time_properties),
            ("outOfOfficeProperties", event.out_of_office_properties),
            ("workingLocationProperties", event.working_location_properties),
        ):
            if value not in (None, [], ()):
                body[key] = value
        return body

    @staticmethod
    def _validate_zone(value: str | None) -> None:
        if value is None:
            return
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"invalid time zone {value!r}") from exc

    @classmethod
    def _validate_event_times(cls, start: EventDateTime, end: EventDateTime) -> None:
        if start.kind is not end.kind:
            raise ValueError("event start and end must both be dates or both be date-times")
        cls._validate_zone(start.time_zone)
        cls._validate_zone(end.time_zone)
        if start.kind is DateTimeKind.DATE:
            if start.time_zone or end.time_zone:
                raise ValueError("all-day events cannot have a time zone")
        else:
            start_value = start.value
            end_value = end.value
            assert isinstance(start_value, datetime) and isinstance(end_value, datetime)
            if (start_value.tzinfo is None) != (end_value.tzinfo is None):
                raise ValueError("timed event endpoints must use matching timezone awareness")
            if start_value.tzinfo is None and not (start.time_zone and end.time_zone):
                raise ValueError("naive timed events require explicit IANA time zones")
        if end.value <= start.value:
            raise ValueError("event end must be after start")

    @staticmethod
    def _validate_event_options(
        send_updates: str, supports_attachments: bool, conference_data_version: int
    ) -> None:
        if send_updates not in {"none", "all", "externalOnly"}:
            raise ValueError("send_updates must be none, all, or externalOnly")
        if not isinstance(supports_attachments, bool):
            raise ValueError("supports_attachments must be boolean")
        if conference_data_version not in {0, 1}:
            raise ValueError("conference_data_version must be 0 or 1")

    def create_task_list(
        self, account_id: str, title: str, *, position: int = 0, id: str | None = None
    ) -> TaskList:
        self._account(account_id)
        if not title.strip():
            raise ValueError("task list title is required")
        item = TaskList(
            id or _id(), account_id, title.strip(), position=position, metadata=_dirty(Metadata())
        )
        with self.storage.transaction():
            self.storage.upsert_task_list(item)
            self._enqueue(
                account_id,
                EntityType.TASK_LIST,
                item.id,
                MutationOperation.CREATE,
                {"body": {"title": item.title}},
            )
            self._intent(
                account_id,
                "create",
                EntityType.TASK_LIST,
                item.id,
                None,
                self._snapshot("task_lists", account_id, item.id),
            )
        return item

    def update_task_list(
        self,
        account_id: str,
        list_id: str,
        *,
        title: str | None = None,
        position: int | None = None,
    ) -> TaskList:
        current = self._require_task_list(account_id, list_id)
        if title is not None and not title.strip():
            raise ValueError("task list title is required")
        updated = replace(
            current,
            title=title.strip() if title is not None else current.title,
            position=position if position is not None else current.position,
            metadata=_dirty(current.metadata),
        )
        with self.storage.transaction():
            before = self._snapshot("task_lists", account_id, list_id)
            self.storage.upsert_task_list(updated)
            self._enqueue(
                account_id,
                EntityType.TASK_LIST,
                list_id,
                MutationOperation.UPDATE,
                {
                    "body": {"title": updated.title},
                    "etag": current.metadata.etag,
                    "remote_id": current.remote_id,
                },
            )
            self._intent(
                account_id,
                "update",
                EntityType.TASK_LIST,
                list_id,
                before,
                self._snapshot("task_lists", account_id, list_id),
            )
        return updated

    def delete_task_list(self, account_id: str, list_id: str) -> TaskList:
        current = self._require_task_list(account_id, list_id)
        deleted = replace(current, metadata=_dirty(current.metadata, deleted=True))
        with self.storage.transaction():
            before = self._snapshot("task_lists", account_id, list_id)
            self.storage.upsert_task_list(deleted)
            self.storage.connection.execute(
                """UPDATE tasks SET deleted=1,dirty=1,local_updated_at=?
                WHERE account_id=? AND list_id=?""",
                (utc_now().isoformat(), account_id, list_id),
            )
            self._enqueue(
                account_id,
                EntityType.TASK_LIST,
                list_id,
                MutationOperation.DELETE,
                {"remote_id": current.remote_id, "etag": current.metadata.etag},
            )
            self._intent(
                account_id,
                "delete",
                EntityType.TASK_LIST,
                list_id,
                before,
                self._snapshot("task_lists", account_id, list_id),
            )
        return deleted

    def _require_task_list(self, account_id: str, list_id: str) -> TaskList:
        item = self.storage.get_task_list(account_id, list_id)
        if item is None or item.metadata.deleted:
            raise NotFoundError(f"Task list {list_id!r} does not exist")
        return item

    def _require_task(self, account_id: str, task_id: str) -> Task:
        item = self.storage.get_task(account_id, task_id)
        if item is None or item.metadata.deleted:
            raise NotFoundError(f"Task {task_id!r} does not exist")
        return item

    def create_task(
        self,
        account_id: str,
        list_id: str,
        title: str,
        *,
        notes: str | None = None,
        due: date | None = None,
        due_time_zone: str | None = None,
        priority: TaskPriority | str = TaskPriority.NONE,
        parent_id: str | None = None,
        position: str | None = None,
        id: str | None = None,
    ) -> Task:
        self._require_task_list(account_id, list_id)
        if not title.strip():
            raise ValueError("task title is required")
        if isinstance(due, datetime):
            raise ValueError("task due values are date-only")
        self._validate_zone(due_time_zone)
        if due is None and due_time_zone is not None:
            raise ValueError("a due time zone requires a due date")
        if parent_id is not None:
            parent = self._require_task(account_id, parent_id)
            if parent.list_id != list_id:
                raise ValueError("a task parent must be in the same list")
        task = Task(
            id=id or _id(),
            account_id=account_id,
            list_id=list_id,
            title=title.strip(),
            notes=notes,
            due=due,
            parent_id=parent_id,
            position=position,
            metadata=_dirty(Metadata()),
            priority=TaskPriority(priority),
            due_time_zone=due_time_zone,
        )
        with self.storage.transaction():
            self.storage.upsert_task(task)
            self._enqueue(
                account_id,
                EntityType.TASK,
                task.id,
                MutationOperation.CREATE,
                {
                    "list_id": list_id,
                    "body": self._task_body(task, self.notes_projection(account_id)),
                    "parent": parent_id,
                    "previous": position,
                },
            )
            self._intent(
                account_id,
                "create",
                EntityType.TASK,
                task.id,
                None,
                self._snapshot("tasks", account_id, task.id),
            )
        return task

    def update_task(
        self,
        account_id: str,
        task_id: str,
        *,
        title: str | None = None,
        notes: str | None | _Unset = _UNSET,
        due: date | None = None,
        clear_due: bool = False,
        due_time_zone: str | None = None,
        priority: TaskPriority | str | None = None,
    ) -> Task:
        current = self._require_task(account_id, task_id)
        if title is not None and not title.strip():
            raise ValueError("task title is required")
        if isinstance(due, datetime):
            raise ValueError("task due values are date-only")
        next_due = None if clear_due else (due if due is not None else current.due)
        next_zone = due_time_zone if due_time_zone is not None else current.due_time_zone
        if clear_due:
            next_zone = None
        self._validate_zone(next_zone)
        if next_due is None and next_zone is not None:
            raise ValueError("a due time zone requires a due date")
        updated = replace(
            current,
            title=title.strip() if title is not None else current.title,
            notes=current.notes if isinstance(notes, _Unset) else notes,
            due=next_due,
            due_time_zone=next_zone,
            priority=TaskPriority(priority) if priority is not None else current.priority,
            metadata=_dirty(current.metadata),
        )
        with self.storage.transaction():
            before = self._snapshot("tasks", account_id, task_id)
            self.storage.upsert_task(updated)
            self._enqueue(
                account_id,
                EntityType.TASK,
                task_id,
                MutationOperation.UPDATE,
                {
                    "list_id": current.list_id,
                    "body": self._task_body(updated, self.notes_projection(account_id)),
                    "etag": current.metadata.etag,
                    "remote_id": current.remote_id,
                },
            )
            self._intent(
                account_id,
                "update",
                EntityType.TASK,
                task_id,
                before,
                self._snapshot("tasks", account_id, task_id),
            )
        return updated

    def complete_task(self, account_id: str, task_id: str, *, completed: bool = True) -> Task:
        current = self._require_task(account_id, task_id)
        now = utc_now() if completed else None
        updated = replace(
            current,
            status=TaskStatus.COMPLETED if completed else TaskStatus.NEEDS_ACTION,
            completed_at=now,
            metadata=_dirty(current.metadata),
        )
        with self.storage.transaction():
            before = self._snapshot("tasks", account_id, task_id)
            self.storage.upsert_task(updated)
            self._enqueue(
                account_id,
                EntityType.TASK,
                task_id,
                MutationOperation.UPDATE,
                {
                    "list_id": current.list_id,
                    "body": self._task_body(updated, self.notes_projection(account_id)),
                    "etag": current.metadata.etag,
                    "remote_id": current.remote_id,
                },
            )
            self._intent(
                account_id,
                "complete",
                EntityType.TASK,
                task_id,
                before,
                self._snapshot("tasks", account_id, task_id),
            )
            if completed:
                self._ensure_recurrence_successor(updated)
        return updated

    def _ensure_recurrence_successor(self, task: Task) -> Task | None:
        parsed = parse_task_recurrence_notes(task.notes or "")
        if parsed.state != "managed" or parsed.marker is None:
            return None
        successor = task_recurrence_successor(parsed.marker)
        if successor is None:
            return None
        for candidate in self.storage.list_tasks(task.account_id, include_deleted=True):
            marker = parse_task_recurrence_notes(candidate.notes or "").marker
            if marker and marker.occurrence_id == successor.occurrence_id:
                return candidate
        serialized = serialize_task_notes(parsed.user_notes, successor, parsed.reminder)
        if serialized.error:
            raise ValueError(serialized.error)
        return self.create_task(
            task.account_id,
            task.list_id,
            successor.template_title,
            notes=serialized.notes,
            due=date.fromisoformat(successor.template_due_date),
            due_time_zone=successor.time_zone,
            priority=successor.template_priority,
        )

    def reconcile_task_recurrence(self, account_id: str) -> tuple[Task, ...]:
        created: list[Task] = []
        with self.storage.transaction():
            for task in self.storage.list_tasks(account_id):
                if task.status is TaskStatus.COMPLETED:
                    successor = self._ensure_recurrence_successor(task)
                    if successor and successor.id != task.id:
                        created.append(successor)
        return tuple(created)

    def complete_tasks(
        self, account_id: str, task_ids: list[str], *, completed: bool = True
    ) -> tuple[Task, ...]:
        preview = self.preview_task_completion(account_id, task_ids, completed=completed)
        with self.storage.transaction():
            return tuple(
                self.complete_task(account_id, task.id, completed=completed)
                for task in preview.items
                if isinstance(task, Task)
            )

    def delete_tasks(self, account_id: str, task_ids: list[str]) -> tuple[Task, ...]:
        preview = self.preview_task_deletion(account_id, task_ids)
        with self.storage.transaction():
            return tuple(
                self.delete_task(account_id, task.id)
                for task in preview.items
                if isinstance(task, Task)
            )

    def _batch_tasks(self, account_id: str, task_ids: list[str]) -> tuple[Task, ...]:
        ids = tuple(dict.fromkeys(task_ids))
        if not ids:
            raise ValueError("select at least one task")
        return tuple(self._require_task(account_id, task_id) for task_id in ids)

    def preview_task_completion(
        self, account_id: str, task_ids: list[str], *, completed: bool
    ) -> BatchActionPreview:
        return BatchActionPreview(
            "task",
            "complete" if completed else "reopen",
            self._batch_tasks(account_id, task_ids),
        )

    def preview_task_deletion(self, account_id: str, task_ids: list[str]) -> BatchActionPreview:
        return BatchActionPreview("task", "delete", self._batch_tasks(account_id, task_ids))

    def preview_task_move(
        self, account_id: str, task_ids: list[str], list_id: str
    ) -> BatchMovePreview:
        """Validate a task batch before moving every target to a list's top level."""
        destination = self._require_task_list(account_id, list_id)
        targets = self._batch_tasks(account_id, task_ids)
        selected = {task.id for task in targets}
        all_tasks = {task.id: task for task in self.storage.list_tasks(account_id)}

        for task in targets:
            parent_id = task.parent_id
            seen = {task.id}
            while parent_id:
                if parent_id in seen:
                    raise ValueError("task hierarchy contains a parent cycle")
                if parent_id in selected:
                    raise ValueError(
                        "a task batch move cannot include both a parent and its subtask"
                    )
                seen.add(parent_id)
                parent = all_tasks.get(parent_id)
                if parent is None:
                    break
                parent_id = parent.parent_id

        if any(task.list_id != destination.id for task in targets):
            children = {task.parent_id for task in all_tasks.values() if task.parent_id}
            parent_ids = selected.intersection(children)
            if parent_ids:
                raise ValueError(
                    "a cross-list batch move cannot include tasks with subtasks; "
                    "move the hierarchy one task at a time"
                )
        return BatchMovePreview("task", destination.id, targets)

    def move_tasks(self, account_id: str, task_ids: list[str], list_id: str) -> tuple[Task, ...]:
        """Move validated task leaves serially to the destination list's top level."""
        preview = self.preview_task_move(account_id, task_ids, list_id)
        with self.storage.transaction():
            return tuple(
                self.move_task(account_id, task.id, list_id=preview.destination_id)
                for task in preview.items
                if isinstance(task, Task)
            )

    def move_task(
        self,
        account_id: str,
        task_id: str,
        *,
        list_id: str | None = None,
        parent_id: str | None = None,
        previous_id: str | None = None,
    ) -> Task:
        current = self._require_task(account_id, task_id)
        destination = list_id or current.list_id
        self._require_task_list(account_id, destination)
        if parent_id == task_id:
            raise ValueError("a task cannot parent itself")
        if parent_id:
            parent = self._require_task(account_id, parent_id)
            if parent.list_id != destination:
                raise ValueError("a task parent must be in the destination list")
            cursor = parent
            seen = {task_id}
            while cursor.parent_id:
                if cursor.parent_id in seen:
                    raise ValueError("task move would create a parent cycle")
                seen.add(cursor.parent_id)
                cursor = self._require_task(account_id, cursor.parent_id)
        if previous_id:
            previous = self._require_task(account_id, previous_id)
            if previous.list_id != destination or previous.parent_id != parent_id:
                raise ValueError("previous task must be a sibling in the destination list")
        updated = replace(
            current,
            list_id=destination,
            parent_id=parent_id,
            position=previous_id,
            metadata=_dirty(current.metadata),
        )
        with self.storage.transaction():
            before = self._snapshot("tasks", account_id, task_id)
            self.storage.upsert_task(updated)
            self._enqueue(
                account_id,
                EntityType.TASK,
                task_id,
                MutationOperation.MOVE,
                {
                    "source_list_id": current.list_id,
                    "list_id": destination,
                    "parent": parent_id,
                    "previous": previous_id,
                    "remote_id": current.remote_id,
                    "body": self._task_body(updated, self.notes_projection(account_id)),
                },
            )
            self._intent(
                account_id,
                "move",
                EntityType.TASK,
                task_id,
                before,
                self._snapshot("tasks", account_id, task_id),
            )
        return updated

    reparent_task = move_task
    reorder_task = move_task

    def delete_task(self, account_id: str, task_id: str) -> Task:
        current = self._require_task(account_id, task_id)
        deleted = replace(current, metadata=_dirty(current.metadata, deleted=True))
        with self.storage.transaction():
            before = self._snapshot("tasks", account_id, task_id)
            self.storage.upsert_task(deleted)
            self._enqueue(
                account_id,
                EntityType.TASK,
                task_id,
                MutationOperation.DELETE,
                {
                    "list_id": current.list_id,
                    "remote_id": current.remote_id,
                    "etag": current.metadata.etag,
                },
            )
            self._intent(
                account_id,
                "delete",
                EntityType.TASK,
                task_id,
                before,
                self._snapshot("tasks", account_id, task_id),
            )
        return deleted

    def _require_calendar(self, account_id: str, calendar_id: str) -> Calendar:
        item = self.storage.get_calendar(account_id, calendar_id)
        if item is None or item.metadata.deleted:
            raise NotFoundError(f"Calendar {calendar_id!r} does not exist")
        return item

    def create_calendar(
        self,
        account_id: str,
        summary: str,
        *,
        description: str | None = None,
        time_zone: str | None = None,
        color: str | None = None,
        location: str | None = None,
        selected: bool = True,
        id: str | None = None,
    ) -> Calendar:
        self._account(account_id)
        if not summary.strip():
            raise ValueError("calendar summary is required")
        self._validate_zone(time_zone)
        item = Calendar(
            id or _id(),
            account_id,
            summary.strip(),
            description=description,
            time_zone=time_zone,
            color=color,
            location=location,
            selected=selected,
            metadata=_dirty(Metadata()),
        )
        body = {"summary": item.summary}
        if description is not None:
            body["description"] = description
        if time_zone is not None:
            body["timeZone"] = time_zone
        if location is not None:
            body["location"] = location
        with self.storage.transaction():
            self.storage.upsert_calendar(item)
            self._enqueue(
                account_id,
                EntityType.CALENDAR,
                item.id,
                MutationOperation.CREATE,
                {"body": body},
            )
            if color is not None or not selected:
                list_body: Json = {}
                if color is not None:
                    list_body["backgroundColor"] = color
                if not selected:
                    list_body["selected"] = selected
                self._enqueue(
                    account_id,
                    EntityType.CALENDAR,
                    item.id,
                    MutationOperation.UPDATE,
                    {"body": list_body, "resource": "calendar-list"},
                )
            self._intent(
                account_id,
                "create",
                EntityType.CALENDAR,
                item.id,
                None,
                self._snapshot("calendars", account_id, item.id),
            )
        return item

    def subscribe_calendar(
        self, account_id: str, remote_calendar_id: str, *, summary: str | None = None
    ) -> Calendar:
        self._account(account_id)
        if not remote_calendar_id.strip():
            raise ValueError("remote calendar id is required")
        existing = self.storage.get_calendar_by_remote(account_id, remote_calendar_id)
        if existing and not existing.metadata.deleted:
            raise ValueError("calendar is already in the calendar list")
        item = Calendar(
            existing.id if existing else _id(),
            account_id,
            summary or remote_calendar_id,
            remote_id=remote_calendar_id,
            metadata=_dirty(existing.metadata if existing else Metadata()),
        )
        with self.storage.transaction():
            self.storage.upsert_calendar(item)
            self._enqueue(
                account_id,
                EntityType.CALENDAR,
                item.id,
                MutationOperation.SUBSCRIBE,
                {"remote_id": remote_calendar_id},
            )
        return item

    def update_calendar(
        self,
        account_id: str,
        calendar_id: str,
        *,
        summary: str | None = None,
        description: str | None | _Unset = _UNSET,
        time_zone: str | None | _Unset = _UNSET,
        color: str | None | _Unset = _UNSET,
        foreground_color: str | None | _Unset = _UNSET,
        location: str | None | _Unset = _UNSET,
        summary_override: str | None | _Unset = _UNSET,
        hidden: bool | _Unset = _UNSET,
        selected: bool | _Unset = _UNSET,
        default_reminders: tuple[ReminderOverride, ...] | _Unset = _UNSET,
        notification_settings: tuple[dict[str, Any], ...] | _Unset = _UNSET,
    ) -> Calendar:
        current = self._require_calendar(account_id, calendar_id)
        if summary is not None and not summary.strip():
            raise ValueError("calendar summary is required")
        if not isinstance(time_zone, _Unset):
            self._validate_zone(time_zone)
        calendar_change = summary is not None or any(
            not isinstance(value, _Unset) for value in (description, time_zone, location)
        )
        list_change = any(
            not isinstance(value, _Unset)
            for value in (
                color,
                foreground_color,
                summary_override,
                hidden,
                selected,
                default_reminders,
                notification_settings,
            )
        )
        updated = replace(
            current,
            summary=summary.strip() if summary is not None else current.summary,
            description=current.description if isinstance(description, _Unset) else description,
            time_zone=current.time_zone if isinstance(time_zone, _Unset) else time_zone,
            color=current.color if isinstance(color, _Unset) else color,
            foreground_color=(
                current.foreground_color
                if isinstance(foreground_color, _Unset)
                else foreground_color
            ),
            location=current.location if isinstance(location, _Unset) else location,
            summary_override=(
                current.summary_override
                if isinstance(summary_override, _Unset)
                else summary_override
            ),
            hidden=current.hidden if isinstance(hidden, _Unset) else hidden,
            selected=current.selected if isinstance(selected, _Unset) else selected,
            default_reminders=(
                current.default_reminders
                if isinstance(default_reminders, _Unset)
                else default_reminders
            ),
            notification_settings=(
                current.notification_settings
                if isinstance(notification_settings, _Unset)
                else notification_settings
            ),
            metadata=_dirty(current.metadata)
            if calendar_change or list_change
            else current.metadata,
        )
        calendar_body: Json = {}
        if summary is not None:
            calendar_body["summary"] = updated.summary
        if not isinstance(description, _Unset):
            calendar_body["description"] = updated.description
        if not isinstance(time_zone, _Unset):
            calendar_body["timeZone"] = updated.time_zone
        if not isinstance(location, _Unset):
            calendar_body["location"] = updated.location
        list_body: Json = {}
        for key, value in (
            ("backgroundColor", color),
            ("foregroundColor", foreground_color),
            ("summaryOverride", summary_override),
            ("hidden", hidden),
            ("selected", selected),
        ):
            if not isinstance(value, _Unset):
                list_body[key] = value
        if not isinstance(default_reminders, _Unset):
            list_body["defaultReminders"] = [
                {"method": item.method, "minutes": item.minutes}
                for item in updated.default_reminders
            ]
        if not isinstance(notification_settings, _Unset):
            list_body["notificationSettings"] = {
                "notifications": list(updated.notification_settings)
            }
        with self.storage.transaction():
            before = self._snapshot("calendars", account_id, calendar_id)
            self.storage.upsert_calendar(updated)
            if calendar_change:
                self._enqueue(
                    account_id,
                    EntityType.CALENDAR,
                    calendar_id,
                    MutationOperation.UPDATE,
                    {
                        "body": calendar_body,
                        "etag": current.metadata.etag,
                        "remote_id": current.remote_id,
                    },
                )
            if list_change:
                self._enqueue(
                    account_id,
                    EntityType.CALENDAR,
                    calendar_id,
                    MutationOperation.UPDATE,
                    {
                        "body": list_body,
                        "etag": current.metadata.etag,
                        "remote_id": current.remote_id,
                        "resource": "calendar-list",
                    },
                )
            self._intent(
                account_id,
                "update",
                EntityType.CALENDAR,
                calendar_id,
                before,
                self._snapshot("calendars", account_id, calendar_id),
            )
        return updated

    def delete_calendar(self, account_id: str, calendar_id: str) -> Calendar:
        current = self._require_calendar(account_id, calendar_id)
        deleted = replace(current, metadata=_dirty(current.metadata, deleted=True))
        with self.storage.transaction():
            before = self._snapshot("calendars", account_id, calendar_id)
            self.storage.upsert_calendar(deleted)
            self.storage.connection.execute(
                """UPDATE events SET deleted=1,dirty=1,local_updated_at=?
                WHERE account_id=? AND calendar_id=?""",
                (utc_now().isoformat(), account_id, calendar_id),
            )
            self._enqueue(
                account_id,
                EntityType.CALENDAR,
                calendar_id,
                MutationOperation.DELETE,
                {"remote_id": current.remote_id, "etag": current.metadata.etag},
            )
            self._intent(
                account_id,
                "delete",
                EntityType.CALENDAR,
                calendar_id,
                before,
                self._snapshot("calendars", account_id, calendar_id),
            )
        return deleted

    def remove_calendar_from_list(self, account_id: str, calendar_id: str) -> Calendar:
        current = self._require_calendar(account_id, calendar_id)
        if not current.remote_id:
            raise ValueError("an unsynchronized calendar cannot be removed from CalendarList")
        deleted = replace(current, metadata=_dirty(current.metadata, deleted=True))
        with self.storage.transaction():
            self.storage.upsert_calendar(deleted)
            self._enqueue(
                account_id,
                EntityType.CALENDAR,
                calendar_id,
                MutationOperation.REMOVE,
                {"remote_id": current.remote_id},
            )
        return deleted

    def _require_event(self, account_id: str, event_id: str) -> Event:
        item = self.storage.get_event(account_id, event_id)
        if item is None or item.metadata.deleted:
            raise NotFoundError(f"Event {event_id!r} does not exist")
        return item

    def create_event(
        self,
        account_id: str,
        calendar_id: str,
        summary: str,
        start: EventDateTime,
        end: EventDateTime,
        *,
        description: str | None = None,
        location: str | None = None,
        recurrence: tuple[str, ...] = (),
        reminder_use_default: bool = True,
        reminder_overrides: tuple[ReminderOverride, ...] = (),
        attendees: tuple[dict[str, Any], ...] = (),
        event_type: str | None = None,
        transparency: str | None = None,
        visibility: str | None = None,
        color_id: str | None = None,
        attachments: tuple[dict[str, Any], ...] = (),
        conference: dict[str, Any] | None = None,
        guests_can_invite_others: bool | None = None,
        guests_can_modify: bool | None = None,
        guests_can_see_other_guests: bool | None = None,
        anyone_can_add_self: bool | None = None,
        focus_time_properties: dict[str, Any] | None = None,
        out_of_office_properties: dict[str, Any] | None = None,
        working_location_properties: dict[str, Any] | None = None,
        send_updates: str = "none",
        supports_attachments: bool = False,
        conference_data_version: int = 0,
        id: str | None = None,
    ) -> Event:
        self._require_calendar(account_id, calendar_id)
        if not summary.strip():
            raise ValueError("event summary is required")
        self._validate_event_times(start, end)
        self._validate_event_options(send_updates, supports_attachments, conference_data_version)
        event = Event(
            id or _id(),
            account_id,
            calendar_id,
            summary.strip(),
            start,
            end,
            description=description,
            location=location,
            recurrence=recurrence,
            metadata=_dirty(Metadata()),
            reminder_use_default=reminder_use_default,
            reminder_overrides=reminder_overrides,
            attendees=attendees,
            event_type=event_type,
            transparency=transparency,
            visibility=visibility,
            color_id=color_id,
            attachments=attachments,
            conference=conference,
            guests_can_invite_others=guests_can_invite_others,
            guests_can_modify=guests_can_modify,
            guests_can_see_other_guests=guests_can_see_other_guests,
            anyone_can_add_self=anyone_can_add_self,
            focus_time_properties=focus_time_properties,
            out_of_office_properties=out_of_office_properties,
            working_location_properties=working_location_properties,
        )
        with self.storage.transaction():
            self.storage.upsert_event(event)
            if event.recurrence:
                self.storage.mark_instance_ranges_stale(
                    account_id, calendar_id, reason="local-recurring-event-created"
                )
            self._enqueue(
                account_id,
                EntityType.EVENT,
                event.id,
                MutationOperation.CREATE,
                {
                    "calendar_id": calendar_id,
                    "body": self._event_body(event),
                    "send_updates": send_updates,
                    "supports_attachments": supports_attachments,
                    "conference_data_version": conference_data_version,
                },
            )
            self._intent(
                account_id,
                "create",
                EntityType.EVENT,
                event.id,
                None,
                self._snapshot("events", account_id, event.id),
            )
        return event

    def update_event(
        self,
        account_id: str,
        event_id: str,
        *,
        summary: str | None = None,
        start: EventDateTime | None = None,
        end: EventDateTime | None = None,
        description: str | None | _Unset = _UNSET,
        location: str | None | _Unset = _UNSET,
        status: EventStatus | str | None = None,
        recurrence: tuple[str, ...] | _Unset = _UNSET,
        attendees: tuple[dict[str, Any], ...] | _Unset = _UNSET,
        reminder_use_default: bool | _Unset = _UNSET,
        reminder_overrides: tuple[ReminderOverride, ...] | _Unset = _UNSET,
        event_type: str | None | _Unset = _UNSET,
        transparency: str | None | _Unset = _UNSET,
        visibility: str | None | _Unset = _UNSET,
        color_id: str | None | _Unset = _UNSET,
        attachments: tuple[dict[str, Any], ...] | _Unset = _UNSET,
        conference: dict[str, Any] | None | _Unset = _UNSET,
        guests_can_invite_others: bool | None | _Unset = _UNSET,
        guests_can_modify: bool | None | _Unset = _UNSET,
        guests_can_see_other_guests: bool | None | _Unset = _UNSET,
        anyone_can_add_self: bool | None | _Unset = _UNSET,
        focus_time_properties: dict[str, Any] | None | _Unset = _UNSET,
        out_of_office_properties: dict[str, Any] | None | _Unset = _UNSET,
        working_location_properties: dict[str, Any] | None | _Unset = _UNSET,
        send_updates: str = "none",
        supports_attachments: bool = False,
        conference_data_version: int = 0,
        scope: Literal["this", "series"] = "this",
    ) -> Event:
        current = self._require_event(account_id, event_id)
        affects_instance_cache = current.is_occurrence or bool(current.recurrence)
        if scope not in {"this", "series"}:
            raise ValueError("event scope must be this or series")
        if scope == "series" and current.is_occurrence:
            if not current.canonical_id:
                raise ValueError("event occurrence has no canonical recurring series")
            series = self.storage.get_event_by_remote(account_id, current.canonical_id)
            if series is None:
                raise ValueError("the canonical recurring series is not cached")
            current = series
            event_id = series.id
        self._validate_event_options(send_updates, supports_attachments, conference_data_version)
        if summary is not None and not summary.strip():
            raise ValueError("event summary is required")
        next_start, next_end = start or current.start, end or current.end
        self._validate_event_times(next_start, next_end)
        updated = replace(
            current,
            summary=summary.strip() if summary is not None else current.summary,
            start=next_start,
            end=next_end,
            description=current.description if isinstance(description, _Unset) else description,
            location=current.location if isinstance(location, _Unset) else location,
            status=EventStatus(status) if status is not None else current.status,
            recurrence=current.recurrence if isinstance(recurrence, _Unset) else recurrence,
            attendees=current.attendees if isinstance(attendees, _Unset) else attendees,
            reminder_use_default=(
                current.reminder_use_default
                if isinstance(reminder_use_default, _Unset)
                else reminder_use_default
            ),
            reminder_overrides=(
                current.reminder_overrides
                if isinstance(reminder_overrides, _Unset)
                else reminder_overrides
            ),
            event_type=current.event_type if isinstance(event_type, _Unset) else event_type,
            transparency=current.transparency if isinstance(transparency, _Unset) else transparency,
            visibility=current.visibility if isinstance(visibility, _Unset) else visibility,
            color_id=current.color_id if isinstance(color_id, _Unset) else color_id,
            attachments=current.attachments if isinstance(attachments, _Unset) else attachments,
            conference=current.conference if isinstance(conference, _Unset) else conference,
            guests_can_invite_others=(
                current.guests_can_invite_others
                if isinstance(guests_can_invite_others, _Unset)
                else guests_can_invite_others
            ),
            guests_can_modify=(
                current.guests_can_modify
                if isinstance(guests_can_modify, _Unset)
                else guests_can_modify
            ),
            guests_can_see_other_guests=(
                current.guests_can_see_other_guests
                if isinstance(guests_can_see_other_guests, _Unset)
                else guests_can_see_other_guests
            ),
            anyone_can_add_self=(
                current.anyone_can_add_self
                if isinstance(anyone_can_add_self, _Unset)
                else anyone_can_add_self
            ),
            focus_time_properties=(
                current.focus_time_properties
                if isinstance(focus_time_properties, _Unset)
                else focus_time_properties
            ),
            out_of_office_properties=(
                current.out_of_office_properties
                if isinstance(out_of_office_properties, _Unset)
                else out_of_office_properties
            ),
            working_location_properties=(
                current.working_location_properties
                if isinstance(working_location_properties, _Unset)
                else working_location_properties
            ),
            metadata=_dirty(current.metadata),
        )
        affects_instance_cache = affects_instance_cache or bool(updated.recurrence)
        body = self._event_body(updated)
        for key, value, changed in (
            ("description", updated.description, not isinstance(description, _Unset)),
            ("location", updated.location, not isinstance(location, _Unset)),
            ("recurrence", list(updated.recurrence), not isinstance(recurrence, _Unset)),
            ("attendees", list(updated.attendees), not isinstance(attendees, _Unset)),
            ("eventType", updated.event_type, not isinstance(event_type, _Unset)),
            ("transparency", updated.transparency, not isinstance(transparency, _Unset)),
            ("visibility", updated.visibility, not isinstance(visibility, _Unset)),
            ("colorId", updated.color_id, not isinstance(color_id, _Unset)),
            ("attachments", list(updated.attachments), not isinstance(attachments, _Unset)),
            ("conferenceData", updated.conference, not isinstance(conference, _Unset)),
            (
                "guestsCanInviteOthers",
                updated.guests_can_invite_others,
                not isinstance(guests_can_invite_others, _Unset),
            ),
            (
                "guestsCanModify",
                updated.guests_can_modify,
                not isinstance(guests_can_modify, _Unset),
            ),
            (
                "guestsCanSeeOtherGuests",
                updated.guests_can_see_other_guests,
                not isinstance(guests_can_see_other_guests, _Unset),
            ),
            (
                "anyoneCanAddSelf",
                updated.anyone_can_add_self,
                not isinstance(anyone_can_add_self, _Unset),
            ),
            (
                "focusTimeProperties",
                updated.focus_time_properties,
                not isinstance(focus_time_properties, _Unset),
            ),
            (
                "outOfOfficeProperties",
                updated.out_of_office_properties,
                not isinstance(out_of_office_properties, _Unset),
            ),
            (
                "workingLocationProperties",
                updated.working_location_properties,
                not isinstance(working_location_properties, _Unset),
            ),
        ):
            if changed:
                body[key] = value
        if not isinstance(reminder_use_default, _Unset) or not isinstance(
            reminder_overrides, _Unset
        ):
            body["reminders"] = {
                "useDefault": updated.reminder_use_default,
                "overrides": [
                    {"method": item.method, "minutes": item.minutes}
                    for item in updated.reminder_overrides
                ],
            }
        with self.storage.transaction():
            before = self._snapshot("events", account_id, event_id)
            self.storage.upsert_event(updated)
            if affects_instance_cache:
                self.storage.mark_instance_ranges_stale(
                    account_id, current.calendar_id, reason="local-recurring-event-updated"
                )
            self._enqueue(
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.UPDATE,
                {
                    "calendar_id": current.calendar_id,
                    "body": body,
                    "etag": current.metadata.etag,
                    "remote_id": current.remote_id,
                    "target_remote_id": (
                        current.canonical_id
                        if scope == "series" and current.is_occurrence
                        else current.remote_id
                    ),
                    "send_updates": send_updates,
                    "supports_attachments": supports_attachments,
                    "conference_data_version": conference_data_version,
                },
            )
            self._intent(
                account_id,
                "update",
                EntityType.EVENT,
                event_id,
                before,
                self._snapshot("events", account_id, event_id),
            )
        return updated

    def move_event(self, account_id: str, event_id: str, calendar_id: str) -> Event:
        current = self._require_event(account_id, event_id)
        self._require_calendar(account_id, calendar_id)
        affects_instance_cache = current.is_occurrence or bool(current.recurrence)
        updated = replace(current, calendar_id=calendar_id, metadata=_dirty(current.metadata))
        with self.storage.transaction():
            before = self._snapshot("events", account_id, event_id)
            self.storage.upsert_event(updated)
            if affects_instance_cache:
                self.storage.mark_instance_ranges_stale(
                    account_id, current.calendar_id, reason="local-recurring-event-moved"
                )
                if calendar_id != current.calendar_id:
                    self.storage.mark_instance_ranges_stale(
                        account_id, calendar_id, reason="local-recurring-event-moved"
                    )
            self._enqueue(
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.MOVE,
                {
                    "calendar_id": current.calendar_id,
                    "destination": calendar_id,
                    "remote_id": current.remote_id,
                },
            )
            self._intent(
                account_id,
                "move",
                EntityType.EVENT,
                event_id,
                before,
                self._snapshot("events", account_id, event_id),
            )
        return updated

    def duplicate_event(
        self,
        account_id: str,
        event_id: str,
        *,
        calendar_id: str | None = None,
        summary: str | None = None,
        start: EventDateTime | None = None,
        end: EventDateTime | None = None,
        include_recurrence: bool = False,
        include_attendees: bool = False,
        send_updates: str = "none",
    ) -> Event:
        """Create an independent copy; invitations and recurrence are opt-in."""
        source = self._require_event(account_id, event_id)
        target_calendar = calendar_id or source.calendar_id
        return self.create_event(
            account_id,
            target_calendar,
            summary or source.summary,
            start or source.start,
            end or source.end,
            description=source.description,
            location=source.location,
            recurrence=source.recurrence if include_recurrence else (),
            reminder_use_default=source.reminder_use_default,
            reminder_overrides=source.reminder_overrides,
            attendees=source.attendees if include_attendees else (),
            event_type=source.event_type,
            transparency=source.transparency,
            visibility=source.visibility,
            color_id=source.color_id,
            attachments=source.attachments,
            guests_can_invite_others=source.guests_can_invite_others,
            guests_can_modify=source.guests_can_modify,
            guests_can_see_other_guests=source.guests_can_see_other_guests,
            anyone_can_add_self=source.anyone_can_add_self,
            focus_time_properties=source.focus_time_properties,
            out_of_office_properties=source.out_of_office_properties,
            working_location_properties=source.working_location_properties,
            send_updates=send_updates,
            supports_attachments=bool(source.attachments),
        )

    def respond_event(
        self,
        account_id: str,
        event_id: str,
        response_status: ResponseStatus,
        *,
        comment: str | None = None,
        send_updates: str = "all",
    ) -> PendingMutation:
        current = self._require_event(account_id, event_id)
        if response_status not in {"accepted", "declined", "tentative", "needsAction"}:
            raise ValueError("invalid RSVP response")
        payload = {
            "calendar_id": current.calendar_id,
            "response_status": response_status,
            "remote_id": current.remote_id,
            "etag": current.metadata.etag,
            "comment": comment,
            "send_updates": send_updates,
        }
        with self.storage.transaction():
            mutation_id = self._enqueue(
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.RESPOND,
                payload,
            )
        return replace(
            PendingMutation(
                mutation_id,
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.RESPOND,
                payload,
            )
        )

    def respond_events(
        self,
        account_id: str,
        event_ids: list[str],
        response_status: ResponseStatus,
        *,
        comment: str | None = None,
        send_updates: str = "all",
    ) -> tuple[PendingMutation, ...]:
        preview = self.preview_event_response(account_id, event_ids, response_status)
        with self.storage.transaction():
            return tuple(
                self.respond_event(
                    account_id,
                    event.id,
                    response_status,
                    comment=comment,
                    send_updates=send_updates,
                )
                for event in preview.items
                if isinstance(event, Event)
            )

    def delete_events(self, account_id: str, event_ids: list[str]) -> tuple[Event, ...]:
        preview = self.preview_event_deletion(account_id, event_ids)
        with self.storage.transaction():
            return tuple(
                self.delete_event(account_id, event.id)
                for event in preview.items
                if isinstance(event, Event)
            )

    def _batch_events(self, account_id: str, event_ids: list[str]) -> tuple[Event, ...]:
        ids = tuple(dict.fromkeys(event_ids))
        if not ids:
            raise ValueError("select at least one event")
        return tuple(self._require_event(account_id, event_id) for event_id in ids)

    def preview_event_response(
        self, account_id: str, event_ids: list[str], response_status: ResponseStatus
    ) -> BatchActionPreview:
        if response_status not in {"accepted", "declined", "tentative", "needsAction"}:
            raise ValueError("invalid RSVP response")
        return BatchActionPreview(
            "event",
            "respond",
            self._batch_events(account_id, event_ids),
            response_status=response_status,
        )

    def preview_event_deletion(self, account_id: str, event_ids: list[str]) -> BatchActionPreview:
        return BatchActionPreview("event", "delete", self._batch_events(account_id, event_ids))

    def preview_event_move(
        self, account_id: str, event_ids: list[str], calendar_id: str
    ) -> BatchMovePreview:
        """Validate that every selected event supports a native calendar move."""
        destination = self._require_calendar(account_id, calendar_id)
        targets = self._batch_events(account_id, event_ids)
        unsupported = [
            event.summary for event in targets if event.event_type not in {None, "default"}
        ]
        if unsupported:
            raise ValueError(
                "Google only moves default events between calendars; unsupported: "
                + ", ".join(unsupported)
            )
        return BatchMovePreview("event", destination.id, targets)

    def move_events(
        self, account_id: str, event_ids: list[str], calendar_id: str
    ) -> tuple[Event, ...]:
        preview = self.preview_event_move(account_id, event_ids, calendar_id)
        with self.storage.transaction():
            return tuple(
                self.move_event(account_id, event.id, preview.destination_id)
                for event in preview.items
                if isinstance(event, Event)
            )

    def delete_event(
        self,
        account_id: str,
        event_id: str,
        *,
        scope: Literal["this", "series"] = "this",
        send_updates: str = "none",
    ) -> Event:
        current = self._require_event(account_id, event_id)
        affects_instance_cache = current.is_occurrence or bool(current.recurrence)
        if scope not in {"this", "series"}:
            raise ValueError("event scope must be this or series")
        series_remote_id: str | None = None
        if scope == "series" and current.is_occurrence:
            if not current.canonical_id:
                raise ValueError("event occurrence has no canonical recurring series")
            series = self.storage.get_event_by_remote(account_id, current.canonical_id)
            if series is None:
                raise ValueError("the canonical recurring series is not cached")
            series_remote_id = current.canonical_id
            current = series
            event_id = series.id
        self._validate_event_options(send_updates, False, 0)
        deleted = replace(current, metadata=_dirty(current.metadata, deleted=True))
        with self.storage.transaction():
            before = self._snapshot("events", account_id, event_id)
            self.storage.upsert_event(deleted)
            if affects_instance_cache:
                self.storage.mark_instance_ranges_stale(
                    account_id, current.calendar_id, reason="local-recurring-event-deleted"
                )
            if series_remote_id:
                self.storage.hide_cached_series_instances(
                    account_id, current.calendar_id, series_remote_id
                )
            self._enqueue(
                account_id,
                EntityType.EVENT,
                event_id,
                MutationOperation.DELETE,
                {
                    "calendar_id": current.calendar_id,
                    "remote_id": current.remote_id,
                    "target_remote_id": (
                        current.canonical_id
                        if scope == "series" and current.is_occurrence
                        else current.remote_id
                    ),
                    "etag": current.metadata.etag,
                    "send_updates": send_updates,
                },
            )
            self._intent(
                account_id,
                "delete",
                EntityType.EVENT,
                event_id,
                before,
                self._snapshot("events", account_id, event_id),
            )
        return deleted

    def split_recurring_event(
        self, account_id: str, event_id: str, *, send_updates: str = "none"
    ) -> tuple[Event, Event]:
        occurrence = self._require_event(account_id, event_id)
        if not occurrence.is_occurrence or not occurrence.canonical_id:
            raise ValueError("split requires a synchronized recurring event instance")
        series = self.storage.get_event_by_remote(account_id, occurrence.canonical_id)
        if series is None or not series.recurrence:
            raise ValueError("the canonical recurring series is not cached")
        rule = next((line for line in series.recurrence if line.startswith("RRULE:")), None)
        if rule is None or "COUNT=" in rule:
            raise ValueError("split is unsupported for recurrence rules using COUNT")
        split_value = occurrence.start.value
        if isinstance(split_value, datetime):
            cutoff = (split_value.astimezone(UTC) - timedelta(seconds=1)).strftime("%Y%m%dT%H%M%SZ")
        else:
            cutoff = (split_value - timedelta(days=1)).strftime("%Y%m%d")
        old_rule = (
            ";".join(part for part in rule.split(";") if not part.startswith("UNTIL="))
            + f";UNTIL={cutoff}"
        )
        new_rule = ";".join(
            part for part in rule.split(";") if not part.startswith(("UNTIL=", "COUNT="))
        )
        with self.storage.transaction():
            old = self.update_event(
                account_id,
                series.id,
                recurrence=tuple(old_rule if line == rule else line for line in series.recurrence),
                send_updates=send_updates,
                scope="series",
            )
            new = self.create_event(
                account_id,
                occurrence.calendar_id,
                occurrence.summary,
                occurrence.start,
                occurrence.end,
                description=occurrence.description,
                location=occurrence.location,
                recurrence=tuple(new_rule if line == rule else line for line in series.recurrence),
                attendees=occurrence.attendees,
                reminder_use_default=occurrence.reminder_use_default,
                reminder_overrides=occurrence.reminder_overrides,
                send_updates=send_updates,
            )
        return old, new

    def save_search(
        self, account_id: str, name: str, query: str, *, id: str | None = None
    ) -> SavedSearch:
        self._account(account_id)
        if not name.strip() or not query.strip():
            raise ValueError("saved search name and query are required")
        item = SavedSearch(id or _id(), account_id, name.strip(), query.strip(), utc_now())
        with self.storage.transaction():
            self.storage.connection.execute(
                """INSERT INTO saved_searches VALUES (?,?,?,?,?)
                ON CONFLICT(account_id,name) DO UPDATE SET query=excluded.query""",
                (item.id, item.account_id, item.name, item.query, item.created_at.isoformat()),
            )
        row = self.storage.connection.execute(
            "SELECT * FROM saved_searches WHERE account_id=? AND name=?",
            (account_id, item.name),
        ).fetchone()
        assert row is not None
        return SavedSearch(
            row["id"],
            row["account_id"],
            row["name"],
            row["query"],
            datetime.fromisoformat(row["created_at"]),
        )

    def list_saved_searches(self, account_id: str) -> tuple[SavedSearch, ...]:
        rows = self.storage.connection.execute(
            "SELECT * FROM saved_searches WHERE account_id=? ORDER BY name", (account_id,)
        )
        return tuple(
            SavedSearch(
                row["id"],
                row["account_id"],
                row["name"],
                row["query"],
                datetime.fromisoformat(row["created_at"]),
            )
            for row in rows
        )

    def delete_saved_search(self, account_id: str, search_id: str) -> None:
        with self.storage.transaction():
            cursor = self.storage.connection.execute(
                "DELETE FROM saved_searches WHERE account_id=? AND id=?",
                (account_id, search_id),
            )
            if cursor.rowcount == 0:
                raise NotFoundError(f"Saved search {search_id!r} does not exist")

    @staticmethod
    def _score(title: str, text: str, body: str | None = None) -> int:
        if not text:
            return 1
        needle, candidate = text.casefold(), title.casefold()
        if candidate == needle:
            return 100
        if candidate.startswith(needle):
            return 80
        if needle in candidate:
            return 60
        return 20 if body and needle in body.casefold() else 0

    def search(
        self, account_id: str, query: str, *, today: date | None = None, limit: int = 50
    ) -> tuple[SearchResult, ...]:
        parsed = parse_palette_query(query)
        documents = self.storage.search_workspace(
            account_id,
            text=parsed.text,
            search_body=parsed.search_body,
            kinds=parsed.filters.types,
            source=parsed.filters.source,
            status=parsed.filters.status,
            priority=parsed.filters.priority,
            due=parsed.filters.due,
            completed=parsed.filters.completed,
            event_date=parsed.filters.date,
            list_query=parsed.filters.list_query,
            calendar_query=parsed.filters.calendar_query,
            today=today,
            limit=limit,
        )
        results: list[tuple[SearchResult, float, str]] = []
        for document in documents:
            item = self._workspace_search_item(account_id, document.kind, document.entity_id)
            if item is None:
                continue
            results.append(
                (
                    SearchResult(
                        document.kind,  # type: ignore[arg-type]
                        item,
                        self._score(
                            document.title,
                            parsed.text,
                            document.body if parsed.search_body else None,
                        ),
                    ),
                    document.rank,
                    document.entity_id,
                )
            )
        results.sort(key=lambda result: (-result[0].score, result[1], result[0].kind, result[2]))
        return tuple(result[0] for result in results)

    def _workspace_search_item(
        self, account_id: str, kind: str, entity_id: str
    ) -> Task | Event | Calendar | TaskList | DriveFile | SavedSearch | Conflict | None:
        if kind == "task":
            return self.storage.get_task(account_id, entity_id)
        if kind == "event":
            return self.storage.get_event(account_id, entity_id)
        if kind == "calendar":
            return self.storage.get_calendar(account_id, entity_id)
        if kind == "task-list":
            return self.storage.get_task_list(account_id, entity_id)
        if kind == "drive":
            return self.storage.get_drive_file(account_id, entity_id)
        if kind == "saved-search":
            row = self.storage.connection.execute(
                "SELECT * FROM saved_searches WHERE account_id=? AND id=?", (account_id, entity_id)
            ).fetchone()
            return (
                SavedSearch(
                    row["id"],
                    row["account_id"],
                    row["name"],
                    row["query"],
                    datetime.fromisoformat(row["created_at"]),
                )
                if row
                else None
            )
        if kind == "conflict" and entity_id.isdecimal():
            return self.storage.get_conflict(account_id, int(entity_id))
        return None

    def run_saved_search(
        self, account_id: str, search_id: str, *, today: date | None = None
    ) -> tuple[SearchResult, ...]:
        item = next(
            (saved for saved in self.list_saved_searches(account_id) if saved.id == search_id),
            None,
        )
        if item is None:
            raise NotFoundError(f"Saved search {search_id!r} does not exist")
        return self.search(account_id, item.query, today=today)

    def link_task_event(self, account_id: str, task_id: str, event_id: str) -> TaskEventLink:
        self._require_task(account_id, task_id)
        self._require_event(account_id, event_id)
        created = utc_now()
        with self.storage.transaction():
            self.storage.connection.execute(
                "INSERT OR IGNORE INTO task_event_links VALUES (?,?,?,?)",
                (account_id, task_id, event_id, created.isoformat()),
            )
        return TaskEventLink(account_id, task_id, event_id, created)

    def schedule_task(
        self,
        account_id: str,
        task_id: str,
        calendar_id: str,
        start: EventDateTime,
        end: EventDateTime,
        *,
        summary: str | None = None,
    ) -> tuple[Event, TaskEventLink]:
        """Create a calendar block and its durable local task link atomically."""
        task = self._require_task(account_id, task_id)
        with self.storage.transaction():
            active = [
                link
                for link in self.list_task_event_links(account_id)
                if link.task_id == task_id and not link.orphaned
            ]
            if active:
                event = self._require_event(account_id, active[0].event_id)
                updated = self.update_event(
                    account_id, event.id, summary=summary or task.title, start=start, end=end
                )
                return updated, active[0]
            event = self.create_event(
                account_id,
                calendar_id,
                summary or task.title,
                start,
                end,
                description=task.notes,
            )
            link = self.link_task_event(account_id, task_id, event.id)
        return event, link

    def unschedule_task(self, account_id: str, task_id: str) -> Event | None:
        links = [
            link
            for link in self.list_task_event_links(account_id)
            if link.task_id == task_id and not link.orphaned
        ]
        if not links:
            return None
        with self.storage.transaction():
            event = self.delete_event(account_id, links[0].event_id)
            self.unlink_task_event(account_id, task_id, event.id)
        return event

    def repair_task_schedule(self, account_id: str, task_id: str, event_id: str) -> TaskEventLink:
        self._require_task(account_id, task_id)
        self._require_event(account_id, event_id)
        with self.storage.transaction():
            self.storage.connection.execute(
                "DELETE FROM task_event_links WHERE account_id=? AND task_id=?",
                (account_id, task_id),
            )
            return self.link_task_event(account_id, task_id, event_id)

    def cache_drive_metadata(self, account_id: str, items: list[Json]) -> tuple[DriveFile, ...]:
        result = tuple(
            DriveFile(
                str(item["id"]),
                account_id,
                str(item.get("name", "")),
                item.get("mimeType"),
                item.get("webViewLink"),
                item.get("iconLink"),
                datetime.fromisoformat(item["modifiedTime"].replace("Z", "+00:00"))
                if item.get("modifiedTime")
                else None,
            )
            for item in items
        )
        with self.storage.transaction():
            for item in result:
                self.storage.upsert_drive_file(item)
        return result

    def unlink_task_event(self, account_id: str, task_id: str, event_id: str) -> None:
        with self.storage.transaction():
            self.storage.connection.execute(
                "DELETE FROM task_event_links WHERE account_id=? AND task_id=? AND event_id=?",
                (account_id, task_id, event_id),
            )

    def list_task_event_links(
        self, account_id: str, *, orphaned_only: bool = False
    ) -> tuple[TaskEventLink, ...]:
        rows = self.storage.connection.execute(
            """SELECT l.*,
            (t.id IS NULL OR t.deleted=1 OR e.id IS NULL OR e.deleted=1) AS orphaned
            FROM task_event_links l
            LEFT JOIN tasks t ON t.account_id=l.account_id AND t.id=l.task_id
            LEFT JOIN events e ON e.account_id=l.account_id AND e.id=l.event_id
            WHERE l.account_id=? ORDER BY l.created_at""",
            (account_id,),
        )
        links = tuple(
            TaskEventLink(
                row["account_id"],
                row["task_id"],
                row["event_id"],
                datetime.fromisoformat(row["created_at"]),
                bool(row["orphaned"]),
            )
            for row in rows
        )
        return tuple(link for link in links if link.orphaned) if orphaned_only else links

    def orphaned_task_event_links(self, account_id: str) -> tuple[TaskEventLink, ...]:
        return self.list_task_event_links(account_id, orphaned_only=True)

    def quick_capture(
        self,
        account_id: str,
        text: str,
        requested_kind: QuickCaptureKind,
        *,
        task_list_id: str | None = None,
        calendar_id: str | None = None,
        preferences: QuickCapturePreferences | None = None,
        disabled_recognition_ids: tuple[str, ...] = (),
        now: datetime | None = None,
        time_zone: str | None = None,
    ) -> Task | Event:
        parsed = parse_quick_capture(
            text, requested_kind, preferences, disabled_recognition_ids, now
        )
        title = parsed.parsed_title or parsed.raw_title
        if parsed.kind == "task":
            if task_list_id is None:
                raise ValueError("quick-captured tasks require a task list")
            return self.create_task(
                account_id,
                task_list_id,
                title,
                due=date.fromisoformat(parsed.date) if parsed.date else None,
                due_time_zone=time_zone if parsed.date else None,
                priority=TaskPriority(parsed.task_priority),
            )
        if calendar_id is None:
            raise ValueError("quick-captured events require a calendar")
        if not parsed.event_ready or parsed.date is None:
            raise ValueError("quick-captured events require a date")
        return self._event_from_capture(account_id, calendar_id, title, parsed, time_zone)

    def _event_from_capture(
        self,
        account_id: str,
        calendar_id: str,
        title: str,
        parsed: QuickCaptureResult,
        time_zone: str | None,
    ) -> Event:
        day = date.fromisoformat(parsed.date or "")
        if parsed.all_day:
            start = EventDateTime(DateTimeKind.DATE, day)
            end = EventDateTime(DateTimeKind.DATE, day + timedelta(days=1))
        else:
            if not parsed.time:
                raise ValueError("timed quick capture requires a time")
            clock = datetime.strptime(parsed.time, "%H:%M").time()
            start_value = datetime.combine(day, clock)
            if time_zone is None:
                raise ValueError("timed quick capture requires an IANA time zone")
            zone = ZoneInfo(time_zone)
            start_value = start_value.replace(tzinfo=zone)
            start = EventDateTime(DateTimeKind.DATETIME, start_value, time_zone)
            end = EventDateTime(
                DateTimeKind.DATETIME,
                start_value + timedelta(minutes=parsed.event_duration_minutes),
                time_zone,
            )
        recurrence = (parsed.recurrence.rrule,) if parsed.recurrence else ()
        return self.create_event(account_id, calendar_id, title, start, end, recurrence=recurrence)

    @staticmethod
    def preview_import(filename: str, source: str | bytes) -> ImportPreview:
        return parse_import(filename, source)

    def apply_import(
        self,
        account_id: str,
        preview: ImportPreview,
        *,
        default_task_list_id: str | None = None,
        default_calendar_id: str | None = None,
    ) -> ImportApplyResult:
        if preview.errors:
            raise ValueError("cannot apply an import preview containing global errors")
        records = tuple(row.record for row in preview.rows if row.record is not None)
        tasks: list[Task] = []
        events: list[Event] = []
        with self.storage.transaction():
            for record in records:
                if isinstance(record, ImportedTask):
                    list_id = self._resolve_list(account_id, record, default_task_list_id)
                    tasks.append(
                        self.create_task(
                            account_id,
                            list_id,
                            record.title,
                            notes=record.notes,
                            due=date.fromisoformat(record.due) if record.due else None,
                            priority=TaskPriority(record.priority),
                        )
                    )
                else:
                    calendar_id = self._resolve_calendar(account_id, record, default_calendar_id)
                    events.append(self._create_imported_event(account_id, calendar_id, record))
        return ImportApplyResult(tuple(tasks), tuple(events))

    def _resolve_list(self, account_id: str, record: ImportedTask, default: str | None) -> str:
        if record.list:
            match = next(
                (
                    item
                    for item in self.storage.list_task_lists(account_id)
                    if item.id == record.list or item.title.casefold() == record.list.casefold()
                ),
                None,
            )
            if match:
                return match.id
        if default:
            self._require_task_list(account_id, default)
            return default
        raise ValueError(f"no task list resolved for imported task {record.title!r}")

    def _resolve_calendar(self, account_id: str, record: ImportedEvent, default: str | None) -> str:
        if record.calendar:
            match = next(
                (
                    item
                    for item in self.storage.list_calendars(account_id)
                    if item.id == record.calendar
                    or item.summary.casefold() == record.calendar.casefold()
                ),
                None,
            )
            if match:
                return match.id
        if default:
            self._require_calendar(account_id, default)
            return default
        raise ValueError(f"no calendar resolved for imported event {record.title!r}")

    def _create_imported_event(
        self, account_id: str, calendar_id: str, record: ImportedEvent
    ) -> Event:
        if record.all_day:
            start = EventDateTime(DateTimeKind.DATE, date.fromisoformat(record.start))
            end = EventDateTime(DateTimeKind.DATE, date.fromisoformat(record.end))
        else:
            start_value = datetime.fromisoformat(record.start.replace("Z", "+00:00"))
            end_value = datetime.fromisoformat(record.end.replace("Z", "+00:00"))
            start = EventDateTime(DateTimeKind.DATETIME, start_value, record.time_zone)
            end = EventDateTime(DateTimeKind.DATETIME, end_value, record.time_zone)
        return self.create_event(
            account_id,
            calendar_id,
            record.title,
            start,
            end,
            description=record.description,
            location=record.location,
            recurrence=record.recurrence,
        )

    def resolve_conflict(
        self,
        account_id: str,
        conflict_id: int,
        resolution: ConflictStatus | str,
        *,
        merged_payload: Json | None = None,
    ) -> Conflict:
        status = ConflictStatus(resolution)
        if status is ConflictStatus.OPEN:
            raise ValueError("conflict resolution cannot be open")
        conflict = next(
            (
                item
                for item in self.storage.list_conflicts(account_id, open_only=False)
                if item.id == conflict_id
            ),
            None,
        )
        if conflict is None:
            raise NotFoundError(f"Conflict {conflict_id} does not exist")
        if conflict.status is not ConflictStatus.OPEN:
            raise ConflictError(f"Conflict {conflict_id} is already resolved")
        if conflict.local_payload.get("kind") == "uncertain-delivery":
            raise ValueError(
                "uncertain delivery requires the explicit retry or delivered reconciliation action"
            )
        payload = (
            conflict.local_payload
            if status is ConflictStatus.KEEP_LOCAL
            else conflict.remote_payload
            if status is ConflictStatus.KEEP_REMOTE
            else merged_payload
        )
        if status is ConflictStatus.MERGED and payload is None:
            raise ValueError("merged conflict resolution requires merged_payload")
        with self.storage.transaction():
            if status in {ConflictStatus.KEEP_LOCAL, ConflictStatus.MERGED}:
                self._enqueue(
                    account_id,
                    conflict.entity_type,
                    conflict.entity_id,
                    MutationOperation.UPDATE,
                    payload or {},
                )
            self.storage.resolve_conflict(account_id, conflict_id, status)
        return replace(conflict, status=status, resolved_at=utc_now())

    def resolve_uncertain_delivery(
        self,
        account_id: str,
        conflict_id: int,
        action: str,
        *,
        remote_id: str | None = None,
    ) -> Conflict:
        conflict = next(
            (
                item
                for item in self.storage.list_conflicts(account_id, open_only=False)
                if item.id == conflict_id
            ),
            None,
        )
        if conflict is None:
            raise NotFoundError(f"Conflict {conflict_id} does not exist")
        if conflict.status is not ConflictStatus.OPEN:
            raise ConflictError(f"Conflict {conflict_id} is already resolved")
        if conflict.local_payload.get("kind") != "uncertain-delivery":
            raise ValueError("conflict is not an uncertain-delivery create")
        mutation = conflict.local_payload.get("mutation")
        if not isinstance(mutation, dict):
            raise ValueError("uncertain-delivery conflict has invalid mutation data")
        operation = MutationOperation(str(mutation.get("operation")))
        entity_type = EntityType(str(mutation.get("entity_type")))
        entity_id = str(mutation.get("entity_id") or "")
        payload = mutation.get("payload")
        if (
            operation not in {MutationOperation.CREATE, MutationOperation.MOVE}
            or not entity_id
            or not isinstance(payload, dict)
        ):
            raise ValueError("uncertain-delivery conflict has invalid local intent")
        normalized = action.casefold()
        if normalized not in {"retry", "delivered"}:
            raise ValueError("action must be retry or delivered")
        if normalized == "delivered" and not remote_id:
            raise ValueError("delivered reconciliation requires --remote-id")

        status = ConflictStatus.KEEP_LOCAL if normalized == "retry" else ConflictStatus.KEEP_REMOTE
        with self.storage.transaction():
            if normalized == "retry":
                self.storage.enqueue(
                    PendingMutation(
                        None,
                        account_id,
                        entity_type,
                        entity_id,
                        operation,
                        payload,
                    )
                )
            else:
                table = {
                    EntityType.TASK_LIST: "task_lists",
                    EntityType.TASK: "tasks",
                    EntityType.CALENDAR: "calendars",
                }.get(entity_type)
                if table is None:
                    raise ValueError("delivered reconciliation is unsupported for this entity")
                cursor = self.storage.connection.execute(
                    f"""UPDATE {table} SET remote_id=?,dirty=0
                    WHERE account_id=? AND id=?""",  # noqa: S608
                    (remote_id, account_id, entity_id),
                )
                if cursor.rowcount != 1:
                    raise NotFoundError(f"{entity_type.value} {entity_id!r} does not exist")
            self.storage.resolve_conflict(account_id, conflict_id, status)
        return replace(conflict, status=status, resolved_at=utc_now())

    def _restore_snapshot(
        self, table: str, account_id: str, entity_id: str, snapshot: Json | None
    ) -> None:
        if snapshot is None:
            self.storage.connection.execute(
                f"DELETE FROM {table} WHERE account_id=? AND id=?",  # noqa: S608
                (account_id, entity_id),
            )
            return
        columns = tuple(snapshot)
        placeholders = ",".join("?" for _ in columns)
        self.storage.connection.execute(
            f"INSERT OR REPLACE INTO {table} ({','.join(columns)}) "  # noqa: S608
            f"VALUES ({placeholders})",
            tuple(snapshot.values()),
        )

    def _intent_change(self, account_id: str, *, redo: bool) -> int | None:
        state, next_state = ("undone", "applied") if redo else ("applied", "undone")
        order = "ASC" if redo else "DESC"
        row = self.storage.connection.execute(
            f"""SELECT * FROM intents WHERE account_id=? AND state=?
            ORDER BY id {order} LIMIT 1""",  # noqa: S608
            (account_id, state),
        ).fetchone()
        if row is None:
            return None
        entity_type = EntityType(row["entity_type"])
        table = {
            EntityType.TASK_LIST: "task_lists",
            EntityType.TASK: "tasks",
            EntityType.CALENDAR: "calendars",
            EntityType.EVENT: "events",
        }[entity_type]
        target_raw = row["after_payload"] if redo else row["before_payload"]
        target = json.loads(target_raw) if target_raw else None
        with self.storage.transaction():
            self._restore_snapshot(table, account_id, row["entity_id"], target)
            self.storage.connection.execute(
                "DELETE FROM outbox WHERE account_id=? AND entity_type=? AND entity_id=?",
                (account_id, entity_type.value, row["entity_id"]),
            )
            operation = (
                MutationOperation.DELETE
                if target is None
                else MutationOperation.CREATE
                if (row["before_payload"] is None and redo)
                else MutationOperation.UPDATE
            )
            # Undoing an unpushed create only cancels that create; there is
            # nothing at Google to delete.
            if not (target is None and row["before_payload"] is None and not redo):
                self._enqueue(
                    account_id,
                    entity_type,
                    row["entity_id"],
                    operation,
                    self._payload_for_snapshot(entity_type, target),
                )
            self.storage.connection.execute(
                "UPDATE intents SET state=? WHERE id=?", (next_state, row["id"])
            )
        return int(row["id"])

    @staticmethod
    def _payload_for_snapshot(entity_type: EntityType, snapshot: Json | None) -> Json:
        if snapshot is None:
            return {}
        remote_id = snapshot.get("remote_id")
        if entity_type is EntityType.TASK_LIST:
            return {"remote_id": remote_id, "body": {"title": snapshot["title"]}}
        if entity_type is EntityType.TASK:
            body: Json = {
                "title": snapshot["title"],
                "status": snapshot["status"],
            }
            if snapshot.get("notes") is not None:
                body["notes"] = snapshot["notes"]
            if snapshot.get("due") is not None:
                body["due"] = snapshot["due"]
            return {
                "remote_id": remote_id,
                "list_id": snapshot["list_id"],
                "body": body,
            }
        if entity_type is EntityType.CALENDAR:
            return {
                "remote_id": remote_id,
                "body": {
                    "summary": snapshot["summary"],
                    "description": snapshot.get("description"),
                    "timeZone": snapshot.get("time_zone"),
                },
            }
        return {
            "remote_id": remote_id,
            "calendar_id": snapshot["calendar_id"],
            "body": {
                "summary": snapshot["summary"],
                "start": {
                    snapshot["start_kind"]: snapshot["start_value"],
                    **(
                        {"timeZone": snapshot["start_time_zone"]}
                        if snapshot.get("start_time_zone")
                        else {}
                    ),
                },
                "end": {
                    snapshot["end_kind"]: snapshot["end_value"],
                    **(
                        {"timeZone": snapshot["end_time_zone"]}
                        if snapshot.get("end_time_zone")
                        else {}
                    ),
                },
            },
        }

    def undo(self, account_id: str) -> int | None:
        return self._intent_change(account_id, redo=False)

    def redo(self, account_id: str) -> int | None:
        return self._intent_change(account_id, redo=True)

    def diagnostics(self) -> Json:
        result = dict(self.storage.diagnostics())
        result["path"] = "<redacted>"
        result["accounts"] = len(self.storage.list_accounts())
        result["saved_searches"] = self.storage.connection.execute(
            "SELECT count(*) FROM saved_searches"
        ).fetchone()[0]
        result["orphaned_links"] = self.storage.connection.execute(
            """SELECT count(*) FROM task_event_links l
            LEFT JOIN tasks t ON t.account_id=l.account_id AND t.id=l.task_id
            LEFT JOIN events e ON e.account_id=l.account_id AND e.id=l.event_id
            WHERE t.id IS NULL OR t.deleted=1 OR e.id IS NULL OR e.deleted=1"""
        ).fetchone()[0]
        return result


Application = ApplicationService
