"""Local SQLite persistence and sync bookkeeping."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Any

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
    PendingMutation,
    Provider,
    ReminderOverride,
    SyncCursor,
    Task,
    TaskList,
    TaskPriority,
    TaskStatus,
    utc_now,
)
from .paths import AppPaths

SCHEMA_VERSION = 4

_SCHEMA = """
CREATE TABLE accounts (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT, provider TEXT NOT NULL,
    enabled INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE task_lists (
    id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title TEXT NOT NULL, remote_id TEXT, position INTEGER NOT NULL DEFAULT 0,
    etag TEXT, remote_updated_at TEXT, local_updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, id), UNIQUE (account_id, remote_id)
);
CREATE TABLE tasks (
    id TEXT NOT NULL, account_id TEXT NOT NULL, list_id TEXT NOT NULL, title TEXT NOT NULL,
    notes TEXT, status TEXT NOT NULL, due TEXT, completed_at TEXT, parent_id TEXT,
    position TEXT, remote_id TEXT, etag TEXT, remote_updated_at TEXT,
    local_updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    dirty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, list_id) REFERENCES task_lists(account_id, id) ON DELETE CASCADE,
    UNIQUE (account_id, remote_id)
);
CREATE TABLE calendars (
    id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    summary TEXT NOT NULL, remote_id TEXT, description TEXT, time_zone TEXT, color TEXT,
    selected INTEGER NOT NULL DEFAULT 1, etag TEXT, remote_updated_at TEXT,
    local_updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    dirty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, id),
    UNIQUE (account_id, remote_id)
);
CREATE TABLE events (
    id TEXT NOT NULL, account_id TEXT NOT NULL, calendar_id TEXT NOT NULL,
    summary TEXT NOT NULL, start_kind TEXT NOT NULL, start_value TEXT NOT NULL,
    start_time_zone TEXT, end_kind TEXT NOT NULL, end_value TEXT NOT NULL,
    end_time_zone TEXT, remote_id TEXT, canonical_id TEXT, occurrence_id TEXT,
    description TEXT, location TEXT, status TEXT NOT NULL, recurrence TEXT NOT NULL DEFAULT '[]',
    etag TEXT, remote_updated_at TEXT, local_updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, id),
    FOREIGN KEY (account_id, calendar_id) REFERENCES calendars(account_id, id) ON DELETE CASCADE,
    UNIQUE (account_id, remote_id, occurrence_id)
);
CREATE INDEX events_range ON events(account_id, start_value, end_value);
CREATE INDEX events_canonical ON events(account_id, canonical_id, occurrence_id);
CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES accounts(id)
      ON DELETE CASCADE, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    operation TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE INDEX outbox_account ON outbox(account_id, id);
