"""Typed domain models shared by storage, sync, and the user interface."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any


def utc_now() -> datetime:
    return datetime.now(UTC)


class Provider(StrEnum):
    GOOGLE = "google"


class EntityType(StrEnum):
    TASK_LIST = "task_list"
    TASK = "task"
    CALENDAR = "calendar"
    EVENT = "event"


class TaskStatus(StrEnum):
    NEEDS_ACTION = "needsAction"
    COMPLETED = "completed"


class EventStatus(StrEnum):
    CONFIRMED = "confirmed"
    TENTATIVE = "tentative"
    CANCELLED = "cancelled"


class DateTimeKind(StrEnum):
    DATE = "date"
    DATETIME = "dateTime"


class MutationOperation(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    MOVE = "move"
    RESPOND = "respond"


class ConflictStatus(StrEnum):
    OPEN = "open"
    KEEP_LOCAL = "keep_local"
    KEEP_REMOTE = "keep_remote"
    MERGED = "merged"


@dataclass(frozen=True, slots=True)
class Account:
    id: str
    email: str
    display_name: str | None = None
    provider: Provider = Provider.GOOGLE
    enabled: bool = True
    created_at: datetime = field(default_factory=utc_now)


@dataclass(frozen=True, slots=True)
class Metadata:
    etag: str | None = None
    remote_updated_at: datetime | None = None
    local_updated_at: datetime = field(default_factory=utc_now)
    deleted: bool = False
    dirty: bool = False


@dataclass(frozen=True, slots=True)
class TaskList:
    id: str
    account_id: str
    title: str
    remote_id: str | None = None
    position: int = 0
    metadata: Metadata = field(default_factory=Metadata)


@dataclass(frozen=True, slots=True)
class Task:
    id: str
    account_id: str
    list_id: str
    title: str
    notes: str | None = None
    status: TaskStatus = TaskStatus.NEEDS_ACTION
    due: date | None = None
    completed_at: datetime | None = None
    parent_id: str | None = None
    position: str | None = None
    remote_id: str | None = None
    metadata: Metadata = field(default_factory=Metadata)


@dataclass(frozen=True, slots=True)
class Calendar:
    id: str
    account_id: str
    summary: str
    remote_id: str | None = None
    description: str | None = None
    time_zone: str | None = None
    color: str | None = None
    selected: bool = True
    metadata: Metadata = field(default_factory=Metadata)


@dataclass(frozen=True, slots=True)
class EventDateTime:
    kind: DateTimeKind
    value: date | datetime
    time_zone: str | None = None

    def __post_init__(self) -> None:
        if self.kind is DateTimeKind.DATE and isinstance(self.value, datetime):
            raise ValueError("DATE values must be date-only")
        if self.kind is DateTimeKind.DATETIME and not isinstance(self.value, datetime):
            raise ValueError("DATETIME values must be datetime instances")


@dataclass(frozen=True, slots=True)
class Event:
    id: str
    account_id: str
    calendar_id: str
    summary: str
    start: EventDateTime
    end: EventDateTime
    remote_id: str | None = None
    canonical_id: str | None = None
    occurrence_id: str | None = None
    description: str | None = None
    location: str | None = None
    status: EventStatus = EventStatus.CONFIRMED
    recurrence: tuple[str, ...] = ()
    metadata: Metadata = field(default_factory=Metadata)

    @property
    def is_occurrence(self) -> bool:
        return self.canonical_id is not None or self.occurrence_id is not None


@dataclass(frozen=True, slots=True)
class PendingMutation:
    id: int | None
    account_id: str
    entity_type: EntityType
    entity_id: str
    operation: MutationOperation
    payload: dict[str, Any]
    created_at: datetime = field(default_factory=utc_now)
    attempts: int = 0
    last_error: str | None = None


@dataclass(frozen=True, slots=True)
class SyncCursor:
    account_id: str
    scope: str
    cursor: str | None
    updated_at: datetime = field(default_factory=utc_now)


@dataclass(frozen=True, slots=True)
class SyncCheckpoint:
    account_id: str
    scope: str
    started_at: datetime
    completed_at: datetime | None = None
    cursor: str | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class Conflict:
    id: int | None
    account_id: str
    entity_type: EntityType
    entity_id: str
    local_payload: dict[str, Any]
    remote_payload: dict[str, Any]
    status: ConflictStatus = ConflictStatus.OPEN
    created_at: datetime = field(default_factory=utc_now)
    resolved_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class Preferences:
    theme: str = "system"
    keymap: str = "default"
    week_starts_on: int = 0
    default_account_id: str | None = None
    default_task_list_id: str | None = None
    default_calendar_id: str | None = None
    reminders_enabled: bool = True

    def __post_init__(self) -> None:
        if not 0 <= self.week_starts_on <= 6:
            raise ValueError("week_starts_on must be between 0 and 6")
