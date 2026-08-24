"""Optimistic calendar-list workflows."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from .application import Json, _ApplicationServiceBase, _dirty, _id, _Unset
from .errors import NotFoundError
from .models import (
    Calendar,
    EntityType,
    Event,
    Metadata,
    MutationOperation,
    ReminderOverride,
    utc_now,
)

_UNSET = _Unset()


class CalendarServiceMixin(_ApplicationServiceBase):
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
