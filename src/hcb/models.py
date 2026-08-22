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
    DRIVE_FILE = "drive_file"


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
    SUBSCRIBE = "subscribe"
    REMOVE = "remove"


class OutboxDeliveryState(StrEnum):
    PENDING = "pending"
    SENDING = "sending"


class ConflictStatus(StrEnum):
    OPEN = "open"
    KEEP_LOCAL = "keep_local"
    KEEP_REMOTE = "keep_remote"
    MERGED = "merged"


class TaskPriority(StrEnum):
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class NotesProjection(StrEnum):
    DISABLED = "disabled"
    NOTES_ONLY = "notes-only"
    MIRRORED = "mirrored"


NotesProjectionMode = NotesProjection
Priority = TaskPriority


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
    priority: TaskPriority = TaskPriority.NONE
    due_time_zone: str | None = None


@dataclass(frozen=True, slots=True)
class Calendar:
    id: str
    account_id: str
    summary: str
    remote_id: str | None = None
    description: str | None = None
    time_zone: str | None = None
    color: str | None = None
    foreground_color: str | None = None
    location: str | None = None
    summary_override: str | None = None
    hidden: bool = False
    selected: bool = True
    metadata: Metadata = field(default_factory=Metadata)
    default_reminders: tuple[ReminderOverride, ...] = ()
    notification_settings: tuple[dict[str, Any], ...] = ()


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
class ReminderOverride:
    method: str
    minutes: int


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
    derived: bool = False
    metadata: Metadata = field(default_factory=Metadata)
    reminder_use_default: bool = True
    reminder_overrides: tuple[ReminderOverride, ...] = ()
    attendees: tuple[dict[str, Any], ...] = ()
    attendee_response: str | None = None
    event_type: str | None = None
    transparency: str | None = None
    visibility: str | None = None
    color_id: str | None = None
    attachments: tuple[dict[str, Any], ...] = ()
    conference: dict[str, Any] | None = None
    guests_can_invite_others: bool | None = None
    guests_can_modify: bool | None = None
    guests_can_see_other_guests: bool | None = None
    anyone_can_add_self: bool | None = None
    focus_time_properties: dict[str, Any] | None = None
    out_of_office_properties: dict[str, Any] | None = None
    working_location_properties: dict[str, Any] | None = None

    @property
    def is_occurrence(self) -> bool:
        return self.canonical_id is not None or self.occurrence_id is not None


@dataclass(frozen=True, slots=True)
class DriveFile:
    id: str
    account_id: str
    name: str
    mime_type: str | None = None
    web_view_link: str | None = None
    icon_link: str | None = None
    modified_time: datetime | None = None


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
    delivery_state: OutboxDeliveryState = OutboxDeliveryState.PENDING
    request_id: str | None = None
    sending_started_at: datetime | None = None


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
    reminder_catch_up_minutes: int = 60
    reminder_poll_seconds: int = 30
    reminder_jitter_seconds: int = 5
    reminder_sync_interval_minutes: int = 0
    reminder_sync_mode: str = "all"
    time_zone: str = "UTC"

    def __post_init__(self) -> None:
        if not 0 <= self.week_starts_on <= 6:
            raise ValueError("week_starts_on must be between 0 and 6")
        if self.reminder_catch_up_minutes < 0:
            raise ValueError("reminder_catch_up_minutes must be non-negative")
        if self.reminder_poll_seconds < 1:
            raise ValueError("reminder_poll_seconds must be positive")
        if self.reminder_jitter_seconds < 0:
            raise ValueError("reminder_jitter_seconds must be non-negative")
        if self.reminder_sync_interval_minutes < 0:
            raise ValueError("reminder_sync_interval_minutes must be non-negative")
        if self.reminder_sync_mode not in {"all", "pull", "off"}:
            raise ValueError("reminder_sync_mode must be all, pull, or off")
        try:
            from zoneinfo import ZoneInfo

            ZoneInfo(self.time_zone)
        except (ValueError, KeyError) as exc:
            raise ValueError("time_zone must be a valid IANA time zone") from exc