CREATE TABLE sync_cursors (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, scope TEXT NOT NULL,
    cursor TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(account_id, scope)
);
CREATE TABLE sync_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, scope TEXT NOT NULL,
    started_at TEXT NOT NULL, completed_at TEXT, cursor TEXT, error TEXT
);
CREATE TABLE conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES accounts(id)
      ON DELETE CASCADE, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    local_payload TEXT NOT NULL, remote_payload TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE reminder_state (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL, occurrence_id TEXT NOT NULL DEFAULT '',
    remind_at TEXT NOT NULL, notified_at TEXT, dismissed_at TEXT,
    PRIMARY KEY(account_id, event_id, occurrence_id, remind_at)
);
"""

_MIGRATION_2 = """
ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tasks ADD COLUMN due_time_zone TEXT;
CREATE TABLE saved_searches (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, query TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(account_id, name)
);
CREATE TABLE task_event_links (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL, event_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(account_id, task_id, event_id)
);
CREATE TABLE intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    before_payload TEXT, after_payload TEXT, state TEXT NOT NULL DEFAULT 'applied',
    created_at TEXT NOT NULL
);
CREATE INDEX intents_account_state ON intents(account_id, state, id);
CREATE TABLE app_settings (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(account_id, key)
);
"""

_MIGRATION_3 = """
ALTER TABLE calendars ADD COLUMN default_reminders TEXT NOT NULL DEFAULT '[]';
ALTER TABLE events ADD COLUMN reminder_use_default INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN reminder_overrides TEXT NOT NULL DEFAULT '[]';
ALTER TABLE events ADD COLUMN attendees TEXT NOT NULL DEFAULT '[]';
ALTER TABLE events ADD COLUMN attendee_response TEXT;
ALTER TABLE events ADD COLUMN event_type TEXT;
ALTER TABLE events ADD COLUMN transparency TEXT;
ALTER TABLE events ADD COLUMN visibility TEXT;
ALTER TABLE events ADD COLUMN color_id TEXT;
ALTER TABLE events ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
ALTER TABLE events ADD COLUMN conference TEXT;
CREATE TABLE reminder_deliveries (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL, source_id TEXT NOT NULL, occurrence_id TEXT NOT NULL DEFAULT '',
    scheduled_at TEXT NOT NULL, delivered_at TEXT, dismissed_at TEXT, snoozed_until TEXT,
    last_error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(account_id, source_type, source_id, occurrence_id, scheduled_at)
);
CREATE INDEX reminder_deliveries_due
ON reminder_deliveries(account_id, scheduled_at, delivered_at, dismissed_at);
"""

_MIGRATION_4 = """
ALTER TABLE events ADD COLUMN guests_can_invite_others INTEGER;
ALTER TABLE events ADD COLUMN guests_can_modify INTEGER;
ALTER TABLE events ADD COLUMN guests_can_see_other_guests INTEGER;
ALTER TABLE events ADD COLUMN anyone_can_add_self INTEGER;
ALTER TABLE events ADD COLUMN focus_time_properties TEXT;
ALTER TABLE events ADD COLUMN out_of_office_properties TEXT;
ALTER TABLE events ADD COLUMN working_location_properties TEXT;
DELETE FROM task_event_links
WHERE rowid NOT IN (
    SELECT MAX(rowid) FROM task_event_links GROUP BY account_id,task_id
);
CREATE UNIQUE INDEX one_active_task_block
ON task_event_links(account_id, task_id);
CREATE TABLE drive_files (
    id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, mime_type TEXT, web_view_link TEXT, icon_link TEXT,
    modified_time TEXT, PRIMARY KEY(account_id,id)
);
"""


def _iso(value: date | datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _metadata(row: sqlite3.Row) -> Metadata:
    return Metadata(
        etag=row["etag"],
        remote_updated_at=_datetime(row["remote_updated_at"]),
        local_updated_at=datetime.fromisoformat(row["local_updated_at"]),
        deleted=bool(row["deleted"]),
        dirty=bool(row["dirty"]),
    )


class Storage:
    """A single local database. Public entity methods always require an account id."""

    def __init__(self, path: Path | str | None = None) -> None:
        target = Path(path) if path is not None else AppPaths.discover().database_file
        target.parent.mkdir(parents=True, exist_ok=True)
        self.path = target
        self.connection = sqlite3.connect(target, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA busy_timeout = 5000")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self._migrate()

    def _migrate(self) -> None:
        version = int(self.connection.execute("PRAGMA user_version").fetchone()[0])
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"database schema {version} is newer than supported {SCHEMA_VERSION}"
            )
        if version == 0:
            with self.transaction():
                self.connection.executescript(_SCHEMA)
                self.connection.execute("PRAGMA user_version = 1")
            version = 1
        if version == 1:
            with self.transaction():
                self.connection.executescript(_MIGRATION_2)
                self.connection.execute("PRAGMA user_version = 2")
            version = 2
        if version == 2:
            with self.transaction():
                self.connection.executescript(_MIGRATION_3)
                self.connection.execute("PRAGMA user_version = 3")
            version = 3
        if version == 3:
            with self.transaction():
                self.connection.executescript(_MIGRATION_4)
                self.connection.execute("PRAGMA user_version = 4")

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> Storage:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        if self.connection.in_transaction:
            name = f"hcb_{id(object())}"
            self.connection.execute(f"SAVEPOINT {name}")
            try:
                yield self.connection
            except BaseException:
                self.connection.execute(f"ROLLBACK TO {name}")
                self.connection.execute(f"RELEASE {name}")
                raise
            else:
                self.connection.execute(f"RELEASE {name}")
            return
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            yield self.connection
        except BaseException:
            self.connection.rollback()
            raise
        else:
            self.connection.commit()

    def upsert_account(self, account: Account) -> None:
        self.connection.execute(
            """INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET email=excluded.email,
            display_name=excluded.display_name, provider=excluded.provider,
            enabled=excluded.enabled""",
            (
                account.id,
                account.email,
                account.display_name,
                account.provider.value,
                account.enabled,
                _iso(account.created_at),
            ),
        )

    def get_account(self, account_id: str) -> Account | None:
        row = self.connection.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
        return (
            Account(
                id=row["id"],
                email=row["email"],
                display_name=row["display_name"],
                provider=Provider(row["provider"]),
                enabled=bool(row["enabled"]),
                created_at=datetime.fromisoformat(row["created_at"]),
            )
            if row
            else None
        )

    def list_accounts(self) -> list[Account]:
        return [
            account
            for row in self.connection.execute("SELECT id FROM accounts ORDER BY email")
            if (account := self.get_account(row["id"])) is not None
        ]

    def delete_account(self, account_id: str) -> None:
        self.connection.execute("DELETE FROM accounts WHERE id=?", (account_id,))

    @staticmethod
    def _meta_values(metadata: Metadata) -> tuple[Any, ...]:
        return (
            metadata.etag,
            _iso(metadata.remote_updated_at),
            _iso(metadata.local_updated_at),
            metadata.deleted,
            metadata.dirty,
        )

    def upsert_task_list(self, item: TaskList) -> None:
        self.connection.execute(
            """INSERT INTO task_lists VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id,id) DO UPDATE SET title=excluded.title,
            remote_id=excluded.remote_id, position=excluded.position, etag=excluded.etag,
            remote_updated_at=excluded.remote_updated_at,
            local_updated_at=excluded.local_updated_at, deleted=excluded.deleted,
            dirty=excluded.dirty""",
            (
                item.id,
                item.account_id,
                item.title,
                item.remote_id,
                item.position,
                *self._meta_values(item.metadata),
            ),
        )

    def _task_list(self, row: sqlite3.Row) -> TaskList:
        return TaskList(
            row["id"],
            row["account_id"],
            row["title"],
            row["remote_id"],
            row["position"],
            _metadata(row),
        )

    def get_task_list(self, account_id: str, list_id: str) -> TaskList | None:
        row = self.connection.execute(
            "SELECT * FROM task_lists WHERE account_id=? AND id=?", (account_id, list_id)
        ).fetchone()
        return self._task_list(row) if row else None

    def get_task_list_by_remote(self, account_id: str, remote_id: str) -> TaskList | None:
        row = self.connection.execute(
            "SELECT * FROM task_lists WHERE account_id=? AND remote_id=?",
            (account_id, remote_id),
        ).fetchone()
        return self._task_list(row) if row else None

    def list_task_lists(self, account_id: str, *, include_deleted: bool = False) -> list[TaskList]:
        sql = "SELECT * FROM task_lists WHERE account_id=?"
        if not include_deleted:
            sql += " AND deleted=0"
        sql += " ORDER BY position,title"
        return [self._task_list(row) for row in self.connection.execute(sql, (account_id,))]

    def delete_task_list(self, account_id: str, list_id: str) -> None:
        self.connection.execute(
            "DELETE FROM task_lists WHERE account_id=? AND id=?", (account_id, list_id)
        )

    def upsert_task(self, task: Task) -> None:
        self.connection.execute(
            """INSERT INTO tasks(
                id,account_id,list_id,title,notes,status,due,completed_at,parent_id,
                position,remote_id,etag,remote_updated_at,local_updated_at,deleted,dirty,
                priority,due_time_zone
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(account_id,id) DO UPDATE SET list_id=excluded.list_id,
            title=excluded.title, notes=excluded.notes, status=excluded.status,
            due=excluded.due, completed_at=excluded.completed_at,
            parent_id=excluded.parent_id, position=excluded.position,
            remote_id=excluded.remote_id, etag=excluded.etag,
            remote_updated_at=excluded.remote_updated_at,
            local_updated_at=excluded.local_updated_at, deleted=excluded.deleted,
            dirty=excluded.dirty, priority=excluded.priority,
            due_time_zone=excluded.due_time_zone""",
            (
                task.id,
                task.account_id,
                task.list_id,
                task.title,
                task.notes,
                task.status.value,
                _iso(task.due),
                _iso(task.completed_at),
                task.parent_id,
                task.position,
                task.remote_id,
                *self._meta_values(task.metadata),
                task.priority.value,
                task.due_time_zone,
            ),
        )

    def _task(self, row: sqlite3.Row) -> Task:
        return Task(
            id=row["id"],
            account_id=row["account_id"],
            list_id=row["list_id"],
            title=row["title"],
            notes=row["notes"],
            status=TaskStatus(row["status"]),
            due=date.fromisoformat(row["due"]) if row["due"] else None,
            completed_at=_datetime(row["completed_at"]),
            parent_id=row["parent_id"],
            position=row["position"],
            remote_id=row["remote_id"],
            metadata=_metadata(row),
            priority=TaskPriority(row["priority"]),
            due_time_zone=row["due_time_zone"],
        )

    def get_task(self, account_id: str, task_id: str) -> Task | None:
        row = self.connection.execute(
            "SELECT * FROM tasks WHERE account_id=? AND id=?", (account_id, task_id)
        ).fetchone()
        return self._task(row) if row else None

    def get_task_by_remote(self, account_id: str, remote_id: str) -> Task | None:
        row = self.connection.execute(
            "SELECT * FROM tasks WHERE account_id=? AND remote_id=?", (account_id, remote_id)
        ).fetchone()
        return self._task(row) if row else None

    def list_tasks(
        self, account_id: str, list_id: str | None = None, *, include_deleted: bool = False
    ) -> list[Task]:
        sql, args = "SELECT * FROM tasks WHERE account_id=?", [account_id]
        if list_id is not None:
            sql, args = sql + " AND list_id=?", [*args, list_id]
        if not include_deleted:
            sql += " AND deleted=0"
        sql += " ORDER BY status,due,title"
        return [self._task(row) for row in self.connection.execute(sql, args)]

    def search_tasks(self, account_id: str, query: str, *, limit: int = 50) -> list[Task]:
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = self.connection.execute(
            """SELECT * FROM tasks WHERE account_id=? AND deleted=0
            AND (title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')
            ORDER BY status,due,title LIMIT ?""",
            (account_id, f"%{escaped}%", f"%{escaped}%", limit),
        )
        return [self._task(row) for row in rows]

    def delete_task(self, account_id: str, task_id: str) -> None:
        self.connection.execute(
            "DELETE FROM tasks WHERE account_id=? AND id=?", (account_id, task_id)
        )

    def upsert_calendar(self, calendar: Calendar) -> None:
        self.connection.execute(
            """INSERT INTO calendars(
                id,account_id,summary,remote_id,description,time_zone,color,selected,
                etag,remote_updated_at,local_updated_at,deleted,dirty,default_reminders
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(account_id,id) DO UPDATE SET summary=excluded.summary,
            remote_id=excluded.remote_id, description=excluded.description,
            time_zone=excluded.time_zone, color=excluded.color, selected=excluded.selected,
            etag=excluded.etag, remote_updated_at=excluded.remote_updated_at,
            local_updated_at=excluded.local_updated_at, deleted=excluded.deleted,
            dirty=excluded.dirty,default_reminders=excluded.default_reminders""",
            (
                calendar.id,
                calendar.account_id,
                calendar.summary,
                calendar.remote_id,
                calendar.description,
                calendar.time_zone,
                calendar.color,
                calendar.selected,
                *self._meta_values(calendar.metadata),
                json.dumps(
                    [{"method": item.method, "minutes": item.minutes}
                     for item in calendar.default_reminders]
                ),
            ),
        )

    def _calendar(self, row: sqlite3.Row) -> Calendar:
        return Calendar(
            id=row["id"],
            account_id=row["account_id"],
            summary=row["summary"],
            remote_id=row["remote_id"],
            description=row["description"],
            time_zone=row["time_zone"],
            color=row["color"],
            selected=bool(row["selected"]),
            metadata=_metadata(row),
            default_reminders=tuple(
                ReminderOverride(str(item["method"]), int(item["minutes"]))
                for item in json.loads(row["default_reminders"])
            ),
        )

    def get_calendar(self, account_id: str, calendar_id: str) -> Calendar | None:
        row = self.connection.execute(
            "SELECT * FROM calendars WHERE account_id=? AND id=?", (account_id, calendar_id)
        ).fetchone()
        return self._calendar(row) if row else None

    def get_calendar_by_remote(self, account_id: str, remote_id: str) -> Calendar | None:
        row = self.connection.execute(
            "SELECT * FROM calendars WHERE account_id=? AND remote_id=?",
            (account_id, remote_id),
        ).fetchone()
        return self._calendar(row) if row else None

    def list_calendars(self, account_id: str, *, include_deleted: bool = False) -> list[Calendar]:
        sql = "SELECT * FROM calendars WHERE account_id=?"
        if not include_deleted:
            sql += " AND deleted=0"
        return [
            self._calendar(row)
            for row in self.connection.execute(sql + " ORDER BY summary", (account_id,))
        ]

    def delete_calendar(self, account_id: str, calendar_id: str) -> None:
        self.connection.execute(
            "DELETE FROM calendars WHERE account_id=? AND id=?", (account_id, calendar_id)
        )

    def upsert_event(self, event: Event) -> None:
        self.connection.execute(
            """INSERT INTO events(
                id,account_id,calendar_id,summary,start_kind,start_value,start_time_zone,
                end_kind,end_value,end_time_zone,remote_id,canonical_id,occurrence_id,
                description,location,status,recurrence,etag,remote_updated_at,local_updated_at,
                deleted,dirty,reminder_use_default,reminder_overrides,attendees,
                attendee_response,event_type,transparency,visibility,color_id,attachments,conference
                ,guests_can_invite_others,guests_can_modify,guests_can_see_other_guests,
                anyone_can_add_self,focus_time_properties,out_of_office_properties,
                working_location_properties
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(account_id,id) DO UPDATE SET calendar_id=excluded.calendar_id,
            summary=excluded.summary, start_kind=excluded.start_kind,
            start_value=excluded.start_value, start_time_zone=excluded.start_time_zone,
            end_kind=excluded.end_kind, end_value=excluded.end_value,
            end_time_zone=excluded.end_time_zone, remote_id=excluded.remote_id,
            canonical_id=excluded.canonical_id, occurrence_id=excluded.occurrence_id,
            description=excluded.description, location=excluded.location,
            status=excluded.status, recurrence=excluded.recurrence, etag=excluded.etag,
            remote_updated_at=excluded.remote_updated_at,
            local_updated_at=excluded.local_updated_at, deleted=excluded.deleted,
            dirty=excluded.dirty,reminder_use_default=excluded.reminder_use_default,
            reminder_overrides=excluded.reminder_overrides,attendees=excluded.attendees,
            attendee_response=excluded.attendee_response,event_type=excluded.event_type,
            transparency=excluded.transparency,visibility=excluded.visibility,
            color_id=excluded.color_id,attachments=excluded.attachments,
            conference=excluded.conference,
            guests_can_invite_others=excluded.guests_can_invite_others,
            guests_can_modify=excluded.guests_can_modify,
            guests_can_see_other_guests=excluded.guests_can_see_other_guests,
            anyone_can_add_self=excluded.anyone_can_add_self,
            focus_time_properties=excluded.focus_time_properties,
            out_of_office_properties=excluded.out_of_office_properties,
            working_location_properties=excluded.working_location_properties""",
            (
                event.id,
                event.account_id,
                event.calendar_id,
                event.summary,
                event.start.kind.value,
                _iso(event.start.value),
                event.start.time_zone,
                event.end.kind.value,
                _iso(event.end.value),
                event.end.time_zone,
                event.remote_id,
                event.canonical_id,
                event.occurrence_id,
                event.description,
                event.location,
                event.status.value,
                json.dumps(event.recurrence),
                *self._meta_values(event.metadata),
                event.reminder_use_default,
                json.dumps(
                    [{"method": item.method, "minutes": item.minutes}
                     for item in event.reminder_overrides]
                ),
                json.dumps(event.attendees),
                event.attendee_response,
                event.event_type,
                event.transparency,
                event.visibility,
                event.color_id,
                json.dumps(event.attachments),
                json.dumps(event.conference) if event.conference is not None else None,
                event.guests_can_invite_others,
                event.guests_can_modify,
                event.guests_can_see_other_guests,
                event.anyone_can_add_self,
                json.dumps(event.focus_time_properties)
                if event.focus_time_properties is not None else None,
                json.dumps(event.out_of_office_properties)
                if event.out_of_office_properties is not None else None,
                json.dumps(event.working_location_properties)
                if event.working_location_properties is not None else None,
            ),
        )

    @staticmethod
    def _event_time(kind: str, value: str, zone: str | None) -> EventDateTime:
        parsed: date | datetime
        parsed = (
            datetime.fromisoformat(value)
            if kind == DateTimeKind.DATETIME
            else date.fromisoformat(value)
        )
        return EventDateTime(DateTimeKind(kind), parsed, zone)

    def _event(self, row: sqlite3.Row) -> Event:
        return Event(
            id=row["id"],
            account_id=row["account_id"],
            calendar_id=row["calendar_id"],
            summary=row["summary"],
            start=self._event_time(row["start_kind"], row["start_value"], row["start_time_zone"]),
            end=self._event_time(row["end_kind"], row["end_value"], row["end_time_zone"]),
            remote_id=row["remote_id"],
            canonical_id=row["canonical_id"],
            occurrence_id=row["occurrence_id"],
            description=row["description"],
            location=row["location"],
            status=EventStatus(row["status"]),
            recurrence=tuple(json.loads(row["recurrence"])),
            metadata=_metadata(row),
            reminder_use_default=bool(row["reminder_use_default"]),
            reminder_overrides=tuple(
                ReminderOverride(str(item["method"]), int(item["minutes"]))
                for item in json.loads(row["reminder_overrides"])
            ),
            attendees=tuple(json.loads(row["attendees"])),
            attendee_response=row["attendee_response"],
            event_type=row["event_type"],
            transparency=row["transparency"],
            visibility=row["visibility"],
            color_id=row["color_id"],
            attachments=tuple(json.loads(row["attachments"])),
            conference=json.loads(row["conference"]) if row["conference"] else None,
            guests_can_invite_others=(
                bool(row["guests_can_invite_others"])
                if row["guests_can_invite_others"] is not None else None
            ),
            guests_can_modify=(
                bool(row["guests_can_modify"]) if row["guests_can_modify"] is not None else None
            ),
            guests_can_see_other_guests=(
                bool(row["guests_can_see_other_guests"])
                if row["guests_can_see_other_guests"] is not None else None
            ),
            anyone_can_add_self=(
                bool(row["anyone_can_add_self"]) if row["anyone_can_add_self"] is not None else None
            ),
            focus_time_properties=(
                json.loads(row["focus_time_properties"]) if row["focus_time_properties"] else None
            ),
            out_of_office_properties=(
                json.loads(row["out_of_office_properties"])
                if row["out_of_office_properties"] else None
            ),
            working_location_properties=(
                json.loads(row["working_location_properties"])
                if row["working_location_properties"] else None
            ),
        )

    def get_event(self, account_id: str, event_id: str) -> Event | None:
        row = self.connection.execute(
            "SELECT * FROM events WHERE account_id=? AND id=?", (account_id, event_id)
        ).fetchone()
        return self._event(row) if row else None

    def get_event_by_remote(
        self, account_id: str, remote_id: str, *, occurrence_id: str | None = None
    ) -> Event | None:
        sql = "SELECT * FROM events WHERE account_id=? AND remote_id=?"
        args: list[Any] = [account_id, remote_id]
        if occurrence_id is None:
            sql += " AND occurrence_id IS NULL"
        else:
            sql, args = sql + " AND occurrence_id=?", [*args, occurrence_id]
        row = self.connection.execute(sql, args).fetchone()
        return self._event(row) if row else None

    def list_events(
        self,
        account_id: str,
        calendar_id: str | None = None,
        *,
        start: date | datetime | None = None,
        end: date | datetime | None = None,
        include_deleted: bool = False,
    ) -> list[Event]:
        sql = "SELECT * FROM events WHERE account_id=?"
        args: list[Any] = [account_id]
        if calendar_id is not None:
            sql, args = sql + " AND calendar_id=?", [*args, calendar_id]
        if start is not None:
            sql, args = sql + " AND end_value>?", [*args, _iso(start)]
        if end is not None:
            sql, args = sql + " AND start_value<?", [*args, _iso(end)]
        if not include_deleted:
            sql += " AND deleted=0"
        return [
            self._event(row) for row in self.connection.execute(sql + " ORDER BY start_value", args)
        ]

    def search_events(self, account_id: str, query: str, *, limit: int = 50) -> list[Event]:
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = self.connection.execute(
            """SELECT * FROM events WHERE account_id=? AND deleted=0
            AND (summary LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
                 OR location LIKE ? ESCAPE '\\') ORDER BY start_value LIMIT ?""",
            (account_id, *(f"%{escaped}%" for _ in range(3)), limit),
        )
        return [self._event(row) for row in rows]

    def delete_event(self, account_id: str, event_id: str) -> None:
        self.connection.execute(
            "DELETE FROM events WHERE account_id=? AND id=?", (account_id, event_id)
        )

    def upsert_drive_file(self, item: DriveFile) -> None:
        self.connection.execute(
            """INSERT INTO drive_files VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(account_id,id) DO UPDATE SET name=excluded.name,
            mime_type=excluded.mime_type,web_view_link=excluded.web_view_link,
            icon_link=excluded.icon_link,modified_time=excluded.modified_time""",
            (
                item.id, item.account_id, item.name, item.mime_type, item.web_view_link,
                item.icon_link, _iso(item.modified_time),
            ),
        )

    def list_drive_files(self, account_id: str) -> list[DriveFile]:
        return [
            DriveFile(
                row["id"], row["account_id"], row["name"], row["mime_type"],
                row["web_view_link"], row["icon_link"], _datetime(row["modified_time"]),
            )
            for row in self.connection.execute(
                "SELECT * FROM drive_files WHERE account_id=? ORDER BY name", (account_id,)
            )
        ]

    def enqueue(self, mutation: PendingMutation) -> int:
        cursor = self.connection.execute(
            """INSERT INTO outbox(account_id,entity_type,entity_id,operation,payload,created_at,
            attempts,last_error) VALUES (?,?,?,?,?,?,?,?)""",
            (
                mutation.account_id,
                mutation.entity_type.value,
                mutation.entity_id,
                mutation.operation.value,
                json.dumps(mutation.payload, separators=(",", ":"), sort_keys=True),
                _iso(mutation.created_at),
                mutation.attempts,
                mutation.last_error,
            ),
        )
        if cursor.lastrowid is None:
            raise RuntimeError("SQLite did not return an outbox id")
        return cursor.lastrowid

    def pending_mutations(self, account_id: str, *, limit: int = 100) -> list[PendingMutation]:
        rows = self.connection.execute(
            "SELECT * FROM outbox WHERE account_id=? ORDER BY id LIMIT ?", (account_id, limit)
        )
        return [
            PendingMutation(
                row["id"],
                row["account_id"],
                EntityType(row["entity_type"]),
                row["entity_id"],
                MutationOperation(row["operation"]),
                json.loads(row["payload"]),
                datetime.fromisoformat(row["created_at"]),
                row["attempts"],
                row["last_error"],
            )
            for row in rows
        ]

    def complete_mutation(self, account_id: str, mutation_id: int) -> None:
        self.connection.execute(
            "DELETE FROM outbox WHERE account_id=? AND id=?", (account_id, mutation_id)
        )

    def fail_mutation(self, account_id: str, mutation_id: int, error: str) -> None:
        self.connection.execute(
            """UPDATE outbox SET attempts=attempts+1,last_error=?
            WHERE account_id=? AND id=?""",
            (error, account_id, mutation_id),
        )

    def set_cursor(self, cursor: SyncCursor) -> None:
        self.connection.execute(
            """INSERT INTO sync_cursors VALUES (?,?,?,?) ON CONFLICT(account_id,scope)
            DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at""",
            (cursor.account_id, cursor.scope, cursor.cursor, _iso(cursor.updated_at)),
        )

    def get_cursor(self, account_id: str, scope: str) -> SyncCursor | None:
        row = self.connection.execute(
            "SELECT * FROM sync_cursors WHERE account_id=? AND scope=?", (account_id, scope)
        ).fetchone()
        return (
            SyncCursor(
                row["account_id"],
                row["scope"],
                row["cursor"],
                datetime.fromisoformat(row["updated_at"]),
            )
            if row
            else None
        )

    def delete_cursor(self, account_id: str, scope: str) -> None:
        self.connection.execute(
            "DELETE FROM sync_cursors WHERE account_id=? AND scope=?", (account_id, scope)
        )

    def start_checkpoint(self, account_id: str, scope: str) -> int:
        cursor = self.connection.execute(
            "INSERT INTO sync_checkpoints(account_id,scope,started_at) VALUES (?,?,?)",
            (account_id, scope, _iso(utc_now())),
        )
        if cursor.lastrowid is None:
            raise RuntimeError("SQLite did not return a checkpoint id")
        return cursor.lastrowid

    def finish_checkpoint(
        self, checkpoint_id: int, *, cursor: str | None = None, error: str | None = None
    ) -> None:
        self.connection.execute(
            "UPDATE sync_checkpoints SET completed_at=?,cursor=?,error=? WHERE id=?",
            (_iso(utc_now()), cursor, error, checkpoint_id),
        )

    def resumable_checkpoint(self, account_id: str, scope: str) -> tuple[int, str | None] | None:
        row = self.connection.execute(
            """SELECT id,cursor FROM sync_checkpoints
            WHERE account_id=? AND scope=? AND completed_at IS NULL
            ORDER BY id DESC LIMIT 1""",
            (account_id, scope),
        ).fetchone()
        return (row["id"], row["cursor"]) if row else None

    def save_checkpoint_page(self, checkpoint_id: int, page_token: str | None) -> None:
        self.connection.execute(
            "UPDATE sync_checkpoints SET cursor=?,error=NULL WHERE id=?",
            (page_token, checkpoint_id),
        )

    def add_conflict(self, conflict: Conflict) -> int:
        cursor = self.connection.execute(
            """INSERT INTO conflicts(account_id,entity_type,entity_id,local_payload,
            remote_payload,status,created_at,resolved_at) VALUES (?,?,?,?,?,?,?,?)""",
            (
                conflict.account_id,
                conflict.entity_type.value,
                conflict.entity_id,
                json.dumps(conflict.local_payload, sort_keys=True),
                json.dumps(conflict.remote_payload, sort_keys=True),
                conflict.status.value,
                _iso(conflict.created_at),
                _iso(conflict.resolved_at),
            ),
        )
        if cursor.lastrowid is None:
            raise RuntimeError("SQLite did not return a conflict id")
        return cursor.lastrowid

    def list_conflicts(self, account_id: str, *, open_only: bool = True) -> list[Conflict]:
        sql, args = "SELECT * FROM conflicts WHERE account_id=?", [account_id]
        if open_only:
            sql, args = sql + " AND status=?", [*args, ConflictStatus.OPEN.value]
        return [
            Conflict(
                row["id"],
                row["account_id"],
                EntityType(row["entity_type"]),
                row["entity_id"],
                json.loads(row["local_payload"]),
                json.loads(row["remote_payload"]),
                ConflictStatus(row["status"]),
                datetime.fromisoformat(row["created_at"]),
                _datetime(row["resolved_at"]),
            )
            for row in self.connection.execute(sql + " ORDER BY id", args)
        ]

    def resolve_conflict(self, account_id: str, conflict_id: int, status: ConflictStatus) -> None:
        if status is ConflictStatus.OPEN:
            raise ValueError("resolution status cannot be open")
        self.connection.execute(
            "UPDATE conflicts SET status=?,resolved_at=? WHERE account_id=? AND id=?",
            (status.value, _iso(utc_now()), account_id, conflict_id),
        )

    def set_reminder(
        self,
        account_id: str,
        event_id: str,
        remind_at: datetime,
        *,
        occurrence_id: str | None = None,
        notified_at: datetime | None = None,
        dismissed_at: datetime | None = None,
    ) -> None:
        self.connection.execute(
            """INSERT INTO reminder_state VALUES (?,?,?,?,?,?) ON CONFLICT DO UPDATE SET
            notified_at=excluded.notified_at,dismissed_at=excluded.dismissed_at""",
            (
                account_id,
                event_id,
                occurrence_id or "",
                _iso(remind_at),
                _iso(notified_at),
                _iso(dismissed_at),
            ),
        )

    def due_reminders(self, account_id: str, now: datetime) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """SELECT * FROM reminder_state WHERE account_id=? AND remind_at<=?
            AND notified_at IS NULL AND dismissed_at IS NULL ORDER BY remind_at""",
            (account_id, _iso(now)),
        )
        return [dict(row) for row in rows]

    def ensure_reminder_delivery(
        self,
        account_id: str,
        source_type: str,
        source_id: str,
        scheduled_at: datetime,
        *,
        occurrence_id: str | None = None,
    ) -> None:
        self.connection.execute(
            """INSERT OR IGNORE INTO reminder_deliveries(
                account_id,source_type,source_id,occurrence_id,scheduled_at
            ) VALUES (?,?,?,?,?)""",
            (account_id, source_type, source_id, occurrence_id or "", _iso(scheduled_at)),
        )

    def due_reminder_deliveries(
        self, account_id: str, now: datetime, earliest: datetime
    ) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """SELECT * FROM reminder_deliveries
            WHERE account_id=? AND delivered_at IS NULL AND dismissed_at IS NULL
            AND (scheduled_at>=? OR snoozed_until IS NOT NULL) AND scheduled_at<=?
            AND (snoozed_until IS NULL OR snoozed_until<=?)
            ORDER BY COALESCE(snoozed_until,scheduled_at)""",
            (account_id, _iso(earliest), _iso(now), _iso(now)),
        )
        return [dict(row) for row in rows]

    def update_reminder_delivery(
        self,
        row: dict[str, Any],
        *,
        delivered_at: datetime | None = None,
        dismissed_at: datetime | None = None,
        snoozed_until: datetime | None = None,
        error: str | None = None,
    ) -> None:
        self.connection.execute(
            """UPDATE reminder_deliveries SET delivered_at=?,dismissed_at=?,
            snoozed_until=?,last_error=?,attempts=attempts+1
            WHERE account_id=? AND source_type=? AND source_id=?
            AND occurrence_id=? AND scheduled_at=?""",
            (
                _iso(delivered_at),
                _iso(dismissed_at),
                _iso(snoozed_until),
                error,
                row["account_id"],
                row["source_type"],
                row["source_id"],
                row["occurrence_id"],
                row["scheduled_at"],
            ),
        )

    def reminder_delivery_rows(self, account_id: str) -> list[dict[str, Any]]:
        return [
            dict(row)
            for row in self.connection.execute(
                "SELECT * FROM reminder_deliveries WHERE account_id=? ORDER BY scheduled_at",
                (account_id,),
            )
        ]

    def diagnostics(self) -> dict[str, Any]:
        integrity = self.connection.execute("PRAGMA quick_check").fetchone()[0]
        return {
            "database": self.path.name,
            "schema_version": self.connection.execute("PRAGMA user_version").fetchone()[0],
            "journal_mode": self.connection.execute("PRAGMA journal_mode").fetchone()[0],
            "foreign_keys": bool(self.connection.execute("PRAGMA foreign_keys").fetchone()[0]),
            "integrity": integrity,
            "accounts": self.connection.execute("SELECT count(*) FROM accounts").fetchone()[0],
            "pending_mutations": self.connection.execute("SELECT count(*) FROM outbox").fetchone()[
                0
            ],
            "open_conflicts": self.connection.execute(
                "SELECT count(*) FROM conflicts WHERE status=?", (ConflictStatus.OPEN.value,)
            ).fetchone()[0],
        }
