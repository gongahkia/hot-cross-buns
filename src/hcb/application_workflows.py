"""Cross-entity scheduling, quick capture, and import workflows."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .application import ImportApplyResult, Json, TaskEventLink
from .application_events import EventServiceMixin
from .application_tasks import TaskServiceMixin
from .import_export import ImportedEvent, ImportedTask, ImportPreview, parse_import
from .models import DateTimeKind, DriveFile, Event, EventDateTime, Task, TaskPriority, utc_now
from .quick_capture import (
    QuickCaptureKind,
    QuickCapturePreferences,
    QuickCaptureResult,
    parse_quick_capture,
)


class WorkflowServiceMixin(TaskServiceMixin, EventServiceMixin):
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
